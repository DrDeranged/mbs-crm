import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import {
  createNotificationsRouter,
  notificationsQuery,
  type NotificationStore,
} from "../routes/notifications";

process.env.DATABASE_URL ??= "postgresql://integration-test.invalid/test";

type FixtureNotification = {
  id: number;
  userId: number;
  leadId: number;
  isRead: boolean;
  type: "lead_assigned";
  title: string;
  body: string;
  createdAt: Date;
  lead: {
    firstName: string;
    lastName: string;
    companyName: string;
  };
};

function notification(id: number, userId: number, leadId: number): FixtureNotification {
  return {
    id,
    userId,
    leadId,
    isRead: false,
    type: "lead_assigned",
    title: `Lead ${leadId} assigned`,
    body: "Open the lead to follow up.",
    createdAt: new Date("2026-09-17T12:00:00.000Z"),
    lead: {
      firstName: "Morgan",
      lastName: "Lee",
      companyName: "Morgan Lee LLC",
    },
  };
}

function fixtureStore(rows: FixtureNotification[]): NotificationStore {
  return {
    async unreadCount(userId) {
      return rows.filter((row) => row.userId === userId && !row.isRead).length;
    },
    async markAllRead(userId) {
      rows.forEach((row) => {
        if (row.userId === userId) row.isRead = true;
      });
    },
    async list(userId, limit, offset) {
      return rows
        .filter((row) => row.userId === userId)
        .slice(offset, offset + limit) as any;
    },
    async total(userId) {
      return rows.filter((row) => row.userId === userId).length;
    },
    async markRead(userId, id) {
      const row = rows.find((candidate) => candidate.id === id && candidate.userId === userId);
      if (row) row.isRead = true;
    },
  };
}

async function withNotificationServer(
  user: { id: number; role: "rep" | "admin" },
  rows: FixtureNotification[],
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(
    createNotificationsRouter({
      store: fixtureStore(rows),
      authenticate: async () => user as any,
    }),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not start");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("the generated client's exact notification payload matches the strict query schema", () => {
  const exactPayload = { page: "1", limit: "20" };
  const parsed = notificationsQuery.safeParse(exactPayload);
  assert.equal(parsed.success, true);
  if (parsed.success) assert.deepEqual(parsed.data, { page: 1, limit: 20 });
  assert.equal(notificationsQuery.safeParse({ ...exactPayload, diagnostic: "x" }).success, false);
});

for (const user of [
  { id: 41, role: "rep" as const },
  { id: 42, role: "admin" as const },
]) {
  test(`${user.role} can list, click through, mark read, and mark all read without changing another user's rows`, async () => {
    const otherUserId = user.id === 41 ? 42 : 41;
    const rows = [
      notification(user.id * 10 + 1, user.id, 501),
      notification(user.id * 10 + 2, user.id, 502),
      notification(otherUserId * 10 + 1, otherUserId, 601),
    ];

    await withNotificationServer(user, rows, async (baseUrl) => {
      const list = await fetch(`${baseUrl}/notifications?page=1&limit=20`);
      assert.equal(list.status, 200);
      const listBody = await list.json() as {
        data: Array<{ id: number; leadId: number }>;
        total: number;
      };
      assert.equal(listBody.total, 2);
      assert.deepEqual(listBody.data.map((row) => row.leadId), [501, 502]);
      assert.equal(`/leads/${listBody.data[0].leadId}`, "/leads/501");

      const read = await fetch(
        `${baseUrl}/notifications/${listBody.data[0].id}/read`,
        { method: "PUT" },
      );
      assert.equal(read.status, 200);

      const afterRead = await fetch(`${baseUrl}/notifications/unread-count`);
      assert.deepEqual(await afterRead.json(), { count: 1 });

      const readAll = await fetch(`${baseUrl}/notifications/read-all`, {
        method: "PUT",
      });
      assert.equal(readAll.status, 200);

      const afterReadAll = await fetch(`${baseUrl}/notifications/unread-count`);
      assert.deepEqual(await afterReadAll.json(), { count: 0 });
      assert.equal(rows.find((row) => row.userId === otherUserId)?.isRead, false);
    });
  });
}