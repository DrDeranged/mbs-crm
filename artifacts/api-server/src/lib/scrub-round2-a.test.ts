import assert from "node:assert/strict";
import { createServer } from "node:http";
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
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { discoverMigrations, getMigrationStatus } from "../../../../lib/db/src/migrate.ts";
import { createApplicationSubmitRouter } from "../routes/applications";
import {
  createLenderPackageConfigHandler,
  createSelectedLenderPackageHandler,
} from "./lenderPackage";

process.env.DATABASE_URL ??= "postgresql://scrub-round2-a.invalid/test";
const { createSubmissionHandler } = await import("../routes/lenders");

type Insert = { table: unknown; values: Record<string, unknown> };

function applicationFixture() {
  const inserts: Insert[] = [];
  const lead = {
    id: 501,
    firstName: "Jamie",
    lastName: "Applicant",
    email: null,
    phone: null,
    companyName: "Fixture Co",
    assignedRepId: 17,
    trackingToken: "fixture-token",
  };
  const application = { id: 601, leadId: lead.id, submittedAt: new Date("2026-01-01T00:00:00.000Z") };
  const database = {
    inserts,
    query: {
      leadsTable: { findFirst: async () => null },
      usersTable: { findFirst: async () => null },
      bankStatementExtractionsTable: { findMany: async () => [] },
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          inserts.push({ table, values });
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
    update() {
      return { set: () => ({ where: async () => undefined }) };
    },
    async transaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
      return callback(database);
    },
  };
  return database;
}

