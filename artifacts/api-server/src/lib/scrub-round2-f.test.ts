import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import {
  EMAIL_COMPLIANCE_ADDRESS,
  FROM_EMAIL,
  createAdminTestSendHandler,
  reserveDailyMarketingEmail,
  sendTrackedEmailToProvider,
} from "../routes/email";
import {
  createSendGridWebhookHandler,
  processSendGridWebhookEvents,
} from "../routes/sendgrid";
import { CompanySettingsBody, EmailDeliverySettingsBody } from "../routes/settings";

async function listen(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("the actual provider dispatch sink sends a signed unsubscribe footer and legal address", async () => {
  let dispatched: { html?: string } | undefined;
  await sendTrackedEmailToProvider({
    provider: {
      send: async (message: any) => {
        dispatched = message;
        return [{}] as any;
      },
    },
    from: { email: FROM_EMAIL, name: "My Business Solutions" },
    toEmail: "recipient@example.test",
    subject: "Subject",
    bodyHtml: "<p>Message</p>",
    sendId: 42,
    baseUrl: "https://crm.example.test",
  });
  assert.match(dispatched?.html ?? "", /\/api\/email\/unsubscribe\?id=42&email=recipient%40example\.test&token=/);
  assert.match(dispatched?.html ?? "", /Unsubscribe/);
  assert.ok(dispatched?.html?.includes(EMAIL_COMPLIANCE_ADDRESS));
});

test("a no-flyer campaign message has text/plain, minimal HTML, and zero attachments", async () => {
  let dispatched: any;
  await sendTrackedEmailToProvider({
    provider: {
      send: async (message: any) => {
        dispatched = message;
        return [{}] as any;
      },
    },
    from: { email: FROM_EMAIL, name: "My Business Solutions" },
    toEmail: "recipient@example.test",
    subject: "Plain campaign",
    bodyText: "Hello from MBS.",
    bodyHtml: "<p>Hello from MBS.</p>",
    sendId: 43,
    baseUrl: "https://crm.example.test",
    attachments: undefined,
    minimalNoImages: true,
  });
  assert.equal(dispatched.attachments, undefined);
  assert.match(dispatched.text, /Hello from MBS\./);
  assert.match(dispatched.text, /Unsubscribe:/);
  assert.doesNotMatch(dispatched.html, /<img|src=/i);
});

test("correlated webhook suppresses the persisted recipient, not a mismatched event email", async () => {
  const suppressed: string[] = [];
  const send = {
    id: 17, leadId: 4, userId: 2, subject: "Subject",
    toEmail: "correlated@example.test", status: "sent" as const,
  };
  const repository = {
    insertEvent: async () => true,
    findSend: async () => send,
    suppressRecipient: async (email: string) => { suppressed.push(email); },
    updateSend: async () => undefined,
    hasActivity: async () => false,
    logActivity: async () => undefined,
  };
  const app = express();
  app.use(express.json());
  app.post("/sendgrid/webhook", createSendGridWebhookHandler({
    verifySignature: () => true,
    processEvents: (events) => processSendGridWebhookEvents(events, repository),
  }));
  const server = await listen(app);
  try {
    const response = await fetch(`${server.url}/sendgrid/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "bounce", sg_message_id: "matched-id", sg_event_id: "mismatch-event",
        email: "mismatched-but-signed@example.test",
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(suppressed, ["correlated@example.test"]);
  } finally {
    await server.close();
  }
});

test("valid SendGrid ECDSA signature passes through exact raw-body verification", async () => {
  const publicKey = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE83T4O/n84iotIvIW4mdBgQ/7dAfSmpqIM8kF9mN1flpVKS3GRqe62gw+2fNNRaINXvVpiglSI8eNEc6wEA3F+g==";
  const signature = "MEUCIGHQVtGj+Y3LkG9fLcxf3qfI10QysgDWmMOVmxG0u6ZUAiEAyBiXDWzM+uOe5W0JuG+luQAbPIqHh89M15TluLtEZtM=";
  const timestamp = "1600112502";
  const payload = JSON.stringify([{
    email: "hello@world.com",
    event: "dropped",
    reason: "Bounced Address",
    sg_event_id: "ZHJvcC0xMDk5NDkxOS1MUnpYbF9OSFN0T0doUTRrb2ZTbV9BLTA",
    sg_message_id: "LRzXl_NHStOGhQ4kofSm_A.filterdrecv-p3mdw1-756b745b58-kmzbl-18-5F5FC76C-9.0",
    "smtp-id": "<LRzXl_NHStOGhQ4kofSm_A@ismtpd0039p1iad1.sendgrid.net>",
    timestamp: 1600112492,
  }]) + "\r\n";
  const savedKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY = publicKey;
  let acceptedEvents: Array<Record<string, unknown>> = [];
  const app = express();
  app.use(express.json({
    verify: (req, _res, body) => { (req as any).rawBody = body; },
  }));
  app.post("/sendgrid/webhook", createSendGridWebhookHandler({
    processEvents: async (events) => {
      acceptedEvents = events;
      return { processed: events.length, ignored: 0 };
    },
  }));
  const server = await listen(app);
  try {
    const response = await fetch(`${server.url}/sendgrid/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-twilio-email-event-webhook-signature": signature,
        "x-twilio-email-event-webhook-timestamp": timestamp,
      },
      body: payload,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, processed: 1, ignored: 0 });
    assert.equal(acceptedEvents[0]?.event, "dropped");
  } finally {
    if (savedKey === undefined) delete process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
    else process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY = savedKey;
    await server.close();
  }
});

