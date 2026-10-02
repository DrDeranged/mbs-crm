import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { PgDialect } from "drizzle-orm/pg-core";

process.env.DATABASE_URL ??= "postgresql://integration-test.invalid/test";

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

async function runDealLinkedUpload(
  leadOwnerId: number,
  identity: { firstName?: string | null; lastName?: string | null; companyName?: string | null } = {},
) {
  const { createGetDealHandler } = await import("../routes/deals");
  const { createDocumentsRouter } = await import("../routes/documents");
  const deal = {
    id: 707,
    leadId: 804,
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
  const lead = {
    id: deal.leadId,
    assignedRepId: leadOwnerId,
    firstName: "John",
    lastName: "Smith",
    email: "john@example.com",
    phone: "555-0100",
    companyName: "Godspeed Logistics",
    status: "new_lead",
    leadSource: "manual",
    ...identity,
  };
  let contactWhere: any;
  const database = {
    query: {
      dealsTable: { async findFirst() { return deal; } },
      activityLogTable: { async findMany() { return []; } },
      dealApprovalsTable: { async findFirst() { return null; } },
      leadsTable: { async findFirst() { return lead; } },
    },
    select() {
      return {
        from() { return this; },
        leftJoin() { return this; },
        async where(where: any) {
          contactWhere = where;
          return leadOwnerId === user.id ? [{
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
          }] : [];
        },
      };
    },
    async transaction(callback: (tx: any) => Promise<unknown>) {
      return callback({
        insert() {
          return {
            values(values: Record<string, unknown>) {
              return {
                async returning() {
                  return [{ id: 1, ...values, createdAt: new Date("2026-01-02T00:00:00.000Z") }];
                },
              };
            },
          };
        },
      });
    },
  };
  const app = express();
  app.get("/api/deals/:id", createGetDealHandler({
    database: database as any,
    authenticate: async () => user as any,
  }));
  app.use("/api", createDocumentsRouter({
    database: database as any,
    authenticate: async () => user as any,
    activityLogger: async () => undefined,
    saveUploadedFile: async () => undefined,
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const dealResponse = await fetch(`http://127.0.0.1:${address.port}/api/deals/${deal.id}`);
    const dealPayload = await dealResponse.json() as {
      leadId: number | null;
      entityLabel: string;
      dealName: string;
      lead: { id: number } | null;
    };
    let uploadResponse: Response | null = null;
    if (dealPayload.leadId != null) {
      const form = new FormData();
      form.set("category", "other");
      form.set("file", new Blob(["controlled test upload"], { type: "text/plain" }), "proof.txt");
      uploadResponse = await fetch(
        `http://127.0.0.1:${address.port}/api/leads/${dealPayload.leadId}/documents`,
        { method: "POST", body: form },
      );
    }
    return { dealResponse, dealPayload, uploadResponse, contactWhere };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

test("rep resolves an authorized funded deal to its lead and uploads against the lead id", async () => {
  const result = await runDealLinkedUpload(user.id);
  assert.equal(result.dealResponse.status, 200);
  assert.equal(result.dealPayload.leadId, 804);
  assert.equal(result.dealPayload.lead?.id, 804);
  assert.equal(result.dealPayload.entityLabel, "Godspeed Logistics — John Smith");
  assert.equal(result.dealPayload.dealName, "Custom deal name");
  assert.equal(result.uploadResponse?.status, 201);
  const query = new PgDialect().sqlToQuery(result.contactWhere);
  assert.match(query.sql, /assigned_rep_id/);
  assert(query.params.includes(user.id));
});

test("visible deal does not disclose or authorize its other-rep lead", async () => {
  const result = await runDealLinkedUpload(user.id + 1);
  assert.equal(result.dealResponse.status, 200);
  assert.equal(result.dealPayload.leadId, null);
  assert.equal(result.dealPayload.lead, null);
  assert.equal(result.dealPayload.entityLabel, "Deal #707");
  assert.equal(result.dealPayload.dealName, "Custom deal name");
  assert.equal(result.uploadResponse, null);
  assert.match(new PgDialect().sqlToQuery(result.contactWhere).sql, /assigned_rep_id/);
});

test("linked deal uses a neutral deal fallback when company and contact identity are absent", async () => {
  const result = await runDealLinkedUpload(user.id, {
    firstName: null,
    lastName: null,
    companyName: null,
  });
  assert.equal(result.dealResponse.status, 200);
  assert.equal(result.dealPayload.entityLabel, "Deal #707");
  assert.equal(result.dealPayload.dealName, "Custom deal name");
});