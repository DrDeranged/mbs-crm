import assert from "node:assert/strict";
import test from "node:test";
import type { LenderSubmissionRouteDependencies } from "../routes/lenders";

process.env.DATABASE_URL ??= "postgresql://lender-submission-route.invalid/test";

const { createDownloadSubmissionPackageHandler, createSubmissionHandler, createUpdateSubmissionHandler } =
  await import("../routes/lenders");

const now = new Date("2025-01-02T12:00:00.000Z");

function lead(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    firstName: "Owner",
    lastName: "Example",
    companyName: "Example Holdings",
    requestedAmount: 125000,
    assignedRepId: 7,
    ...overrides,
  };
}

function application() {
  return {
    id: 99,
    leadId: 42,
    type: "working_capital",
    businessName: "Example Holdings",
    requestedAmount: 125000,
    signatureMethod: "typed",
    signatureData: "Owner Example",
    signatureSignedAt: new Date("2025-01-02T11:00:00.000Z"),
  };
}

function lender() {
  return {
    id: 5,
    name: "Trusted Capital",
    contactEmail: "underwriter@trusted.test",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

function rep() {
  return {
    id: 7,
    name: "Assigned Rep",
    email: "assigned.rep@mbs.test",
    mobileNumber: "555-0100",
  };
}

function emailTemplate() {
  return {
    id: 12,
    name: "Lender Submission",
    isActive: true,
    bodyHtml: "<p>{{lead_company}} for {{lender_name}}</p>",
  };
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: 31,
    leadId: 42,
    dealId: 8,
    lenderId: 5,
    sentBy: 7,
    messageId: "sg-old",
    status: "submitted",
    notes: "old notes",
    sentAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function response() {
  const result = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      result.statusCode = code;
      return result;
    },
    json(body: unknown) {
      result.body = body;
      return result;
    },
  };
  return result;
}

function request(body: Record<string, unknown>, params = { id: "42" }) {
  return { body, params };
}

function makeDatabase(options: {
  assignedLead?: ReturnType<typeof lead>;
  recentSubmission?: unknown;
  existingSubmission?: ReturnType<typeof submission>;
  existingDeal?: Record<string, unknown> | null;
  transactionFails?: boolean;
} = {}) {
  let currentDeal = options.existingDeal ?? null;
  let currentSubmission = options.existingSubmission ?? null;
  const activities: Array<{ params: any; executor: unknown }> = [];
  const transactions: any[] = [];
  let insertCount = 0;

  const database = {
    query: {
      leadsTable: {
        findFirst: async () => options.assignedLead ?? lead(),
      },
      lendersTable: {
        findFirst: async () => lender(),
      },
      lenderSubmissionsTable: {
        findFirst: async () => options.recentSubmission ?? currentSubmission,
      },
      applicationsTable: {
        findFirst: async () => application(),
      },
      dealsTable: {
        findMany: async () => currentDeal ? [currentDeal] : [],
      },
      usersTable: {
        findFirst: async () => rep(),
      },
      documentsTable: {
        findMany: async () => [],
      },
      emailTemplatesTable: {
        findFirst: async () => emailTemplate(),
      },
    },
    transaction: async (callback: (tx: any) => Promise<unknown>) => {
      if (options.transactionFails) throw new Error("transaction unavailable");
      const transaction = {
        insert: () => ({
          values: (values: Record<string, unknown>) => ({
            returning: async () => {
              insertCount++;
              if (insertCount === 1 && !currentDeal) {
                currentDeal = {
                  id: 8,
                  leadId: values.leadId,
                  dealName: values.dealName,
                  stage: values.stage,
                  amount: values.amount,
                  assignedTo: values.assignedTo,
                  isArchived: false,
                  updatedAt: now,
                };
                return [currentDeal];
              }
              currentSubmission = {
                ...submission(),
                ...values,
                id: 31,
                sentAt: now,
                updatedAt: now,
              };
              return [currentSubmission];
            },
          }),
        }),
        update: () => ({
          set: (changes: Record<string, unknown>) => {
            return {
              where: () => {
                let row: any[] = [];
                if (changes.stage !== undefined && currentDeal) {
                  Object.assign(currentDeal, changes);
                  row = [currentDeal];
                } else if (currentSubmission) {
                  currentSubmission = { ...currentSubmission, ...changes };
                  row = [currentSubmission];
                }
                return {
                  returning: async () => row,
                };
              },
            };
          },
        }),
      };
      transactions.push(transaction);
      return callback(transaction);
    },
  };

  return {
    database,
    activities,
    transactions,
    getDeal: () => currentDeal,
    getSubmission: () => currentSubmission,
    recordActivity: async (params: any, executor: unknown) => {
      activities.push({ params, executor });
      return undefined;
    },
  };
}

function makeDependencies(fixture: ReturnType<typeof makeDatabase>, user = { id: 7, role: "rep" }): { sent: any[]; audits: any[]; dependencies: LenderSubmissionRouteDependencies } {
  const sent: any[] = [];
  const audits: any[] = [];
  let activeDelivery = false;
  let nextReceipt = 1;
  return {
    sent,
    audits,
    dependencies: {
      database: fixture.database,
      authenticate: async () => user as any,
      buildPackage: async () => ({
        pdf: Buffer.from("%PDF-built-by-test"),
        exclusions: [],
      }),
      sendEmail: async (params: any) => {
        sent.push(params);
        return { send: { sendgridMessageId: "sg-test-message" } };
      },
      getBaseUrl: () => "https://crm.test",
      recordActivity: fixture.recordActivity,
      notify: async () => undefined,
      storeExactPackage: async (_key: string, _bytes: Buffer) => undefined,
      acquireSubmissionLock: async () => async () => undefined,
      auditPiiAccess: (params: any) => { audits.push(params); },
      deliveryReceipt: {
        reserve: async () => {
          if (activeDelivery) return null;
          activeDelivery = true;
          return { id: nextReceipt++ };
        },
        markSent: async () => undefined,
        markSubmitted: async () => { activeDelivery = false; },
        markFailed: async () => { activeDelivery = false; },
        markUncertain: async () => undefined,
      },
    },
  };
}

test("submission request validation returns a named 400 before package work", async () => {
  const fixture = makeDatabase();
  const { dependencies, sent } = makeDependencies(fixture);
  const malformed = response();

  await createSubmissionHandler(dependencies)(
    request({ lender_id: 5, admin_override: "false" }) as any,
    malformed as any,
  );

  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.body, { error: "Invalid admin_override" });
  assert.equal(sent.length, 0);
});

