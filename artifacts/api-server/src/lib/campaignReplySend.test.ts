import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import sgMail from "@sendgrid/mail";
import { db, pool } from "@workspace/db";

// Process-local fake provider credential, before importing the real sender.
// Every DB operation and provider delivery is intercepted below.
process.env.SENDGRID_API_KEY = "SG.fixture-no-live-delivery";
const { doSendEmail } = await import("../routes/email");
const { digestReplyToken, REPLY_DOMAIN } = await import("./campaignAttribution");
after(() => pool.end());

test("campaign reply capture is optional; real sender retains Reply-To or tokenises only on opt-in", async () => {
  const originalSecret = process.env.SENDGRID_INBOUND_PARSE_SECRET;
  const originalEnabled = process.env.SENDGRID_INBOUND_PARSE_ENABLED;
  try {
    for (const [secret, enabled, captured] of [
      [undefined, undefined, false],
      [undefined, "true", false],
      ["", "true", false],
      ["   ", "true", false],
      ["fixture-inbound-secret", undefined, false],
      ["fixture-inbound-secret", "false", false],
      ["fixture-inbound-secret", "true", true],
    ] as const) {
      if (secret === undefined) delete process.env.SENDGRID_INBOUND_PARSE_SECRET;
      else process.env.SENDGRID_INBOUND_PARSE_SECRET = secret;
      if (enabled === undefined) delete process.env.SENDGRID_INBOUND_PARSE_ENABLED;
      else process.env.SENDGRID_INBOUND_PARSE_ENABLED = enabled;
      let inserted: Record<string, unknown> = {};
      const deliveries: any[] = [];
      mock.method(db, "select", () => ({
        from: () => ({
          limit: async () => [{ emailSendingEnabled: true }],
          where: async () => [], // no recipient suppression
        }),
      }));
      mock.method(db, "insert", () => ({
        values: (values: Record<string, unknown>) => {
          inserted = values;
          return { returning: async () => [{ id: 77, ...values }] };
        },
      }));
      mock.method(db, "update", () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ id: 77, ...inserted, ...values }] }),
        }),
      }));
      mock.method(sgMail, "send", async (message: any) => {
        deliveries.push(message);
        return [{ statusCode: 202, headers: { "x-message-id": "fixture-message" } }];
      });
      const result = await doSendEmail({
        leadId: null, userId: null, templateId: null, campaignId: 5,
        subject: "Fixture only", bodyHtml: "<p>Fixture only</p>",
        toEmail: "recipient@example.invalid", replyToEmail: "configured@example.invalid",
        baseUrl: "https://app.my-business-solutions.com", minimalNoImages: true,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.send?.status, "sent");
      assert.equal(deliveries.length, 1);
      const address = deliveries[0].replyTo.email;
      if (captured) {
        assert.match(address, new RegExp(`^r-[a-f0-9]{48}@${REPLY_DOMAIN.replaceAll(".", "\\.")}$`));
        assert.equal(inserted.replyTokenDigest, digestReplyToken(address.slice(2, 50)));
        assert.equal(inserted.originalReplyTo, "configured@example.invalid");
      } else {
        assert.equal(address, "configured@example.invalid");
        assert.equal(inserted.replyTokenDigest, null);
        assert.equal(inserted.originalReplyTo, null);
      }
      mock.restoreAll();
    }
  } finally {
    mock.restoreAll();
    if (originalSecret === undefined) delete process.env.SENDGRID_INBOUND_PARSE_SECRET;
    else process.env.SENDGRID_INBOUND_PARSE_SECRET = originalSecret;
    if (originalEnabled === undefined) delete process.env.SENDGRID_INBOUND_PARSE_ENABLED;
    else process.env.SENDGRID_INBOUND_PARSE_ENABLED = originalEnabled;
  }
});