async function submit(
  database: ReturnType<typeof applicationFixture>,
  fields: Record<string, string>,
) {
  const app = express();
  app.use(createApplicationSubmitRouter({
    database: database as never,
    resolveInboundAssignee: async () => 17,
    checkIdempotency: async () => null,
    storeIdempotency: async () => undefined,
    objectStorageClient: { bucket: () => ({ file: () => ({ save: async () => undefined }) }) } as never,
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
    calculateLeadScore: async () => ({ score: 0, breakdown: {} as never }),
    notifyAllManagers: async () => undefined,
    createNotification: async () => undefined,
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    return await fetch(`http://127.0.0.1:${address.port}/applications/submit`, { method: "POST", body });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function requiredFields(overrides: Record<string, string> = {}) {
  return {
    type: "equipment",
    businessName: "Fixture Co",
    ownerFirstName: "Jamie",
    ownerLastName: "Applicant",
    equipmentDescription: "Forklift",
    consentCreditPull: "true",
    consentTerms: "true",
    signatureMethod: "typed",
    signatureData: "Jamie Applicant",
    ...overrides,
  };
}

function responseFixture() {
  const response = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(body: unknown) {
      response.body = body;
      return response;
    },
    setHeader(name: string, value: string) {
      response.headers[name] = value;
      return response;
    },
    send(body: unknown) {
      response.body = body;
      return response;
    },
    end() {
      return response;
    },
  };
  return response;
}

test("scrub A fixture stores normalized EIN, server consent version, optional secondary owner, and both signature methods", async () => {
  const typed = applicationFixture();
  const typedResponse = await submit(typed, requiredFields({ ein: "123456789" }));
  assert.equal(typedResponse.status, 201);
  const typedApplication = typed.inserts.find((row: Insert) => row.table === applicationsTable)?.values;
  assert.equal(typedApplication?.ein, "12-3456789");
  assert.equal(typedApplication?.secondaryOwnerName, null);
  assert.equal(typedApplication?.consentTextVersion, "2026-09-14");
  assert.equal(typedApplication?.signatureMethod, "typed");
  assert.equal(typedApplication?.signatureData, "Jamie Applicant");

  const drawn = applicationFixture();
  const drawnResponse = await submit(drawn, requiredFields({
    signatureMethod: "drawn",
    signatureData: "data:image/png;base64,aGVsbG8=",
  }));
  assert.equal(drawnResponse.status, 201);
  const drawnApplication = drawn.inserts.find((row: Insert) => row.table === applicationsTable)?.values;
  assert.equal(drawnApplication?.signatureMethod, "drawn");
  assert.equal(drawnApplication?.signatureData, "data:image/png;base64,aGVsbG8=");
  assert.equal(drawn.inserts.some((row: Insert) => row.table === tasksTable), false, "equipment statements remain optional");
});

test("scrub A fixture reports named validation fields and creates the working-capital statement task", async () => {
  const invalid = applicationFixture();
  const invalidResponse = await submit(invalid, requiredFields({
    ein: "not-an-ein",
    consentCreditPull: "false",
    consentTerms: "false",
  }));
  assert.equal(invalidResponse.status, 400);
  const invalidBody = await invalidResponse.json() as { field: string };
  assert.equal(invalidBody.field, "ein");
  assert.equal(invalid.inserts.length, 0);

  const missingCreditConsent = applicationFixture();
  const missingCreditResponse = await submit(missingCreditConsent, requiredFields({
    consentCreditPull: "false",
  }));
  assert.equal(missingCreditResponse.status, 400);
  assert.equal((await missingCreditResponse.json() as { field: string }).field, "consentCreditPull");

  const missingTermsConsent = applicationFixture();
  const missingTermsResponse = await submit(missingTermsConsent, requiredFields({
    consentTerms: "false",
  }));
  assert.equal(missingTermsResponse.status, 400);
  assert.equal((await missingTermsResponse.json() as { field: string }).field, "consentTerms");

  const skipped = applicationFixture();
  const skippedResponse = await submit(skipped, requiredFields({
    type: "working_capital",
    statementsSkipped: "true",
  }));
  assert.equal(skippedResponse.status, 201);
  const task = skipped.inserts.find((row: Insert) => row.table === tasksTable);
  assert.equal(task?.values.userId, 17);
  assert.match(String(task?.values.title), /Collect 3–6 months bank statements/);
  assert.ok(skipped.inserts.some((row: Insert) => row.table === activityLogTable));
  assert.ok(skipped.inserts.some((row: Insert) => row.table === documentsTable));
  assert.equal(skipped.inserts.some((row: Insert) => row.table === bankStatementExtractionsTable), false);
  assert.equal(skipped.inserts.some((row: Insert) => row.table === usersTable), false);
});

test("scrub A migration dry-run discovers the append-only 001–022 set without writing", async () => {
  const migrations = await discoverMigrations();
  assert.deepEqual(
    migrations.slice(0, 22).map(({ name }) => name.match(/^\d+/)?.[0]),
    Array.from({ length: 22 }, (_, index) => String(index + 1).padStart(3, "0")),
  );

  let transactionCalls = 0;
  const database = {
    async execute() {
      return { rows: [] };
    },
    async transaction<T>(_callback: (tx: { execute(): Promise<{ rows: never[] }> }) => Promise<T>): Promise<T> {
      transactionCalls++;
      throw new Error("dry run must not write");
    },
  };
  const report = await getMigrationStatus({ db: database });
  assert.deepEqual(report.pending, migrations.map(({ name }) => name));
  assert.equal(report.applied.length, 0);
  assert.equal(report.failed, null);
  assert.equal(transactionCalls, 0);
});

test("scrub A selected-package preview has no submission write path", async () => {
  let packageConfigWrites = 0;
  let submissionWrites = 0;
  const lead = { id: 42, assignedRepId: 7, companyName: "Fixture Co" };
  const handler = createSelectedLenderPackageHandler({
    database: {
      query: {
        leadsTable: { findFirst: async () => lead },
        applicationsTable: {
          findFirst: async () => ({
            id: 99, leadId: 42, type: "working_capital", businessName: "Fixture Co",
            ownerFirstName: "Jamie", ownerLastName: "Applicant", submittedAt: new Date(),
            signatureMethod: "typed", signatureData: "Jamie Applicant", signatureSignedAt: new Date(),
          }),
        },
        usersTable: { findFirst: async () => ({ id: 7, name: "Fixture Rep", email: null, role: "rep", mobileNumber: null }) },
        documentsTable: { findMany: async () => [] },
        lenderSubmissionsTable: {
          findFirst: async () => {
            submissionWrites++;
            throw new Error("preview must not read submissions");
          },
        },
      },
      update: () => ({
        set: () => ({
          where: async () => { packageConfigWrites++; },
        }),
      }),
      insert: () => {
        submissionWrites++;
        throw new Error("preview must not insert a submission");
      },
      transaction: async () => {
        submissionWrites++;
        throw new Error("preview must not start a submission transaction");
      },
    } as never,
    authenticate: async () => ({ id: 7, role: "rep" } as never),
    activityLogger: async () => undefined,
    auditPiiAccess: () => undefined,
  });
  const response = responseFixture();
  await handler({
    params: { id: "42" },
    body: { sections: [], documentIds: [], options: { includeFooter: false } },
    ip: "127.0.0.1",
  } as never, response as never);
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["Content-Type"]), /application\/pdf/);
  assert.equal(packageConfigWrites, 1, "preview may save the builder selection");
  assert.equal(submissionWrites, 0, "preview cannot create or inspect submissions");
});

test("scrub A package-config route persists, returns, and resets selection in an isolated repository", async () => {
  let packageConfig: unknown = null;
  const lead = { id: 42, assignedRepId: 7, packageConfig };
  const database = {
    query: { leadsTable: { findFirst: async () => ({ ...lead, packageConfig }) } },
    update: () => ({
      set: (values: { packageConfig: unknown }) => ({
        where: async () => { packageConfig = values.packageConfig; },
      }),
    }),
  };
  const handler = createLenderPackageConfigHandler({
    database: database as never,
    authenticate: async () => ({ id: 7, role: "rep" } as never),
  });
  const selection = { sections: ["application"], documentIds: [12], options: { includeFooter: false } };
  const saved = responseFixture();
  await handler({ method: "PUT", params: { id: "42" }, body: selection } as never, saved as never);
  assert.deepEqual(saved.body, { packageConfig: selection });

  const loaded = responseFixture();
  await handler({ method: "GET", params: { id: "42" } } as never, loaded as never);
  assert.deepEqual(loaded.body, { packageConfig: selection });

  const reset = responseFixture();
  await handler({ method: "DELETE", params: { id: "42" } } as never, reset as never);
  assert.equal(reset.statusCode, 204);
  const reopened = responseFixture();
  await handler({ method: "GET", params: { id: "42" } } as never, reopened as never);
  assert.deepEqual(reopened.body, { packageConfig: null });
});

test("scrub A administrator can override a recent lender submission and records the submission activity", async () => {
  let duplicateLookups = 0;
  let inserts = 0;
  const activities: Array<{ action: string; details?: Record<string, unknown> }> = [];
  const database = {
    query: {
      leadsTable: { findFirst: async () => ({ id: 42, assignedRepId: 7, companyName: "Fixture Co", requestedAmount: 100_000 }) },
      lendersTable: { findFirst: async () => ({
        id: 5, name: "Fixture Lender", contactEmail: "underwriter@fixture.invalid", isActive: true,
        createdAt: new Date(), updatedAt: new Date(),
      }) },
      lenderSubmissionsTable: {
        findFirst: async () => {
          duplicateLookups++;
          throw new Error("an administrator override must not read the duplicate gate");
        },
      },
      applicationsTable: {
        findFirst: async () => ({
          id: 99, leadId: 42, type: "working_capital", businessName: "Fixture Co",
          requestedAmount: 100_000, signatureMethod: "typed", signatureData: "Jamie Applicant",
          signatureSignedAt: new Date(),
        }),
      },
      dealsTable: { findMany: async () => [] },
      usersTable: { findFirst: async () => ({ id: 7, name: "Fixture Rep", email: "rep@fixture.invalid", role: "rep" }) },
      documentsTable: { findMany: async () => [] },
      emailTemplatesTable: { findFirst: async () => ({ id: 12, name: "Lender Submission", isActive: true, bodyHtml: "<p>Fixture</p>" }) },
    },
    async transaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
      const tx = {
        insert: () => ({
          values: () => ({
            returning: async () => {
              inserts++;
              return inserts === 1
                ? [{ id: 8, leadId: 42, stage: "submitted" }]
                : [{ id: 31, leadId: 42, dealId: 8, lenderId: 5, sentBy: 1, status: "submitted", sentAt: new Date(), updatedAt: new Date() }];
            },
          }),
        }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      };
      return callback(tx);
    },
  };
  const handler = createSubmissionHandler({
    database: database as never,
    authenticate: async () => ({ id: 1, role: "admin" } as never),
    buildPackage: async () => ({ pdf: Buffer.from("%PDF-override"), exclusions: [] }),
    sendEmail: async () => ({ send: { sendgridMessageId: "sg-override" } }),
    getBaseUrl: () => "https://fixture.invalid",
    storeExactPackage: async () => undefined,
    acquireSubmissionLock: async () => async () => undefined,
    deliveryReceipt: {
      reserve: async () => ({ id: 1 }),
      markSent: async () => undefined,
      markSubmitted: async () => undefined,
      markFailed: async () => undefined,
      markUncertain: async () => undefined,
    },
    auditPiiAccess: () => undefined,
    recordActivity: async (event: { action: string; details?: Record<string, unknown> }) => {
      activities.push(event);
    },
  });
  const response = responseFixture();
  await handler({
    params: { id: "42" },
    body: { lender_id: 5, admin_override: true },
    ip: "127.0.0.1",
  } as never, response as never);
  assert.equal(response.statusCode, 201);
  assert.equal(duplicateLookups, 0);
  assert.deepEqual(activities.map(({ action }) => action), ["lender_submitted"]);
  assert.equal(activities[0]?.details?.adminOverride, true);
});