test("invalid webhook signatures return 401 before any delivery or suppression mutation", async () => {
  const mutations: string[] = [];
  const repository = {
    insertEvent: async () => { mutations.push("event"); return true; },
    findSend: async () => { mutations.push("find"); return undefined; },
    suppressRecipient: async () => { mutations.push("suppress"); },
    updateSend: async () => { mutations.push("delivery"); },
    hasActivity: async () => { mutations.push("activity-read"); return false; },
    logActivity: async () => { mutations.push("activity-write"); },
  };
  const app = express();
  app.use(express.json());
  app.post("/sendgrid/webhook", createSendGridWebhookHandler({
    verifySignature: () => false,
    processEvents: (events) => processSendGridWebhookEvents(events, repository),
  }));
  const server = await listen(app);
  try {
    const response = await fetch(`${server.url}/sendgrid/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "bounce",
        email: "recipient@example.test",
        sg_message_id: "must-not-be-processed",
      }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Invalid webhook signature" });
    assert.deepEqual(mutations, []);
  } finally {
    await server.close();
  }
});

test("authenticated webhook route applies terminal status, suppression, and activity for every suppressing event", async () => {
  const expected = {
    bounce: { status: "bounced", action: "email_bounced" },
    dropped: { status: "bounced", action: "email_bounced" },
    spamreport: { status: "unsubscribed", action: "email_spam_reported" },
    unsubscribe: { status: "unsubscribed", action: "email_unsubscribed" },
  } as const;
  for (const [event, effect] of Object.entries(expected)) {
    const updates: Array<Record<string, unknown>> = [];
    const suppressed: string[] = [];
    const activities: Array<{ action: string; event: unknown }> = [];
    const send = {
      id: 9, leadId: 42, userId: 3, subject: "Subject",
      toEmail: "recipient@example.test", status: "sent" as const,
    };
    const repository = {
      insertEvent: async () => true,
      findSend: async () => send,
      suppressRecipient: async (email: string) => { suppressed.push(email); },
      updateSend: async (_send: typeof send, updatesForSend: Record<string, unknown>) => { updates.push(updatesForSend); },
      hasActivity: async () => false,
      logActivity: async (_send: typeof send, action: string, details: Record<string, unknown>) => {
        activities.push({ action, event: details.event });
      },
    };
    const app = express();
    app.use(express.json());
    app.post("/sendgrid/webhook", createSendGridWebhookHandler({
      verifySignature: () => true,
      processEvents: (events) => processSendGridWebhookEvents(events, repository),
    }));
    const server = await listen(app);
    try {
      const response = await fetch(`${server.url}/sendgrid/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event, email: send.toEmail, sg_message_id: "mocked-message-id", sg_event_id: event }),
      });
      assert.equal(response.status, 200, event);
      assert.deepEqual(await response.json(), { ok: true, processed: 1, ignored: 0 }, event);
      assert.equal(updates[0]?.status, effect.status, event);
      assert.deepEqual(suppressed, [send.toEmail], event);
      assert.deepEqual(activities, [{ action: effect.action, event }], event);
    } finally {
      await server.close();
    }
  }
});

