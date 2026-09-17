import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createSaveDealRatePointsHandler, createUpdateDealHandler } from "../routes/deals";

process.env.DATABASE_URL ??= "postgresql://integration-test.invalid/test";

function makeDeal() {
  const now = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: 7,
    leadId: null,
    dealName: "Atomic Deal",
    stage: "submitted",
    amount: 10000,
    approxGm: 1000,
    actualGm: null,
    notes: "old",
    gmSplitPct: 50,
    assignedTo: null,
    intendedRepSlug: null,
    createdAt: now,
    updatedAt: now,
    fundedAt: null,
    isArchived: false,
  };
}

async function requestUpdate(
  database: any,
  body: Record<string, unknown>,
  failActivity = false,
) {
  const app = express();
  app.use(express.json());
  app.put(
    "/deals/:id",
    createUpdateDealHandler({
      database,
      authenticate: async () =>
        ({
          id: 3,
          role: "admin",
          assignedTo: null,
        }) as any,
    }),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not start");
  try {
    return await fetch(`http://127.0.0.1:${address.port}/deals/7`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function fakeDatabase(options: { failActivity?: boolean } = {}) {
  let persisted = makeDeal();
  const activities: any[] = [];
  const database = {
    query: {
      dealsTable: {
        findFirst: async () => persisted,
      },
    },
    transaction: async (callback: (tx: any) => Promise<any>) => {
      const before = persisted;
      const activityCount = activities.length;
      try {
        return await callback({
          update: () => ({
            set: (changes: any) => ({
              where: () => ({
                returning: async () => {
                  persisted = { ...persisted, ...changes };
                  return [persisted];
                },
              }),
            }),
          }),
          insert: () => ({
            values: async (activity: any) => {
              if (options.failActivity) throw new Error("activity insert failed");
              activities.push(activity);
            },
          }),
        });
      } catch (error) {
        persisted = before;
        activities.length = activityCount;
        throw error;
      }
    },
  };
  return { database, getDeal: () => persisted, activities };
}

test("Express deal update persists notes and exactly one notes_updated activity", async () => {
  const fixture = fakeDatabase();
  const response = await requestUpdate(fixture.database, { notes: "new note" });
  assert.equal(response.status, 200);
  assert.equal(fixture.getDeal().notes, "new note");
  assert.equal(
    fixture.activities.filter((activity) => activity.action === "notes_updated").length,
    1,
  );
});

test("deal update rolls back notes when activity logging fails", async () => {
  const fixture = fakeDatabase({ failActivity: true });
  const response = await requestUpdate(fixture.database, { notes: "must roll back" });
  assert.equal(response.status, 500);
  assert.equal(fixture.getDeal().notes, "old");
  assert.equal(fixture.activities.length, 0);
});

test("rate points save updates the correct GM field and writes complete activity in one transaction", async () => {
  for (const stage of ["submitted", "funded"]) {
    const fixture = fakeDatabase();
    fixture.getDeal().stage = stage;
    const activities: any[] = [];
    let activityTx: any;
    const app = express();
    app.use(express.json());
    app.post("/deals/:id/rate-points", createSaveDealRatePointsHandler({
      database: fixture.database,
      authenticate: async () => ({ id: 3, role: "admin", assignedTo: null }) as any,
      recordActivity: async (activity: any, tx: any) => {
        activityTx = tx;
        activities.push(activity);
      },
    }));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not start");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/deals/7/rate-points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advance: 28080, payment: 1735.69, term: 24, timing: "arrears",
          buyNominalRate: 0.18, mode: "spread", sourceApprovalId: null,
        }),
      });
      assert.equal(response.status, 200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    assert.equal(fixture.getDeal()[stage === "funded" ? "actualGm" : "approxGm"]?.toFixed(2), "8011.71");
    assert.equal(fixture.getDeal()[stage === "funded" ? "approxGm" : "actualGm"], stage === "funded" ? 1000 : null);
    assert.equal(activities[0].action, "rate_points_saved");
    assert.equal(activities[0].details.advance, 28080);
    assert.equal(activities[0].details.nominalRate > 0, true);
    assert.equal(activities[0].details.sourceApprovalId, null);
    assert.ok(activityTx);
  }
});