test("a concurrent second submission is denied by the held advisory lock before email send", async () => {
  const fixture = makeDatabase();
  const { dependencies, sent } = makeDependencies(fixture);
  let held = false;
  let beginBuild!: () => void;
  let finishBuild!: () => void;
  const building = new Promise<void>((resolve) => { beginBuild = resolve; });
  const releaseBuild = new Promise<void>((resolve) => { finishBuild = resolve; });
  dependencies.acquireSubmissionLock = async () => {
    if (held) return null;
    held = true;
    return async () => { held = false; };
  };
  dependencies.buildPackage = async () => {
    beginBuild();
    await releaseBuild;
    return { pdf: Buffer.from("%PDF-concurrent"), exclusions: [] };
  };
  const firstResponse = response();
  const first = createSubmissionHandler(dependencies)(request({ lender_id: 5 }) as any, firstResponse as any);
  await building;
  const secondResponse = response();
  await createSubmissionHandler(dependencies)(request({ lender_id: 5 }) as any, secondResponse as any);
  assert.equal(secondResponse.statusCode, 409);
  assert.equal((secondResponse.body as any).reason, "submission_in_progress");
  assert.equal(sent.length, 0);
  finishBuild();
  await first;
  assert.equal(firstResponse.statusCode, 201);
  assert.equal(sent.length, 1);
  assert.equal(held, false);
});

