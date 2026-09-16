import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://lender-submission-route.invalid/test";

const { createSubmissionHandler, createUpdateSubmissionHandler } =
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

function makeDependencies(fixture: ReturnType<typeof makeDatabase>, user = { id: 7, role: "rep" }) {
  const sent: any[] = [];
  return {
    sent,
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
    },
  };
}

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