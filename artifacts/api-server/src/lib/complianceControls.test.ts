import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { leadsTable, dripEnrollmentsTable, emailSendsTable } from "@workspace/db";
import { createEmailOptOutHandler } from "./emailOptOutControl";
import { createListOpenTasksHandler } from "../routes/tasks";
import { createGetMyTasksHandler } from "../routes/dashboard";
import { campaignSendCounts } from "./campaignSendCounts";
import { reconcileCampaignMetrics } from "./campaignMetrics";
import { classifyEmailRecipient, campaignContentHash, campaignExclusionReasonCounts } from "./campaignCore";

function response() {
  return { statusCode: 200, body: null as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; } };
}

function consentFixture(role = "manager", ids = [5, 6]) {
  const writes: any[] = [], audits: any[] = [];
  const tx = {
    select: () => ({ from: () => ({ where: () => ({
      orderBy: () => ({ for: async () => ids.map(id => ({ id, isUnsubscribed: false })) }),
    }) }) }),
    update: (table: any) => ({ set: (values: any) => ({ where: async () => { writes.push({ table, values }); } }) }),
  };
  const database = { transaction: async (fn: any) => {
    try { return await fn(tx); } catch (error) { writes.length = 0; audits.length = 0; throw error; }
  } } as any;
  const dependencies = { database, authenticate: async () => ({ id: 9, role }) as any,
    recordActivity: async (entry: any, executor: any) => { assert.equal(executor, tx); audits.push(entry); } };
  return { writes, audits, dependencies };
}

for (const role of ["admin", "manager"]) {
  test(`${role} can bulk opt out with per-lead actor/reason audit and queued-send/drip cancellation`, async () => {
    const f = consentFixture(role);
    const res = response();
    await createEmailOptOutHandler(true, f.dependencies)({ body: { ids: [5, 6, 5], isUnsubscribed: true, reason: "  Customer request  " } } as any, res as any);
    assert.deepEqual(res.body, { updated: 2 });
    assert.equal(f.audits.length, 2);
    assert.deepEqual(f.audits.map(a => a.leadId), [5, 6]);
    for (const entry of f.audits) {
      assert.equal(entry.userId, 9);
      assert.deepEqual(entry.details, { reason: "Customer request", isUnsubscribed: true, previousValue: false });
    }
    assert.equal(f.writes.filter(w => w.table === leadsTable).length, 2);
    assert.equal(f.writes.find(w => w.table === emailSendsTable).values.status, "unsubscribed");
    assert.equal(f.writes.find(w => w.table === dripEnrollmentsTable).values.status, "unenrolled");
    assert.equal(classifyEmailRecipient({ email: "a@example.test", unsubscribed: true, suppressed: false, duplicate: false, capacityAvailable: true }), "email_unsubscribed");
  });
}

test("clear requires a reason, is audited, and does not restart old email/drip work", async () => {
  const f = consentFixture("admin", [5]), res = response();
  await createEmailOptOutHandler(false, f.dependencies)({ params: { id: "5" }, body: { isUnsubscribed: false, reason: "Documented re-consent" } } as any, res as any);
  assert.deepEqual(res.body, { updated: 1 });
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].values.isUnsubscribed, false);
  assert.equal(f.audits[0].details.reason, "Documented re-consent");
});

test("rep and pending cannot change opt-out; missing/blank reasons and IDs are rejected", async () => {
  for (const role of ["rep", "pending"]) {
    const f = consentFixture(role), res = response();
    await createEmailOptOutHandler(true, f.dependencies)({ body: { ids: [5], isUnsubscribed: true, reason: "Request" } } as any, res as any);
    assert.equal(res.statusCode, 403); assert.equal(f.writes.length, 0);
  }
  for (const body of [{ ids: [5], isUnsubscribed: true }, { ids: [5], isUnsubscribed: true, reason: " " },
    { ids: [], isUnsubscribed: true, reason: "Request" }, { ids: [5], isUnsubscribed: true, reason: "x".repeat(2001) }]) {
    const f = consentFixture(), res = response();
    await createEmailOptOutHandler(true, f.dependencies)({ body } as any, res as any);
    assert.equal(res.statusCode, 400); assert.equal(f.writes.length, 0);
  }
});

