import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { communicationsTable, companySettingsTable, leadsTable, usersTable } from "@workspace/db";
import { ensureInboundCallLead } from "./inboundCallLead";
import { isUnassignedInboundLead, unassignedInboundLeadCondition } from "./inboundLead";
import { isRoundRobinEligibleInboundSource, shouldRoundRobinAssign } from "./leadRouting";

const NOW = new Date("2026-10-14T18:00:00Z");
const dialect = new PgDialect();

function fixture(mode = "manual", options: { emptyPool?: boolean; includeAdmins?: boolean } = {}) {
  const calls: any[] = [{ id: 1, leadId: null, fromNumber: "+12025550101", type: "call", direction: "inbound" }];
  const leads: any[] = [];
  const locks: any[] = [];
  const settings = { id: 1, routingMode: mode, roundRobinCursor: 0, includeAdminsInRoundRobin: options.includeAdmins ?? false };
  const users = options.emptyPool ? [] : [
    { id: 7, role: "rep", isActive: true },
    { id: 8, role: "manager", isActive: true },
    { id: 9, role: "admin", isActive: true },
    { id: 10, role: "pending", isActive: true },
    { id: 11, role: "rep", isActive: false },
  ];
  let candidateReads = 0;
  const tx: any = {
    execute: async (query: any) => { locks.push(dialect.sqlToQuery(query)); },
    query: {
      communicationsTable: { findFirst: async ({ where }: any) => {
        const params = dialect.sqlToQuery(where).params;
        return calls.find(c => c.id === params[0] && c.direction === params[1] && c.type === params[2]);
      } },
      leadsTable: { findFirst: async ({ where }: any) => {
        const query = dialect.sqlToQuery(where);
        return query.sql.includes('"phone"')
          ? leads.find(l => l.phone === query.params[0])
          : leads.find(l => l.id === query.params[0]);
      } },
    },
    select: () => ({ from: (table: any) => {
      if (table === companySettingsTable) return { limit: async () => [settings] };
      assert.equal(table, usersTable);
      candidateReads++;
      return { where: (where: any) => {
        const params = dialect.sqlToQuery(where).params;
        assert(params.includes(true), "rotation must require active users");
        return { orderBy: async () => users.filter(u => u.isActive && params.includes(u.role)) };
      } };
    } }),
    insert: (table: any) => {
      assert.equal(table, leadsTable);
      return { values: (values: any) => ({ returning: async () => {
        const lead = { id: 550 + leads.length, createdAt: NOW, ...values };
        leads.push(lead);
        return [lead];
      } }) };
    },
    update: (table: any) => ({ set: (values: any) => ({ where: async (where: any) => {
      if (table === companySettingsTable) Object.assign(settings, values);
      else {
        assert.equal(table, communicationsTable);
        const id = dialect.sqlToQuery(where).params[0];
        Object.assign(calls.find(c => c.id === id), values);
      }
    } }) }),
  };
  return { calls, leads, settings, locks, candidateReads: () => candidateReads,
    db: { transaction: async (callback: any) => callback(tx) } as any };
}

