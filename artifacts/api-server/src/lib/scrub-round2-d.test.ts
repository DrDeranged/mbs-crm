import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import {
  canManageMarketingResource,
  canReadMarketingResource,
} from "./authHelpers";
import {
  DEFAULT_ROUTING_SETTINGS,
  isRoundRobinEligibleInboundSource,
  shouldAutoReassignStale,
  shouldRoundRobinAssign,
} from "./leadRouting";
import { listStaleRoundRobinLeadCandidates } from "./staleLeadReassignment";
import { leadsTable } from "@workspace/db";
import { db } from "@workspace/db";
import { createDripRouter } from "../routes/drip";
import emailRouter from "../routes/email";

const rep = { id: 7, role: "rep" } as const;
const otherRep = { id: 8, role: "rep" } as const;
const admin = { id: 9, role: "admin" } as const;

test("routing defaults to manual and only rotates ordinary website inbound leads", () => {
  assert.deepEqual(DEFAULT_ROUTING_SETTINGS, {
    mode: "manual",
    staleDays: 7,
    autoReassignStale: false,
  });
  assert.equal(shouldRoundRobinAssign("website", DEFAULT_ROUTING_SETTINGS), false);
  assert.equal(shouldRoundRobinAssign("website", { mode: "round_robin" }), true);
  assert.equal(isRoundRobinEligibleInboundSource("qr-card"), false);
  assert.equal(isRoundRobinEligibleInboundSource("prospect_list"), false);
  assert.equal(shouldRoundRobinAssign("qr-card", { mode: "round_robin" }), false);
  assert.equal(shouldRoundRobinAssign("prospect_list", { mode: "round_robin" }), false);
});

test("automatic stale reassignment requires both opt-in flags and a rotating source", () => {
  assert.equal(shouldAutoReassignStale("website", { mode: "manual", autoReassignStale: true }), false);
  assert.equal(shouldAutoReassignStale("website", { mode: "round_robin", autoReassignStale: false }), false);
  assert.equal(shouldAutoReassignStale("website", { mode: "round_robin", autoReassignStale: true }), true);
  assert.equal(shouldAutoReassignStale("qr-card", { mode: "round_robin", autoReassignStale: true }), false);
});

test("representatives cannot manage other resources but can read administrator-owned resources", () => {
  assert.equal(canManageMarketingResource(rep, rep.id), true);
  assert.equal(canManageMarketingResource(rep, otherRep.id), false);
  assert.equal(canManageMarketingResource(rep, null), false);
  assert.equal(canReadMarketingResource(rep, rep), true);
  assert.equal(canReadMarketingResource(rep, admin), true);
  assert.equal(canReadMarketingResource(rep, otherRep), false);
  assert.equal(canReadMarketingResource(rep, null), false);
  assert.equal(canManageMarketingResource(admin, otherRep.id), true);
});

test("stale reassignment uses a core select builder, never an aliased relational findMany", async () => {
  let fromTable: unknown;
  let receivedLimit: number | undefined;
  const coreSelect = {
    select: () => ({
      from: (table: unknown) => {
        fromTable = table;
        return {
          where: () => ({
            limit: async (limit: number) => {
              receivedLimit = limit;
              return [{ id: 42, assignedRepId: 7, leadSource: "website" }];
            },
          }),
        };
      },
    }),
  };
  const candidates = await listStaleRoundRobinLeadCandidates(
    coreSelect as unknown as Pick<typeof import("@workspace/db").db, "select">,
    7,
  );
  assert.equal(fromTable, leadsTable);
  assert.equal(receivedLimit, 100);
  assert.deepEqual(candidates, [{ id: 42, assignedRepId: 7, leadSource: "website" }]);
});