test("missing lead aborts the whole bulk operation; audit failure rolls back changes", async () => {
  const f = consentFixture("admin", [5]), res = response();
  await createEmailOptOutHandler(true, f.dependencies)({ body: { ids: [5, 6], isUnsubscribed: true, reason: "Request" } } as any, res as any);
  assert.equal(res.statusCode, 404); assert.equal(f.writes.length, 0);
  await assert.rejects(createEmailOptOutHandler(true, { ...f.dependencies, recordActivity: async () => { throw new Error("audit unavailable"); } })(
    { body: { ids: [5], isUnsubscribed: true, reason: "Request" } } as any, response() as any), /audit unavailable/);
  assert.equal(f.writes.length, 0);
});

test("manual exclusions are distinct, affect approval hash and do not become 'other'", () => {
  assert.equal(campaignExclusionReasonCounts([{ reason: "excluded_manually" }]).excludedManually, 1);
  assert.equal(campaignExclusionReasonCounts([{ reason: "excluded_manually" }]).other, 0);
  assert.notEqual(campaignContentHash({ audienceRules: { excludedLeadIds: [] } }),
    campaignContentHash({ audienceRules: { excludedLeadIds: [5] } }));
});

test("Sent reconciles live progress, completion, legacy rows, bounced sends and per-launch history", () => {
  const recipients = [
    { id: 1, campaignId: 5, launchId: 10, status: "sent", emailSendId: 31 },
    { id: 2, campaignId: 5, launchId: 10, status: "queued", emailSendId: 32 },
    { id: 3, campaignId: 5, launchId: 11, status: "sent", emailSendId: null },
  ];
  const sends = [
    { id: 31, campaignId: 5, campaignLaunchId: 10, status: "bounced", sentAt: new Date(), deliveryKind: "bulk" },
    { id: 32, campaignId: 5, campaignLaunchId: 10, status: "sent", sentAt: new Date(), deliveryKind: "bulk" },
    { id: 33, campaignId: 5, campaignLaunchId: 11, status: "sent", sentAt: new Date(), deliveryKind: "test" },
    { id: 34, campaignId: 5, campaignLaunchId: 11, status: "failed", sentAt: null, deliveryKind: "bulk" },
  ];
  const running = campaignSendCounts(5, recipients, sends);
  assert.equal(running.sent, 3);
  assert.equal(running.byLaunch.get(10), 2);
  assert.equal(running.byLaunch.get(11), 1);
  assert.equal([...running.byLaunch.values()].reduce((a, b) => a + b, 0), running.sent);
  const metric = reconcileCampaignMetrics({ id: 5 }, { recipients, sends, engagement: [], replies: [],
    webhookEvents: [], leads: [], deals: [], histories: [], activities: [], approvals: [] }, false);
  assert.equal(metric.sent, running.sent);
  recipients[1].status = "sent";
  assert.equal(campaignSendCounts(5, recipients, sends).sent, running.sent);
  assert.equal(campaignSendCounts(5, recipients, sends).byLaunch.get(10), 2);
});

test("dashboard and Tasks use identical overdue scope, including tasks owned by other users and USFA leads", async () => {
  const queries: any[] = [];
  const now = new Date("2026-07-15T23:00:00-04:00");
  const rows = [
    { id: 1, leadId: 550, userId: 77, title: "USFA follow-up", isCompleted: false, dueDate: "2026-07-14", createdAt: now,
      lead: { id: 550, firstName: "USFA", lastName: "Applicant", companyName: "Company", assignedRepId: 77 } },
    { id: 2, leadId: 602, userId: null, title: "Unassigned", isCompleted: false, dueDate: "2026-07-14", createdAt: now,
      lead: { id: 602, assignedRepId: 3 } },
  ];
  for (const role of ["admin", "manager", "rep"]) {
    const database = { query: { tasksTable: { findMany: async (config: any) => {
      queries.push(new PgDialect().sqlToQuery(config.where)); return rows;
    } } } } as any;
    const authenticate = async () => ({ id: 3, role }) as any;
    const dashboard = response(), list = response();
    await createGetMyTasksHandler({ database, authenticate, clock: () => now })({} as any, dashboard as any);
    await createListOpenTasksHandler({ database, authenticate })({ query: { filter: "overdue" } } as any, list as any);
    assert.deepEqual(dashboard.body.overdue.map((t: any) => t.id), list.body.map((t: any) => t.id));
    assert.equal(list.body.length, role === "rep" ? 1 : 2);
    assert.equal(list.body[0].leadLabel, role === "rep" ? "Lead #602" : "Company — USFA Applicant");
  }
  assert.ok(queries.every(q => q.sql.includes('"is_completed"')));
  assert.ok(queries.every(q => !q.sql.includes('"user_id"')));
});