test("a post-SendGrid transaction failure leaves a durable receipt and refuses a second email", async () => {
  const fixture = makeDatabase({ transactionFails: true });
  const { dependencies, sent } = makeDependencies(fixture);
  const first = response();
  await createSubmissionHandler(dependencies)(request({ lender_id: 5 }) as any, first as any);
  assert.equal(first.statusCode, 500);
  assert.equal(sent.length, 1);
  const retry = response();
  await createSubmissionHandler(dependencies)(request({ lender_id: 5 }) as any, retry as any);
  assert.equal(retry.statusCode, 409);
  assert.equal((retry.body as any).reason, "submission_delivery_pending");
  assert.equal(sent.length, 1);
});

test("a known SendGrid failure releases the receipt so a retry may send", async () => {
  const fixture = makeDatabase();
  const { dependencies, sent } = makeDependencies(fixture);
  let failed = true;
  dependencies.sendEmail = async (params: any) => {
    sent.push(params);
    return failed ? { send: null as any, error: "provider_rejected", configurationReason: "provider_rejected", deliveryOutcome: "definite_failure" } : { send: { sendgridMessageId: "sg-retry" } };
  };
  const first = response();
  await createSubmissionHandler(dependencies)(request({ lender_id: 5 }) as any, first as any);
  assert.equal(first.statusCode, 502);
  failed = false;
  const retry = response();
  await createSubmissionHandler(dependencies)(request({ lender_id: 5 }) as any, retry as any);
  assert.equal(retry.statusCode, 201);
  assert.equal(sent.length, 2);
});

test("a thrown network error leaves an uncertain receipt and blocks a second email", async () => {
  const fixture = makeDatabase();
  const { dependencies, sent } = makeDependencies(fixture);
  dependencies.sendEmail = async (params: any) => {
    sent.push(params);
    throw new Error("ETIMEDOUT");
  };
  const first = response();
  await createSubmissionHandler(dependencies)(request({ lender_id: 5 }) as any, first as any);
  assert.equal(first.statusCode, 502);
  assert.equal((first.body as any).reason, "send_outcome_uncertain");
  const retry = response();
  await createSubmissionHandler(dependencies)(request({ lender_id: 5 }) as any, retry as any);
  assert.equal(retry.statusCode, 409);
  assert.equal((retry.body as any).reason, "submission_delivery_pending");
  assert.equal(sent.length, 1);
});

test("submission lock is released when immutable package storage fails before email", async () => {
  const fixture = makeDatabase();
  const { dependencies, sent, audits } = makeDependencies(fixture);
  let releases = 0;
  dependencies.acquireSubmissionLock = async () => async () => { releases++; };
  dependencies.storeExactPackage = async () => { throw new Error("storage failure"); };
  const res = response();
  await createSubmissionHandler(dependencies)(request({ lender_id: 5 }) as any, res as any);
  assert.equal(res.statusCode, 500);
  assert.equal(releases, 1);
  assert.equal(sent.length, 0);
});

test("submission re-download returns the immutable stored bytes after verifying its hash", async () => {
  const packageBytes = Buffer.from("%PDF-exact-snapshot");
  const hash = (await import("node:crypto")).createHash("sha256").update(packageBytes).digest("hex");
  const fixture = makeDatabase({ existingSubmission: submission({ exactPackageKey: "lender-submissions/42/snapshot.pdf", exactPackageSha256: hash, exactPackageBytes: packageBytes.length }) });
  const audits: any[] = [];
  const res: any = response();
  res.headers = {};
  res.setHeader = (name: string, value: string) => { res.headers[name] = value; };
  res.send = (body: unknown) => { res.body = body; };
  await createDownloadSubmissionPackageHandler({
    database: fixture.database,
    authenticate: async () => ({ id: 7, role: "rep" } as any),
    downloadExactPackage: async () => packageBytes,
    recordActivity: fixture.recordActivity,
    auditPiiAccess: (params: any) => { audits.push(params); },
  })(request({}, { id: "31" }) as any, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, packageBytes);
  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.deepEqual(fixture.activities[0]?.params.details, { packageSections: null, packageDocumentIds: null, ssnUnmasked: false });
  assert.deepEqual(audits[0]?.metadata, { sections: null, documentIds: null, options: null, ssnUnmasked: false });
});