test("admin test-send route sends fixed CEO message from funding address and returns mocked provider id", async () => {
  let sendParams: Record<string, unknown> | undefined;
  const app = express();
  app.use(express.json());
  app.post("/email/test-send", createAdminTestSendHandler({
    requireAuthenticatedUser: async () => ({ id: 7, role: "admin" }),
    findRep: async () => ({ name: "Admin", email: "admin@example.test" }),
    send: async (params) => {
      sendParams = params;
      return {
        send: {
          id: 88, leadId: null, userId: 7, templateId: null, subject: params.subject,
          toEmail: params.toEmail, fromEmail: "funding@my-business-solutions.com",
          status: "sent", failureReason: null, sendgridMessageId: "mocked-provider-id",
          sentAt: new Date(), openedAt: null, clickedAt: null, createdAt: new Date(), updatedAt: new Date(),
        },
      };
    },
    activity: async () => undefined,
  }));
  const server = await listen(app);
  try {
    const response = await fetch(`${server.url}/email/test-send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toEmail: "ceo-test-recipient@example.test" }),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json() as { messageId: string }).messageId, "mocked-provider-id");
    assert.equal(sendParams?.toEmail, "ceo-test-recipient@example.test");
    assert.equal(sendParams?.deliveryKind, "test");
    assert.equal(sendParams?.templateId, null);
    assert.equal(FROM_EMAIL, "funding@my-business-solutions.com");
    assert.match(String(sendParams?.bodyHtml), /My Business Solutions CEO/);
  } finally {
    await server.close();
  }
});

test("shared locked daily bulk/drip reservation allows 75 combined attempts and denies the rest", async () => {
  let used = 0;
  let tail = Promise.resolve();
  const repository = {
    withLock: async <T>(work: (_context: undefined) => Promise<T>) => {
      const previous = tail;
      let release: (() => void) | undefined;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await work(undefined);
      } finally {
        release?.();
      }
    },
    getLimit: async () => 75,
    getUsed: async () => used,
    create: async () => ++used,
  };
  const attempts = await Promise.all(
    Array.from({ length: 76 }, (_, index) =>
      reserveDailyMarketingEmail(repository).then((result) => ({
        source: index % 2 === 0 ? "bulk" : "drip",
        result,
      })),
    ),
  );
  assert.equal(attempts.filter(({ result }) => result !== null).length, 75);
  assert.equal(attempts.filter(({ source, result }) => source === "bulk" && result !== null).length, 38);
  assert.equal(attempts.filter(({ source, result }) => source === "drip" && result !== null).length, 37);
  assert.equal(used, 75);
});

test("bulk and drip production call sites opt into the shared 75-message reservation", async () => {
  const emailRoute = await readFile(new URL("../routes/email.ts", import.meta.url), "utf8");
  const dripJob = await readFile(new URL("./dripJob.ts", import.meta.url), "utf8");
  assert.match(emailRoute, /deliveryKind:\s*"bulk"/);
  assert.match(dripJob, /deliveryKind:\s*"drip"/);
  assert.match(emailRoute, /bulkEmailPerDay\s*\?\?\s*75/);
  assert.match(emailRoute, /reserveDailyMarketingEmail/);
});

test("email-delivery settings rejects null and malformed F fields with a named issue before database access", () => {
  for (const invalid of [null, { bulkEmailPerDay: 0 }, { bulkEmailPerMinute: "75" }]) {
    const parsed = EmailDeliverySettingsBody.safeParse(invalid);
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      assert.ok((parsed.error.issues[0]?.path.join(".") || "body").length > 0);
    }
  }
  for (const invalid of [null, [], { companyName: {} }, { emailSendingEnabled: "true" }]) {
    const parsed = CompanySettingsBody.safeParse(invalid);
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      assert.ok((parsed.error.issues[0]?.path.join(".") || "body").length > 0);
    }
  }
});