async function requestDrip(
  user: { id: number; role: "rep" | "admin" },
  database: { query: Record<string, { findFirst?: () => Promise<unknown> }> },
  path: string,
  method = "GET",
  body?: unknown,
) {
  const app = express();
  app.use(express.json());
  app.use(createDripRouter({
    database: database as unknown as typeof import("@workspace/db").db,
    authenticate: async () => ({ ...user, isActive: true }) as any,
    isEmailSuppressed: async () => false,
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const sequenceDates = {
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

test("drip API returns 403 when a rep reads, updates, or deletes another rep's sequence", async () => {
  const database = {
    query: {
      dripSequencesTable: {
        findFirst: async () => ({
          id: 99, name: "Other rep", triggerStatus: "new",
          isActive: true, ownerId: otherRep.id, owner: otherRep, steps: [], ...sequenceDates,
        }),
      },
      leadsTable: {},
      emailTemplatesTable: {},
      dripEnrollmentsTable: {},
    },
  };
  for (const method of ["GET", "PUT", "DELETE"]) {
    const response = await requestDrip(rep, database, "/drip/sequences/99", method);
    assert.equal(response.status, 403, `${method} must reject another rep's sequence`);
  }
});

test("drip API permits a rep to read an admin sequence but forbids editing it", async () => {
  const database = {
    query: {
      dripSequencesTable: {
        findFirst: async () => ({
          id: 100, name: "Approved", triggerStatus: "new",
          isActive: true, ownerId: admin.id, owner: admin, steps: [], ...sequenceDates,
        }),
      },
      leadsTable: {},
      emailTemplatesTable: {},
      dripEnrollmentsTable: {},
    },
  };
  assert.equal((await requestDrip(rep, database, "/drip/sequences/100")).status, 200);
  assert.equal((await requestDrip(rep, database, "/drip/sequences/100", "PUT")).status, 403);
});

test("drip enrollment API returns 403 for a lead assigned to another representative", async () => {
  const database = {
    query: {
      leadsTable: { findFirst: async () => ({ id: 77, assignedRepId: otherRep.id }) },
      dripSequencesTable: {},
      emailTemplatesTable: {},
      dripEnrollmentsTable: {},
    },
  };
  assert.equal((await requestDrip(rep, database, "/leads/77/drip/enroll", "POST")).status, 403);
});

test("drip enrollment API rejects an admin sequence containing another rep's private template", async () => {
  const database = {
    query: {
      leadsTable: { findFirst: async () => ({ id: 78, assignedRepId: rep.id, email: "lead@example.com", isUnsubscribed: false }) },
      dripSequencesTable: {
        findFirst: async () => ({
          id: 100, owner: admin, ownerId: admin.id,
          steps: [{ template: { owner: otherRep, ownerId: otherRep.id } }],
        }),
      },
      emailTemplatesTable: {},
      dripEnrollmentsTable: {},
    },
  };
  const response = await requestDrip(rep, database, "/leads/78/drip/enroll", "POST", { sequenceId: 100 });
  assert.equal(response.status, 403);
});

test("drip API returns 400 for malformed sequence and nested step bodies", async () => {
  const database = {
    query: {
      dripSequencesTable: {
        findFirst: async () => ({ id: 101, ownerId: rep.id, owner: rep, ...sequenceDates }),
      },
      leadsTable: {},
      emailTemplatesTable: {},
      dripEnrollmentsTable: {},
    },
  };
  assert.equal(
    (await requestDrip(rep, database, "/drip/sequences", "POST", { name: 123, triggerStatus: "" })).status,
    400,
  );
  assert.equal(
    (await requestDrip(rep, database, "/drip/sequences/101/steps", "PUT", {
      steps: [{ templateId: "not-a-number", delayHours: -1 }],
    })).status,
    400,
  );
});

function clerkAuth(userId: string) {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const auth = () => ({ userId, tokenType: "session_token" });
    Object.defineProperty(auth, Symbol.for("@clerk/express.auth"), { value: true });
    (req as any).auth = auth;
    next();
  };
}

async function requestTemplate(owner: { id: number; role: "rep" | "admin" }, method = "GET") {
  const query = db.query as unknown as {
    usersTable: { findFirst: () => unknown };
    userIdentitiesTable: { findFirst: () => unknown };
    emailTemplatesTable: { findFirst: () => unknown };
  };
  const originalUserFindFirst = query.usersTable.findFirst;
  const originalIdentityFindFirst = query.userIdentitiesTable.findFirst;
  const originalTemplateFindFirst = query.emailTemplatesTable.findFirst;
  query.userIdentitiesTable.findFirst = async () => null;
  query.usersTable.findFirst = async () => ({
    id: rep.id, clerkId: "rep-7", email: "rep@example.com", name: "Rep",
    role: "rep", isActive: true, slug: null,
  }) as any;
  query.emailTemplatesTable.findFirst = async () => ({
    id: 88, name: "Template", subject: "Subject", bodyHtml: "<p>Body</p>",
    isActive: true, ownerId: owner.id, owner, ...sequenceDates,
  }) as any;

  const app = express();
  app.use(express.json());
  app.use(clerkAuth("rep-7"));
  app.use(emailRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    return await fetch(`http://127.0.0.1:${address.port}/email/templates/88`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "PUT" ? JSON.stringify({ name: "Nope" }) : undefined,
    });
  } finally {
    query.usersTable.findFirst = originalUserFindFirst;
    query.userIdentitiesTable.findFirst = originalIdentityFindFirst;
    query.emailTemplatesTable.findFirst = originalTemplateFindFirst;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("template API returns 403 for another rep's read, update, and delete", async () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    assert.equal((await requestTemplate(otherRep, method)).status, 403, `${method} must reject another rep's template`);
  }
});

test("template API permits a rep to read an admin template but forbids editing it", async () => {
  assert.equal((await requestTemplate(admin)).status, 200);
  assert.equal((await requestTemplate(admin, "PUT")).status, 403);
});