test("submission stores exactly the emailed attachment with config/hash metadata before immutable re-download", async () => {
  const fixture = makeDatabase();
  const { dependencies, sent, audits } = makeDependencies(fixture);
  const stored: Array<{ key: string; bytes: Buffer }> = [];
  dependencies.storeExactPackage = async (key: string, bytes: Buffer) => { stored.push({ key, bytes }); };
  const res = response();
  const config = { sections: ["application", "bank_statement"], documentIds: [], options: { maskSsn: true } };
  await createSubmissionHandler(dependencies)(request({ lender_id: 5, package_config: config }) as any, res as any);
  assert.equal(res.statusCode, 201);
  assert.equal(stored.length, 1);
  const snapshot = stored[0]!;
  assert.match(snapshot.key, /^\/objects\/lender-submissions\/42\//);
  assert.deepEqual(Buffer.from(sent[0].attachments[0].content, "base64"), snapshot.bytes);
  assert.equal((fixture.getSubmission() as any)?.exactPackageSha256, (await import("node:crypto")).createHash("sha256").update(snapshot.bytes).digest("hex"));
  assert.deepEqual((fixture.getSubmission() as any)?.packageConfigSnapshot, config);
  assert.deepEqual(audits[0]?.metadata, { sections: config.sections, documentIds: config.documentIds, options: config.options, ssnUnmasked: false });
  const downloadRes: any = response();
  downloadRes.setHeader = () => undefined;
  downloadRes.send = (body: Buffer) => { downloadRes.body = body; };
  await createDownloadSubmissionPackageHandler({ database: fixture.database, authenticate: async () => ({ id: 7, role: "rep" } as any), downloadExactPackage: async () => snapshot.bytes, recordActivity: async () => undefined })(request({}, { id: "31" }) as any, downloadRes);
  assert.deepEqual(downloadRes.body, snapshot.bytes);
});

test("a rep cannot download an immutable snapshot that was explicitly unmasked", async () => {
  const fixture = makeDatabase({ existingSubmission: submission({ packageConfigSnapshot: { options: { maskSsn: false } }, exactPackageKey: "/objects/lender-submissions/42/unmasked.pdf", exactPackageSha256: "a".repeat(64) }) });
  const res = response();
  await createDownloadSubmissionPackageHandler({ database: fixture.database, authenticate: async () => ({ id: 7, role: "rep" } as any), downloadExactPackage: async () => { throw new Error("must not be read"); } })(request({}, { id: "31" }) as any, res as any);
  assert.equal(res.statusCode, 403);
  assert.match((res.body as any).error, /Only administrators/);
});

test("exact-package download refuses a corrupt stored object", async () => {
  const expected = Buffer.from("%PDF-expected");
  const hash = (await import("node:crypto")).createHash("sha256").update(expected).digest("hex");
  const fixture = makeDatabase({ existingSubmission: submission({ exactPackageKey: "/objects/lender-submissions/42/snapshot.pdf", exactPackageSha256: hash, exactPackageBytes: expected.length }) });
  const res = response();
  await createDownloadSubmissionPackageHandler({ database: fixture.database, authenticate: async () => ({ id: 7, role: "rep" } as any), downloadExactPackage: async () => Buffer.from("%PDF-corrupt") })(request({}, { id: "31" }) as any, res as any);
  assert.equal(res.statusCode, 409);
  assert.match((res.body as any).error, /integrity check/);
});

test("lender submission denies a rep with a lead assigned to another rep", async () => {
  const fixture = makeDatabase({ assignedLead: lead({ assignedRepId: 8 }) });
  const { dependencies } = makeDependencies(fixture);
  const res = response();

  await createSubmissionHandler(dependencies)(
    request({ lender_id: 5 }) as any,
    res as any,
  );

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "Forbidden" });
});

