import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { and, eq } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://scrub-round2.invalid/test";

test("rep performance keeps active reps plus historical owners and falls back to the email name", async () => {
  const { db, usersTable } = await import("@workspace/db");
  const { activeRepListingCondition } = await import("./analyticsHelpers");
  const { createListAnalyticsRepsHandler } = await import("../routes/analytics");
  const now = new Date("2025-01-01T00:00:00.000Z");
  const activeRep = { id: 7, name: null, email: "jane.doe@example.test", role: "rep", isActive: true, createdAt: now, updatedAt: now };
  const historicOwner = { id: 8, name: "Owner Admin", email: "owner@example.test", role: "admin", isActive: true, createdAt: now, updatedAt: now };
  const excludedAdmin = { id: 9, name: "No History", email: "no-history@example.test", role: "admin", isActive: true, createdAt: now, updatedAt: now };
  const inactiveRep = { id: 10, name: "Inactive", email: "inactive@example.test", role: "rep", isActive: false, createdAt: now, updatedAt: now };
  let usersWhere: unknown;
  function query(fields?: unknown) {
    let table: unknown;
    const builder: any = {
      from(source: unknown) { table = source; return builder; },
      where(condition: unknown) { if (table === usersTable && fields === undefined) usersWhere = condition; return builder; },
      groupBy() { return builder; },
      then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
        const rows = table === usersTable && fields === undefined ? [activeRep, historicOwner] : [];
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return builder;
  }
  const fakeDatabase = {
    select(fields?: unknown) {
      // The actual helper constructs correlated lead/deal subqueries through
      // this collaborator; retain the real Drizzle builder for those.
      if (fields && typeof fields === "object" && Object.hasOwn(fields, "id")) return db.select(fields as any);
      return query(fields);
    },
  };
  const app = express();
  app.get("/analytics/reps", createListAnalyticsRepsHandler({
    database: fakeDatabase as any,
    authenticate: async () => ({ ...activeRep, role: "admin" }) as any,
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/analytics/reps`);
    assert.equal(response.status, 200);
    const body = await response.json() as Array<{ repId: number; repName: string }>;
    assert.deepEqual(
      body.map(({ repId, repName }) => ({ repId, repName })),
      [{ repId: 7, repName: "Jane Doe" }, { repId: 8, repName: "Owner Admin" }],
    );
    const actualSql = db.select().from(usersTable).where(usersWhere as any).toSQL().sql;
    const expectedSql = db.select().from(usersTable).where(activeRepListingCondition(db)).toSQL().sql;
    assert.equal(actualSql, expectedSql);
    assert.match(actualSql, /exists/i);
    assert.doesNotMatch(JSON.stringify(body), /No History|Inactive/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("average funding time's production predicate rejects cycles under 24 hours", async () => {
  const { db, leadStatusHistoryTable, leadsTable } = await import("@workspace/db");
  const { fundingTimeEligibilityWhere } = await import("../routes/analytics");
  const query = db
    .select()
    .from(leadStatusHistoryTable)
    .innerJoin(leadsTable, eq(leadStatusHistoryTable.leadId, leadsTable.id))
    .where(fundingTimeEligibilityWhere());
  const compiled = query.toSQL().sql;
  assert.match(compiled, /interval '24 hours'/i);
  assert.doesNotMatch(compiled, /interval '5 minutes'/i);
});

test("deal export HTTP handler retains representative ownership scope while admins can select a representative", async () => {
  const { db, dealsTable } = await import("@workspace/db");
  const { createExportDealsHandler, exportDealScopeConditions } = await import("../routes/deals");
  const repScope = db
    .select()
    .from(dealsTable)
    .where(and(...exportDealScopeConditions({ id: 7, role: "rep" } as any, { rep_id: 999 })))
    .toSQL();
  assert.deepEqual(repScope.params, [false, 7]);
  const managerScope = db
    .select()
    .from(dealsTable)
    .where(and(...exportDealScopeConditions({ id: 1, role: "admin" } as any, { rep_id: 999 })))
    .toSQL();
  assert.deepEqual(managerScope.params, [false, 999]);

  let handlerWhere: unknown;
  const handler = createExportDealsHandler({
    authenticate: async () => ({ id: 7, role: "rep" } as any),
    database: {
      transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
        execute: async () => undefined,
        query: {
          dealsTable: {
            findMany: async ({ where }: { where: unknown }) => {
              handlerWhere = where;
              return [];
            },
          },
        },
      }),
    } as any,
    recordActivity: async () => undefined,
  });
  const response: any = {
    destroyed: false,
    status: () => response,
    setHeader: () => response,
    flushHeaders: () => undefined,
    write: () => true,
    end: () => undefined,
  };
  await handler({ query: { rep_id: "999" } } as any, response);
  const handlerSql = db.select().from(dealsTable).where(handlerWhere as any).toSQL();
  assert.deepEqual(handlerSql.params, [false, 7]);
});

test("retired public rep slugs use a permanent canonical redirect while unknown slugs stay generic", async () => {
  const { createPublicRepResolverRouter } = await import("../routes/repPublic");
  const app = express();
  app.use(createPublicRepResolverRouter({
    resolve: async (slug) => slug === "retired"
      ? { user: { name: "New Rep", email: "new@example.test", mobileNumber: null, slug: "new-rep" }, replacementSlug: "new-rep" }
      : { user: null, replacementSlug: null },
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const retired = await fetch(`http://127.0.0.1:${address.port}/public/reps/retired`, { redirect: "manual" });
    assert.equal(retired.status, 301);
    assert.match(retired.headers.get("location") ?? "", /\/api\/public\/reps\/new-rep$/);
    const unknown = await fetch(`http://127.0.0.1:${address.port}/public/reps/unknown`);
    assert.equal(unknown.status, 200);
    assert.deepEqual(await unknown.json(), { name: null, phone: null, slug: null });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("lender packages select statements only from their persisted category, never their filename", async () => {
  const { selectLenderPackageDocuments } = await import("./lenderPackage");
  const createdAt = new Date("2025-01-01T00:00:00.000Z");
  const documents = [
    { id: 1, filename: "January_Bank_Statement.pdf", fileKey: "/objects/1", fileType: "application/pdf", category: "other", createdAt },
    { id: 2, filename: "upload.pdf", fileKey: "/objects/2", fileType: "application/pdf", category: "bank_statement", createdAt },
  ];
  assert.deepEqual(selectLenderPackageDocuments(documents as any).map((document) => document.id), [2]);
});

test("submission's actual handler refuses a same lender/lead submission inside 24 hours before building or sending", async () => {
  const { createSubmissionHandler } = await import("../routes/lenders");
  let built = false;
  const handler = createSubmissionHandler({
    authenticate: async () => ({ id: 7, role: "rep" } as any),
    acquireSubmissionLock: async () => async () => undefined,
    buildPackage: async () => { built = true; return { pdf: Buffer.from("%PDF"), exclusions: [] }; },
    database: {
      query: {
        leadsTable: { findFirst: async () => ({ id: 42, assignedRepId: 7 }) },
        lendersTable: { findFirst: async () => ({ id: 5, isActive: true, contactEmail: "underwriter@example.test" }) },
        lenderSubmissionsTable: { findFirst: async () => ({ id: 30, sentAt: new Date() }) },
      },
    },
  });
  const response: any = {
    statusCode: 200,
    status(code: number) { response.statusCode = code; return response; },
    json(body: unknown) { response.body = body; return response; },
  };
  await handler({ params: { id: "42" }, body: { lender_id: 5 }, log: { error() {} } } as any, response);
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.reason, "duplicate_24h");
  assert.equal(built, false);
});