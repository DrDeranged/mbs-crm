import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";

type TestLead = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  companyName: string;
  ein: string | null;
  applicationType: "working_capital";
  status: "new_lead";
  assignedRepId: number;
  leadSource: "manual";
  isUnsubscribed: boolean;
  requestedAmount: number | null;
  lastActivityAt: Date | null;
  leadScore: number | null;
  leadScoreBreakdown: null;
  aiSummary: null;
  aiSummaryGeneratedAt: null;
  fundedAt: null;
  fundedAmount: null;
  estimatedTermMonths: null;
  renewalFlaggedAt: null;
  trackingToken: null;
  createdAt: Date;
  updatedAt: Date;
  assignedRep: TestUser;
};

type TestUser = {
  id: number;
  clerkId: string;
  name: string;
  email: string;
  slug: string | null;
  role: "rep";
  isActive: true;
  mobileNumber: null;
  createdAt: Date;
};

type Activity = { createdAt: Date; user: null };

function queryBuilder(result: () => unknown[], onWhere?: (where: unknown) => void) {
  return {
    from(..._args: unknown[]) {
      return this;
    },
    where(...args: unknown[]) {
      onWhere?.(args[0]);
      return this;
    },
    orderBy(..._args: unknown[]) {
      return this;
    },
    limit(..._args: unknown[]) {
      return this;
    },
    offset(..._args: unknown[]) {
      return this;
    },
    then(resolve: any, reject: any) {
      return Promise.resolve(result()).then(resolve, reject);
    },
  };
}

test("GET /api/leads?stale=true returns only stale assigned leads for an admin", async () => {
  // The route imports the production database module, which only needs a
  // connection string to construct its pool. No query is made against it.
  process.env.DATABASE_URL ??= "postgresql://integration-test.invalid/test";
  const { createListLeadsHandler } = await import("../routes/leads");

  const now = Date.now();
  const thresholdDays = 7;
  const rep: TestUser = {
    id: 42,
    clerkId: "rep-clerk-id",
    name: "Assigned Rep",
    email: "rep@example.com",
    slug: null,
    role: "rep",
    isActive: true,
    mobileNumber: null,
    createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
  };
  const oldLead: TestLead = {
    id: 101,
    firstName: "Old",
    lastName: "Lead",
    email: "old@example.com",
    phone: null,
    companyName: "Old Company",
    ein: null,
    applicationType: "working_capital",
    status: "new_lead",
    assignedRepId: rep.id,
    leadSource: "manual",
    isUnsubscribed: false,
    requestedAmount: null,
    lastActivityAt: null,
    leadScore: null,
    leadScoreBreakdown: null,
    aiSummary: null,
    aiSummaryGeneratedAt: null,
    fundedAt: null,
    fundedAmount: null,
    estimatedTermMonths: null,
    renewalFlaggedAt: null,
    trackingToken: null,
    createdAt: new Date(now - 14 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(now - 14 * 24 * 60 * 60 * 1000),
    assignedRep: rep,
  };
  const recentLead: TestLead = {
    ...oldLead,
    id: 102,
    firstName: "Recent",
    lastName: "Lead",
    email: "recent@example.com",
    companyName: "Recent Company",
    createdAt: new Date(now - 14 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(now - 1 * 24 * 60 * 60 * 1000),
  };
  const leads = [oldLead, recentLead];
  const latestActivities = new Map<number, Activity>([
    [recentLead.id, { createdAt: new Date(now - 1 * 24 * 60 * 60 * 1000), user: null }],
  ]);
  const cutoff = now - thresholdDays * 24 * 60 * 60 * 1000;
  let idPhaseCalls = 0;
  let totalCalls = 0;
  let hydrationCalls = 0;
  let idPhaseHadWhereClause = false;
  let idPhaseIds = [oldLead.id];

  const fakeDatabase = {
    select(fields: Record<string, unknown>) {
      const idPhase = Object.hasOwn(fields, "id");
      if (idPhase) idPhaseCalls++;
      else totalCalls++;
      return queryBuilder(() => {
        if (!idPhase) {
          return [{
            total: leads.filter((lead) => {
              const activityAt = latestActivities.get(lead.id)?.createdAt.getTime() ?? lead.createdAt.getTime();
              return lead.assignedRepId !== null && activityAt < cutoff;
            }).length,
          }];
        }
        idPhaseIds = leads
          .filter((lead) => {
            const activityAt = latestActivities.get(lead.id)?.createdAt.getTime() ?? lead.createdAt.getTime();
            return lead.assignedRepId !== null && activityAt < cutoff;
          })
          .map((lead) => lead.id);
        return idPhaseIds.map((id) => ({ id }));
      }, (where) => {
        if (idPhase) idPhaseHadWhereClause = where !== undefined;
      });
    },
    query: {
      leadsTable: {
        async findMany(..._args: unknown[]) {
          hydrationCalls++;
          return idPhaseIds.map((id) => leads.find((lead) => lead.id === id)).filter(Boolean);
        },
      },
    },
  };

  const admin = {
    id: 1,
    clerkId: "admin-clerk-id",
    name: "Admin",
    email: "admin@example.com",
    slug: null,
    role: "admin",
    isActive: true,
    mobileNumber: null,
    createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
  } as any;
  let authCalls = 0;
  const app = express();
  app.use("/api", express.Router().get(
    "/leads",
    createListLeadsHandler({
      database: fakeDatabase as any,
      authenticate: async (_req: any, _res: any) => {
        authCalls++;
        return admin;
      },
      getStaleThresholdDays: async () => thresholdDays,
      getLatestActivities: async () => latestActivities,
      getLeadCreationActivities: async () => new Map(),
    }),
  ));

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/leads?stale=true`);
    const body = await response.json() as { leads: Array<{ id: number }>; total: number };

    assert.equal(response.status, 200);
    assert.equal(authCalls, 1);
    assert.equal(idPhaseCalls, 1);
    assert.equal(idPhaseHadWhereClause, true);
    assert.equal(totalCalls, 1);
    assert.equal(hydrationCalls, 1);
    assert.deepEqual(body.leads.map((lead) => lead.id), [oldLead.id]);
    assert.equal(body.total, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});