test("manual call intake enters the assignment queue and links its communication immediately", async () => {
  const f = fixture();
  const lead = await ensureInboundCallLead(f.calls[0], f.db);
  assert.equal(lead.leadSource, "inbound-call");
  assert.equal(lead.assignedRepId, null);
  assert.equal(f.calls[0].leadId, lead.id);
  assert.equal(isUnassignedInboundLead(lead, NOW), true);
  assert.equal(f.candidateReads(), 0);
  assert.match(f.locks[0].sql, /pg_advisory_xact_lock\(hashtext/);
});

test("round-robin call intake shares the persisted active rep/manager pool and cursor", async () => {
  const f = fixture("round_robin");
  const assigned: number[] = [];
  for (let i = 0; i < 3; i++) {
    const call = { id: i + 2, fromNumber: `+1202555010${i + 2}`, leadId: null, type: "call", direction: "inbound" };
    f.calls.push(call);
    const lead = await ensureInboundCallLead(call, f.db);
    assigned.push(lead.assignedRepId!);
    assert.equal(isUnassignedInboundLead(lead, NOW), false);
  }
  assert.deepEqual(assigned, [7, 8, 7]);
  assert.equal(f.settings.roundRobinCursor, 1);
  assert(f.locks.some(lock => lock.params.includes(840163)));
});

test("admins join call rotation only when the existing setting enables them", async () => {
  const f = fixture("round_robin", { includeAdmins: true });
  f.settings.roundRobinCursor = 2;
  assert.equal((await ensureInboundCallLead(f.calls[0], f.db)).assignedRepId, 9);
});

test("empty round-robin pool falls back to the queue rather than losing the call lead", async () => {
  const f = fixture("round_robin", { emptyPool: true });
  const lead = await ensureInboundCallLead(f.calls[0], f.db);
  assert.equal(lead.assignedRepId, null);
  assert.equal(isUnassignedInboundLead(lead, NOW), true);
});

test("callback retries and later calls reuse the lead without advancing rotation", async () => {
  const f = fixture("round_robin");
  const first = await ensureInboundCallLead(f.calls[0], f.db);
  assert.equal((await ensureInboundCallLead(f.calls[0], f.db)).id, first.id);
  const nextCall = { ...f.calls[0], id: 2, leadId: null };
  f.calls.push(nextCall);
  assert.equal((await ensureInboundCallLead(nextCall, f.db)).id, first.id);
  assert.equal(f.leads.length, 1);
  assert.equal(f.candidateReads(), 1);
  assert.equal(f.calls[1].leadId, first.id);
});

test("existing linked and phone-matched leads retain their assigned or unassigned owner", async () => {
  for (const assignedRepId of [null, 42]) {
    const f = fixture("round_robin");
    f.leads.push({ id: 602, phone: f.calls[0].fromNumber, assignedRepId, leadSource: "inbound-call", createdAt: NOW });
    for (const leadId of [null, 602]) {
      f.calls[0].leadId = leadId;
      const lead = await ensureInboundCallLead(f.calls[0], f.db);
      assert.equal(lead.id, 602);
      assert.equal(lead.assignedRepId, assignedRepId);
    }
    assert.equal(f.candidateReads(), 0);
  }
});

test("unknown caller voicemail retries stay linked without conflating different anonymous calls", async () => {
  const f = fixture();
  f.calls[0].fromNumber = null;
  const first = await ensureInboundCallLead(f.calls[0], f.db);
  assert.equal(first.phone, "unknown");
  assert.equal((await ensureInboundCallLead(f.calls[0], f.db)).id, first.id);
  const next = { ...f.calls[0], id: 2, leadId: null };
  f.calls.push(next);
  assert.notEqual((await ensureInboundCallLead(next, f.db)).id, first.id);
});

test("legacy unassigned call leads backfill at read time without an age cutoff or writes", () => {
  for (const id of [550, 602, 603]) {
    for (const createdAt of [new Date("2026-01-01T00:00:00Z"), NOW]) {
      assert.equal(isUnassignedInboundLead({ assignedRepId: null, leadSource: "inbound-call", createdAt }, NOW), true, `lead ${id}`);
    }
  }
  assert.equal(isUnassignedInboundLead({ assignedRepId: 7, leadSource: "inbound-call", createdAt: NOW }, NOW), false);
  const sql = dialect.sqlToQuery(unassignedInboundLeadCondition(NOW)!);
  assert.match(sql.sql, /"assigned_rep_id" is null/i);
  assert.match(sql.sql, / or /i);
  assert(sql.params.includes("inbound-call"));
  assert(sql.params.includes("usfundadvisor"));
});

test("call sources are eligible only in round-robin mode; imports and attributed QR remain excluded", () => {
  for (const source of ["website", "usfundadvisor", "inbound-call"]) {
    assert.equal(isRoundRobinEligibleInboundSource(source), true);
    assert.equal(shouldRoundRobinAssign(source, { mode: "manual" }), false);
    assert.equal(shouldRoundRobinAssign(source, { mode: "round_robin" }), true);
  }
  for (const source of ["manual", "import", "qr-card"]) {
    assert.equal(shouldRoundRobinAssign(source, { mode: "round_robin" }), false);
  }
});
