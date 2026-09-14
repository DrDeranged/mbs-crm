import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";

type FixtureUser = {
  id: number;
  clerkId: string;
  name: string;
  email: string;
  slug: string | null;
  role: "admin" | "manager" | "rep" | "pending";
  isActive: boolean;
  mobileNumber: string | null;
  pushToken: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function fixtureUser(
  id: number,
  name: string,
  role: FixtureUser["role"],
  isActive = true,
): FixtureUser {
  const now = new Date("2025-01-01T00:00:00.000Z");
  return {
    id,
    clerkId: `${name.toLowerCase().replaceAll(" ", "-")}-clerk`,
    name,
    email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
    slug: null,
    role,
    isActive,
    mobileNumber: null,
    pushToken: null,
    createdAt: now,
    updatedAt: now,
  };
}

test("GET /api/analytics/reps includes active reps and active users assigned leads or deals only", async () => {
  process.env.DATABASE_URL ??= "postgresql://integration-test.invalid/test";
  const { db, usersTable } = await import("@workspace/db");
  const { activeRepListingCondition } = await import("./analyticsHelpers");
  const { createListAnalyticsRepsHandler } = await import("../routes/analytics");

  const emptyRep = fixtureUser(1, "Empty Rep", "rep");
  const emptyAdmin = fixtureUser(2, "Empty Admin", "admin");
  const dealAdmin = fixtureUser(3, "Deal Admin", "admin");
  const inactiveRep = fixtureUser(4, "Inactive Rep", "rep", false);
  const fixtureUsers = [emptyRep, emptyAdmin, dealAdmin, inactiveRep];
  const fixtureDeals = [{ assignedTo: dealAdmin.id }];
  let handlerUsersWhere: unknown;

  function queryBuilder(fields: unknown) {
    let table: unknown;
    const builder: any = {
      from(source: unknown) {
        table = source;
        return builder;
      },
      where(condition: unknown) {
        if (table === usersTable && fields === undefined) handlerUsersWhere = condition;
        return builder;
      },
      groupBy(..._columns: unknown[]) {
        return builder;
      },
      orderBy(..._columns: unknown[]) {
        return builder;
      },
      then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
        const rows = table === usersTable && fields === undefined
          ? fixtureUsers.filter((candidate) =>
            candidate.isActive
            && (
              candidate.role === "rep"
              || fixtureDeals.some((deal) => deal.assignedTo === candidate.id)
            ))
          : [];
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return builder;
  }

  const fakeDatabase = {
    select(fields?: unknown) {
      if (fields && typeof fields === "object" && Object.keys(fields).length === 1 && Object.hasOwn(fields, "id")) {
        return db.select(fields as any);
      }
      return queryBuilder(fields);
    },
  };
  const app = express();
  app.use("/api", express.Router().get(
    "/analytics/reps",
    createListAnalyticsRepsHandler({
      database: fakeDatabase as any,
      authenticate: async () => emptyAdmin as any,
    }),
  ));

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/analytics/reps`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, [
      {
        repId: emptyRep.id,
        repName: emptyRep.name,
        leadsCount: 0,
        callsMade: 0,
        smsSent: 0,
        emailsSent: 0,
        applications: 0,
        approvals: 0,
        fundings: 0,
        revenue: 0,
      },
      {
        repId: dealAdmin.id,
        repName: dealAdmin.name,
        leadsCount: 0,
        callsMade: 0,
        smsSent: 0,
        emailsSent: 0,
        applications: 0,
        approvals: 0,
        fundings: 0,
        revenue: 0,
      },
    ]);

    assert(handlerUsersWhere);
    const handlerSql = db
      .select()
      .from(usersTable)
      .where(handlerUsersWhere as any)
      .toSQL()
      .sql;
    const expectedSql = db
      .select()
      .from(usersTable)
      .where(activeRepListingCondition(db))
      .toSQL()
      .sql;
    assert.equal(handlerSql, expectedSql);
    assert.match(handlerSql, /"users"\."is_active"/);
    assert.match(handlerSql, /"users"\."role"/);
    assert.match(handlerSql, /"leads"\."assigned_rep_id" = "users"\."id"/);
    assert.match(handlerSql, /"deals"\."assigned_to" = "users"\."id"/);
    assert.match(handlerSql, /exists/i);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
