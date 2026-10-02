import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createGetDealHandler } from "../routes/deals";
import { createSendLeadSmsHandler } from "../routes/communications";

process.env.DATABASE_URL ??= "postgresql://integration-test.invalid/test";

test("deal contact SMS target uses application-scoped consent and never sends without consent", async () => {
  const user = {
    id: 7,
    clerkId: "rep-7",
    name: "Rep Seven",
    title: null,
    email: "rep7@example.com",
    slug: "rep-seven",
    role: "rep" as const,
    isActive: true,
    mobileNumber: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const lead = {
    id: 804,
    assignedRepId: user.id,
    firstName: "John",
    lastName: "Smith",
    email: "john@example.com",
    phone: "555-0100",
    companyName: null,
    status: "new_lead",
    leadSource: "manual",
    isUnsubscribed: false,
  };
  const deal = {
    id: 707,
    leadId: lead.id,
    assignedTo: user.id,
    dealName: "Custom deal name",
    stage: "funded",
    amount: 100000,
    approxGm: null,
    actualGm: 7000,
    referredByPartnerId: null,
    referralSplitPct: null,
    notes: null,
    gmSplitPct: 100,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    fundedAt: new Date("2026-01-02T00:00:00.000Z"),
    isArchived: false,
    assignedUser: null,
  };
  let sendCalls = 0;
  let insertCalls = 0;
  let applicationLookupCalls = 0;
  const database = {
    query: {
      dealsTable: { async findFirst() { return deal; } },
      activityLogTable: { async findMany() { return []; } },
      dealApprovalsTable: { async findFirst() { return null; } },
      leadsTable: { async findFirst() { return lead; } },
      applicationsTable: {
        async findFirst() {
          applicationLookupCalls++;
          return {
            smsConsent: false,
            smsConsentAt: null,
            smsConsentIp: null,
          };
        },
      },
    },
    select() {
      return {
        from() { return this; },
        leftJoin() { return this; },
        async where() {
          return [{
            leadId: lead.id,
            firstName: lead.firstName,
            lastName: lead.lastName,
            companyName: lead.companyName,
            relatedCompanyName: null,
            contactEmail: lead.email,
            contactPhone: lead.phone,
            status: lead.status,
            assignedRepId: lead.assignedRepId,
            address: null,
            city: null,
            state: null,
            zip: null,
          }];
        },
      };
    },
    insert() {
      insertCalls++;
      throw new Error("SMS consent rejection must not persist a communication");
    },
  };
  const app = express();
  app.use(express.json());
  app.get("/api/deals/:id", createGetDealHandler({
    database: database as any,
    authenticate: async () => user as any,
  }));
  app.post("/api/leads/:id/sms", createSendLeadSmsHandler({
    database,
    authenticate: async () => user as any,
    getSettings: async () => ({ smsSenderNumber: "+15551234567" }) as any,
    accountSid: "test-account",
    authToken: "test-token",
    isMarketingBlocked: async () => false,
    sendMessage: async () => {
      sendCalls++;
      return { status: "sent", sid: "should-not-be-used" };
    },
    recordActivity: async () => undefined,
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const dealResponse = await fetch(`http://127.0.0.1:${address.port}/api/deals/${deal.id}`);
    const dealPayload = await dealResponse.json() as { leadId: number | null };
    assert.equal(dealPayload.leadId, lead.id);

    const smsResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/leads/${dealPayload.leadId}/sms`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Hello from the deal contact action" }),
      },
    );
    assert.equal(smsResponse.status, 422);
    const smsPayload = await smsResponse.json() as { error: string; message: string };
    assert.equal(smsPayload.error, "consent_required");
    assert.match(smsPayload.message, /application_sms_consent_required/);
    assert.equal(applicationLookupCalls, 1);
    assert.equal(sendCalls, 0);
    assert.equal(insertCalls, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
});