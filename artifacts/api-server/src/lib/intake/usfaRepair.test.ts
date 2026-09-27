import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db, leadsTable, tasksTable, usfaIntakeLogTable } from "@workspace/db";
import { repairUsfaLeads, planUsfaLinkRepair } from "./usfaRepair";
import { USFA_STATEMENT_TASK_TITLE } from "./usfa";

test("link repair adds all four slots without repeating changes on a second run", () => {
  const sheetLinks = (["A", "B", "C", "D"] as const).map((slot) => ({
    slot, url: `https://usfundadvisor.ai/${slot}`,
  }));
  const first = planUsfaLinkRepair({ statementLinks: [sheetLinks[0]!.url] }, sheetLinks);
  assert.equal(first.storedLinkCount, 1);
  assert.equal(first.sheetLinkCount, 4);
  assert.equal(first.changed, true);
  const second = planUsfaLinkRepair({
    statementLinks: first.urls, statementLinksBySlot: first.bySlot,
  }, sheetLinks);
  assert.equal(second.changed, false);
  assert.deepEqual(second.bySlot, sheetLinks);
});

test("repair reconciles three admin copies and missing links once, then makes no changes", async () => {
  const externalId = `usfa-repair-test-${randomUUID()}`;
  const [lead] = await db.insert(leadsTable).values({
    externalId, leadSource: "usfundadvisor", companyName: "Repair test fixture",
  }).returning();
  try {
    // An older reapplication receipt for the same lead must not be updated.
    await db.insert(usfaIntakeLogTable).values({
      externalId: `older-${externalId}`, leadId: lead.id, rowNumber: 1, status: "dup",
      metadata: { statementLinks: ["https://usfundadvisor.ai/older"] },
    });
    await db.insert(usfaIntakeLogTable).values({
      externalId, leadId: lead.id, rowNumber: 2, status: "ok",
      metadata: { statementLinks: [] },
    });
    await db.insert(tasksTable).values([1, 2, 3].map(() => ({
      leadId: lead.id, title: USFA_STATEMENT_TASK_TITLE, userId: null,
    })));
    const row = {
      Id: externalId,
      "STATEMENT(A)": "https://usfundadvisor.ai/a",
      "STATEMENT(B)": "https://usfundadvisor.ai/b",
      "STATEMENT(C)": "https://usfundadvisor.ai/c",
      "STATEMENT(D)": "https://usfundadvisor.ai/d",
    };
    const source = async () => ({
      rows: new Map([
        [externalId, { row, rowNumber: 2 }],
        [`older-${externalId}`, {
          row: { Id: `older-${externalId}`, "STATEMENT(B)": "https://usfundadvisor.ai/reapplication",
            "STATEMENT(D)": "https://usfundadvisor.ai/reapplication-2" },
          rowNumber: 3,
        }],
      ]),
      duplicateIds: new Set<string>(),
    });
    const first = await repairUsfaLeads(source, [lead.id]);
    assert.deepEqual(first.leads.map(({ storedLinkCount, sheetLinkCount, linksUpdated, taskAction, error }) =>
      ({ storedLinkCount, sheetLinkCount, linksUpdated, taskAction, error })), [{
      storedLinkCount: 0, sheetLinkCount: 4, linksUpdated: true, taskAction: "collapsed", error: undefined,
    }]);
    assert.equal(first.leads[0]?.removedTaskCount, 2);
    assert.equal(first.leads[0]?.taskCompleted, false);
    const [reapplication] = await db.select().from(usfaIntakeLogTable)
      .where(eq(usfaIntakeLogTable.externalId, `older-${externalId}`));
    assert.deepEqual((reapplication?.metadata as { statementLinksBySlot?: unknown })?.statementLinksBySlot, [
      { slot: "B", url: "https://usfundadvisor.ai/reapplication" },
      { slot: "D", url: "https://usfundadvisor.ai/reapplication-2" },
    ]);
    const second = await repairUsfaLeads(source, [lead.id]);
    assert.deepEqual(second.leads.map(({ storedLinkCount, sheetLinkCount, linksUpdated, taskAction, error }) =>
      ({ storedLinkCount, sheetLinkCount, linksUpdated, taskAction, error })), [{
      storedLinkCount: 4, sheetLinkCount: 4, linksUpdated: false, taskAction: "unchanged", error: undefined,
    }]);
    assert.equal(second.leads[0]?.removedTaskCount, 0);
    const tasks = await db.select().from(tasksTable).where(eq(tasksTable.leadId, lead.id));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.userId, null);
    assert.ok(tasks[0]?.dueDate);
  } finally {
    await db.delete(usfaIntakeLogTable).where(eq(usfaIntakeLogTable.leadId, lead.id));
    await db.delete(leadsTable).where(eq(leadsTable.id, lead.id));
  }
});

test("repair backfills a single shared-admin task even when the Sheet row has no links", async () => {
  const externalId = `usfa-missing-task-test-${randomUUID()}`;
  const [lead] = await db.insert(leadsTable).values({
    externalId, leadSource: "usfundadvisor", companyName: "Missing task fixture",
  }).returning();
  try {
    const source = async () => ({
      rows: new Map([[externalId, { row: { Id: externalId }, rowNumber: 3 }]]),
      duplicateIds: new Set<string>(),
    });
    const first = await repairUsfaLeads(source, [lead.id]);
    assert.equal(first.leads[0]?.sheetLinkCount, 0);
    assert.equal(first.leads[0]?.taskAction, "created");
    assert.equal((await db.select().from(tasksTable).where(eq(tasksTable.leadId, lead.id))).length, 1);
    const second = await repairUsfaLeads(source, [lead.id]);
    assert.equal(second.leads[0]?.taskAction, "unchanged");
    assert.equal(second.leads[0]?.linksUpdated, false);
    assert.equal((await db.select().from(tasksTable).where(eq(tasksTable.leadId, lead.id))).length, 1);
  } finally {
    await db.delete(usfaIntakeLogTable).where(eq(usfaIntakeLogTable.externalId, externalId));
    await db.delete(leadsTable).where(eq(leadsTable.id, lead.id));
  }
});