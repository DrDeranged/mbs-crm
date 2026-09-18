import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import { createPushNotificationsRouter, isAllowedPushEndpointOrigin } from "../routes/pushNotifications";
import { pushSubscriptionsTable } from "@workspace/db";

test("authenticated subscription route round-trips through upsert and unsubscribe handlers", async () => {
  const rows: Array<Record<string, unknown>> = [];
  const fakeDb = {
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          const existing = rows.find((row) => row.endpoint === value.endpoint);
          if (existing) Object.assign(existing, value);
          else rows.push({ id: rows.length + 1, ...value });
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        rows.splice(0, rows.length);
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: async () => table === pushSubscriptionsTable ? rows : [],
      }),
    }),
  };
  const app = express();
  app.use(express.json());
  app.use(createPushNotificationsRouter({
    db: fakeDb,
    authenticate: async () => ({ id: 7, role: "rep" } as any),
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/subscription", p256dh: "p256dh", auth: "auth" };
    const subscribed = await fetch(`${base}/notifications/subscriptions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(subscription),
    });
    assert.equal(subscribed.status, 204);
    assert.equal(rows.length, 1);
    const unsubscribed = await fetch(`${base}/notifications/subscriptions`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    assert.equal(unsubscribed.status, 204);
    assert.equal(rows.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("push subscription origins accept known providers and reject lookalikes/insecure URLs", () => {
  assert.equal(isAllowedPushEndpointOrigin("https://fcm.googleapis.com/fcm/send/token"), true);
  assert.equal(isAllowedPushEndpointOrigin("https://updates.push.services.mozilla.com/wpush/v2/token"), true);
  assert.equal(isAllowedPushEndpointOrigin("https://web.push.apple.com/3/device/token"), true);
  assert.equal(isAllowedPushEndpointOrigin("http://fcm.googleapis.com/token"), false);
  assert.equal(isAllowedPushEndpointOrigin("https://fcm.googleapis.com.attacker.test/token"), false);
  assert.equal(isAllowedPushEndpointOrigin("https://push.example.test/token"), false);
});

test("concurrent first claims of one endpoint cannot transfer its owner", async () => {
  const rows: Array<Record<string, unknown>> = [];
  const fakeDb = {
    select: () => ({ from: () => ({ where: async () => [...rows] }) }),
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        onConflictDoUpdate: async (options: { where: { queryChunks?: unknown[] } }) => {
          const existing = rows.find((row) => row.endpoint === value.endpoint);
          if (!existing) {
            rows.push({ id: rows.length + 1, ...value });
          } else if (value.userId === existing.userId) {
            Object.assign(existing, value);
          }
          // This deliberately models PostgreSQL's conditional conflict update:
          // the losing transaction cannot change user_id.
          void options;
        },
      }),
    }),
  };
  let nextUser = 1;
  const app = express();
  app.use(express.json());
  app.use(createPushNotificationsRouter({
    db: fakeDb,
    authenticate: async () => ({ id: nextUser++, role: "rep" } as any),
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const request = () => fetch(`http://127.0.0.1:${address.port}/notifications/subscriptions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/race", p256dh: "p", auth: "a" }),
  });
  try {
    const responses = await Promise.all([request(), request()]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [204, 409]);
    assert.equal(rows[0]?.userId, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});