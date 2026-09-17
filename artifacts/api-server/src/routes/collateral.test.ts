import assert from "node:assert/strict";
import test from "node:test";
import { recordCollateralEmailDelivery, sendCollateralEmail } from "./collateral";

test("collateral email sends a PDF attachment through the injected SendGrid client", async () => {
  const calls: unknown[] = [];
  const client = {
    setApiKey: (key: string) => calls.push(["key", key]),
    send: async (message: unknown) => { calls.push(message); },
  };
  const pdf = Buffer.from("%PDF-test");
  await sendCollateralEmail(client, {
    leadEmail: "lead@example.com",
    repEmail: "rep@my-business-solutions.com",
    repName: "Alex Rep",
    subject: "A resource",
    bodyHtml: "<p>Hello</p>",
    templateName: "Business Flyer",
    pdf,
  });
  assert.equal(calls.length, 2);
  const message = calls[1] as any;
  assert.equal(message.to, "lead@example.com");
  assert.deepEqual(message.replyTo, { email: "rep@my-business-solutions.com", name: "Alex Rep" });
  assert.equal(message.attachments[0].content, pdf.toString("base64"));
  assert.equal(message.attachments[0].filename, "Business Flyer.pdf");
  assert.equal(message.attachments[0].type, "application/pdf");
  assert.equal(message.attachments[0].disposition, "attachment");
});

test("collateral email delivery associates the render and logs lead activity", async () => {
  const associations: Array<[number, number]> = [];
  const activities: any[] = [];
  await recordCollateralEmailDelivery({
    associateRender: async (renderId, leadId) => { associations.push([renderId, leadId]); },
    writeActivity: async (params) => { activities.push(params); },
  }, {
    renderId: 12,
    templateId: 4,
    leadId: 88,
    userId: 7,
    recipientEmail: "lead@example.com",
  });
  assert.deepEqual(associations, [[12, 88]]);
  assert.deepEqual(activities, [{
    userId: 7,
    leadId: 88,
    action: "collateral_emailed",
    entityType: "collateral_render",
    entityId: 12,
    details: { templateId: 4, to: "lead@example.com" },
  }]);
});