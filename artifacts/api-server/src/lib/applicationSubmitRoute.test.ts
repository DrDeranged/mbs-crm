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
type TestLead = Record<string, unknown>;

function makeDatabase(existingLead: TestLead | TestLead[] | null = null) {
  const inserted: InsertedRow[] = [];
  const executed: unknown[] = [];
  const applicationRows: Record<string, unknown>[] = [];
  const leadLookupQueue = Array.isArray(existingLead) ? [...existingLead] : null;
  let nextApplicationId = 601;
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
  let savedLead = Array.isArray(existingLead) ? null : existingLead;

  const database = {
    inserted,
    executed,
    applicationRows,
    query: {
      leadsTable: {
        findFirst: async () => leadLookupQueue
          ? leadLookupQueue.shift() ?? null
          : savedLead,
      },
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
            returning: async () => {
              if (table === leadsTable) return [(savedLead = { ...values, ...lead })];
              if (table === applicationsTable) {
                const application = {
                  ...values,
                  id: nextApplicationId++,
                  submittedAt: new Date(),
                };
                applicationRows.push(application);
                return [application];
              }
              return [{ ...values, id: 701 }];
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where: async (predicate: { queryChunks?: { name?: string; value?: unknown }[] }) => {
              inserted.push({ table, values: { update: values } });
              if (table === applicationsTable) {
                const applicationId = predicate.queryChunks?.find((chunk) => chunk.name === "id")
                  ? predicate.queryChunks.find((chunk) => typeof chunk.value === "number")?.value
                  : undefined;
                if (typeof applicationId === "number") {
                  const application = applicationRows.find((row) => row.id === applicationId);
                  if (application) Object.assign(application, values);
                }
              }
            },
          };
        },
      };
    },
    async transaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
      return callback(database);
    },
    execute: async (statement: unknown) => { executed.push(statement); },
  };
  return database;
}

async function requestWithDatabase(
  database: ReturnType<typeof makeDatabase>,
  notifyRep: (params: Record<string, unknown>) => Promise<void> = async () => {},
  sendEmail: (params: Record<string, unknown>) => Promise<{ error?: unknown }> = async () => ({}),
) {
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
    extractBankStatement: async () => ({
      statementMonth: null,
      statementYear: null,
      totalDeposits: null,
      averageDailyBalance: null,
      nsfCount: 0,
      negativeBalanceDays: 0,
      existingPositions: [],
      rawExtractionJson: {},
    }),
    calculateLeadScore: async () => ({ score: 0, breakdown: {} as any }),
    notifyAllManagers: async () => {},
    createNotification: notifyRep as any,
    doSendEmail: sendEmail,
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
    body.set("email", "jamie@example.com");
    body.set("phone", "555-0100");
    body.set("equipmentDescription", "A delivery van");
    body.set("monthlyRevenueStated", "1200000");
    body.set("timeInBusinessMonths", "18");
    body.set("industryExperienceMonths", "36");
    body.set("hasFinancialStatements", "true");
    body.set("hasFactoring", "false");
    body.set("consentCreditPull", "true");
    body.set("consentTerms", "true");
    body.set("signatureMethod", "typed");
    body.set("signatureData", "Jamie Applicant");
    body.set("rep", "ray");
    body.append("bankStatements", new Blob(["statement fixture"], { type: "application/pdf" }), "january.pdf");
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
  assert.equal(database.inserted.some((row) => row.table === bankStatementExtractionsTable), true);
  const documentInserts = database.inserted.filter((row) => row.table === documentsTable);
  assert.ok(documentInserts.some(({ values }) => values.category === "bank_statement"));
  assert.ok(documentInserts.some(({ values }) => values.category === "signed_application"));
  const applicationInsert = database.inserted.find((row) => row.table === applicationsTable);
  assert.equal(applicationInsert?.values.monthlyRevenueStated, 1_200_000);
  assert.equal(applicationInsert?.values.timeInBusinessMonths, 18);
  assert.equal(applicationInsert?.values.industryExperienceMonths, 36);
  assert.equal(applicationInsert?.values.hasFinancialStatements, true);
  assert.equal(applicationInsert?.values.hasFactoring, false);
  assert.equal(applicationInsert?.values.hasCollateral, false);
});

test("a second public application reuses its existing email lead, logs the re-application, and notifies its assigned rep", async () => {
  const database = makeDatabase({
    id: 777,
    firstName: "Existing",
    lastName: "Applicant",
    email: "JAMIE@EXAMPLE.COM",
    phone: "(555) 0100",
    companyName: "Existing LLC",
    assignedRepId: 29,
    trackingToken: "tracking-777",
  });
  const notifications: Record<string, unknown>[] = [];
  const response = await requestWithDatabase(database, async (params) => {
    notifications.push(params);
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true, lead_id: 777, tracking_token: null });
  assert.equal(database.executed.length, 2, "email and phone identities are transaction-locked before lookup");
  assert.equal(database.inserted.filter((row) => row.table === leadsTable && !("update" in row.values)).length, 0);
  assert.equal(database.inserted.filter((row) => row.table === applicationsTable && !("update" in row.values)).length, 1);
  assert.ok(database.inserted.some((row) =>
    row.table === activityLogTable
    && row.values.action === "Re-application submitted"
    && row.values.leadId === 777,
  ));
  assert.deepEqual(notifications, [{
    userId: 29,
    type: "application_received",
    title: "Re-application received",
    body: "Slug Attribution LLC — equipment",
    leadId: 777,
  }]);
});

test("a phone-only re-application sends only to the stored lead email, never the submitted unverified email", async () => {
  const database = makeDatabase({
    id: 778,
    firstName: "Existing",
    lastName: "Applicant",
    email: "verified@example.com",
    phone: "(555) 0100",
    companyName: "Existing LLC",
    assignedRepId: 29,
    trackingToken: "tracking-778",
  });
  const sentEmails: Record<string, unknown>[] = [];
  const response = await requestWithDatabase(database, async () => {}, async (params) => {
    sentEmails.push(params);
    return {};
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true, lead_id: 778, tracking_token: null });
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0]?.toEmail, "verified@example.com");
  assert.notEqual(sentEmails[0]?.toEmail, "jamie@example.com");
});

test("conflicting email and phone identities return a named 400 without attaching an application", async () => {
  const database = makeDatabase([
    { id: 801, email: "jamie@example.com", phone: "555-9999", assignedRepId: 17, trackingToken: "old-a" },
    { id: 802, email: "other@example.com", phone: "555-0100", assignedRepId: 18, trackingToken: "old-b" },
  ]);
  const response = await requestWithDatabase(database);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "The submitted email and phone belong to different existing leads.",
    field: "email",
  });
  assert.equal(database.inserted.length, 0);
});

test("each re-application retains its own immutable signed-document key", async () => {
  const database = makeDatabase({
    id: 779,
    firstName: "Existing",
    lastName: "Applicant",
    email: "jamie@example.com",
    phone: "555-0100",
    companyName: "Existing LLC",
    assignedRepId: 29,
    trackingToken: "tracking-779",
  });
  assert.equal((await requestWithDatabase(database)).status, 201);
  const firstKey = database.applicationRows[0]?.signedDocumentKey;
  assert.equal((await requestWithDatabase(database)).status, 201);
  const [firstApplication, secondApplication] = database.applicationRows;
  assert.equal(database.applicationRows.length, 2);
  assert.equal(firstApplication?.signedDocumentKey, firstKey);
  assert.ok(typeof secondApplication?.signedDocumentKey === "string");
  assert.notEqual(firstApplication?.signedDocumentKey, secondApplication?.signedDocumentKey);
});