test("lender submission refuses a duplicate inside the rolling 24-hour window", async () => {
  const fixture = makeDatabase({ recentSubmission: submission({ sentAt: new Date() }) });
  const { dependencies } = makeDependencies(fixture);
  const res = response();

  await createSubmissionHandler(dependencies)(
    request({ lender_id: 5 }) as any,
    res as any,
  );

  assert.equal(res.statusCode, 409);
  assert.equal((res.body as any).reason, "duplicate_24h");
});

test("successful lender submission creates a Submitted deal when one is absent", async () => {
  const fixture = makeDatabase();
  const { dependencies } = makeDependencies(fixture);
  const res = response();

  await createSubmissionHandler(dependencies)(
    request({ lender_id: 5 }) as any,
    res as any,
  );

  assert.equal(res.statusCode, 201);
  assert.equal(fixture.getDeal()?.stage, "submitted");
  assert.equal(fixture.getDeal()?.leadId, 42);
  assert.equal(fixture.getSubmission()?.dealId, fixture.getDeal()?.id);
  assert.equal(fixture.getSubmission()?.status, "submitted");
  assert.deepEqual(
    fixture.activities.map(({ params }) => params.action),
    ["lender_submitted"],
  );
});

test("successful lender submission moves an existing active deal to Submitted and links its row", async () => {
  const fixture = makeDatabase({
    existingDeal: {
      id: 19,
      leadId: 42,
      dealName: "Existing Deal",
      stage: "waiting_on_app",
      amount: 125000,
      assignedTo: 7,
      isArchived: false,
      updatedAt: now,
    },
  });
  const { dependencies } = makeDependencies(fixture);
  const res = response();

  await createSubmissionHandler(dependencies)(
    request({ lender_id: 5 }) as any,
    res as any,
  );

  assert.equal(res.statusCode, 201);
  assert.equal(fixture.getDeal()?.id, 19);
  assert.equal(fixture.getDeal()?.stage, "submitted");
  assert.equal(fixture.getSubmission()?.dealId, 19);
  assert.deepEqual(
    fixture.activities.map(({ params }) => ({
      action: params.action,
      dealId: params.dealId,
    })),
    [{ action: "lender_submitted", dealId: 19 }],
  );
});

test("lender submission SendGrid mock receives the built PDF, recipient, rep CC, and exact subject", async () => {
  const fixture = makeDatabase();
  const { dependencies, sent } = makeDependencies(fixture);
  const res = response();

  await createSubmissionHandler(dependencies)(
    request({ lender_id: 5 }) as any,
    res as any,
  );

  assert.equal(res.statusCode, 201);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].toEmail, "underwriter@trusted.test");
  assert.equal(sent[0].ccEmail, "assigned.rep@mbs.test");
  assert.equal(
    sent[0].subject,
    "MBS Submission – Example Holdings – $125,000 – Working Capital",
  );
  assert.equal(
    sent[0].attachments[0].content,
    Buffer.from("%PDF-built-by-test").toString("base64"),
  );
  assert.equal(sent[0].attachments[0].type, "application/pdf");
  assert.equal(sent[0].attachments[0].disposition, "attachment");
});

test("submission status and notes changes persist with activity logging in one transaction", async () => {
  const existing = submission();
  const fixture = makeDatabase({ existingSubmission: existing });
  const { dependencies } = makeDependencies(fixture);
  const res = response();

  await createUpdateSubmissionHandler(dependencies)(
    {
      params: { id: "31" },
      body: { status: "approved", notes: "Approved by lender" },
    } as any,
    res as any,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(fixture.getSubmission()?.status, "approved");
  assert.equal(fixture.getSubmission()?.notes, "Approved by lender");
  assert.equal(fixture.transactions.length, 1);
  assert.ok(
    fixture.activities.every(({ executor }) => executor === fixture.transactions[0]),
    "all update activities must use the transaction executor",
  );
  assert.deepEqual(
    fixture.activities.map(({ params }) => params.action),
    ["lender_submission_status_changed", "lender_submission_notes_updated"],
  );
});