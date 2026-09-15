import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {
  activityLogTable,
  applicationsTable,
  bankStatementExtractionsTable,
  documentsTable,
  leadsTable,
  tasksTable,
  usersTable,
} from "@workspace/db";
import { createApplicationSubmitRouter } from "../routes/applications";

type InsertedRow = { table: unknown; values: Record<string, unknown> };

function makeDatabase() {
  const inserted: InsertedRow[] = [];
  const lead = {
    id: 501,
    firstName: "Jamie",
    lastName: "Applicant",
    email: null,
    phone: null,
    companyName: "Slug Attribution LLC",
    assignedRepId: 17,
    trackingToken: "tracking-501",
  };
  const application = { id: 601, leadId: lead.id, submittedAt: new Date("2026-01-01T00:00:00.000Z") };

  const database = {
    inserted,
    query: {
      leadsTable: { findFirst: async () => null },
      usersTable: {
        findFirst: async () => ({
          id: 17,
          role: "rep",
          isActive: true,
          slug: "ray",
          name: "Ray Davis",
          email: null,
          mobileNumber: null,
        }),
      },
      bankStatementExtractionsTable: { findMany: async () => [] },
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          inserted.push({ table, values });
          return {
            returning: async () => table === leadsTable
              ? [{ ...values, ...lead }]
              : table === applicationsTable
                ? [{ ...values, ...application }]
                : [{ ...values, id: 701 }],
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where: async () => {
              inserted.push({ table, values: { update: values } });
            },
          };
        },
      };
    },
    async transaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
      return callback(database);
    },
  };
  return database;
}

async function requestWithDatabase(database: ReturnType<typeof makeDatabase>) {
  const app = express();
  app.use(createApplicationSubmitRouter({
    database: database as any,
    resolveInboundAssignee: async (slug) => {
      assert.equal(slug, "ray");
      return 17;
    },
    checkIdempotency: async () => null,
    storeIdempotency: async () => {},
    objectStorageClient: {
      bucket: () => ({ file: () => ({ save: async () => {} }) }),
    } as any,
    calculateLeadScore: async () => ({ score: 0, breakdown: {} as any }),
    notifyAllManagers: async () => {},
    createNotification: async () => {},
  }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const body = new FormData();
    body.set("type", "equipment");
    body.set("businessName", "Slug Attribution LLC");
    body.set("ownerFirstName", "Jamie");
    body.set("ownerLastName", "Applicant");
    body.set("equipmentDescription", "A delivery van");
    body.set("consentCreditPull", "true");
    body.set("consentTerms", "true");
    body.set("signatureMethod", "typed");
    body.set("signatureData", "Jamie Applicant");
    body.set("rep", "ray");
    return await fetch(`http://127.0.0.1:${address.port}/applications/submit`, {
      method: "POST",
      body,
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("application submit attributes a rep-slug lead and records QR-card activity", async () => {
  const database = makeDatabase();
  const response = await requestWithDatabase(database);
  assert.equal(response.status, 201);

  const leadInsert = database.inserted.find((row) => row.table === leadsTable);
  assert.equal(leadInsert?.values.assignedRepId, 17);
  assert.equal(leadInsert?.values.leadSource, "qr-card");

  const activities = database.inserted.filter((row) => row.table === activityLogTable);
  assert.ok(activities.some(({ values }) => values.action === "lead_created" && (values.details as any)?.source === "qr-card"));
  assert.ok(activities.some(({ values }) => values.action === "attributed" && (values.details as any)?.source === "qr-card"));
  assert.equal(database.inserted.some((row) => row.table === tasksTable), false);
  assert.equal(database.inserted.some((row) => row.table === bankStatementExtractionsTable), false);
  assert.ok(database.inserted.some((row) => row.table === documentsTable));
});