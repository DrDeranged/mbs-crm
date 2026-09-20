import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import analyticsRouter from "./analytics";
import { listCollateralTemplatesHandler, recordCollateralEmailDelivery, sendCollateralEmail } from "./collateral";

test("admin can request draft collateral without analytics rejecting its query", async () => {
  let includedDrafts = false;
  const app = express();
  app.use("/api", analyticsRouter);
  app.get("/api/collateral/templates", listCollateralTemplatesHandler({
    getUser: async () => ({ id: 1, role: "admin" }) as any,
    listTemplates: async (includeDrafts) => {
      includedDrafts = includeDrafts;
      return [];
    },
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/collateral/templates?includeDrafts=true`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
    assert.equal(includedDrafts, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

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