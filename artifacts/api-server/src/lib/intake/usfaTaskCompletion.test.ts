import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db, documentsTable, leadsTable, tasksTable } from "@workspace/db";
import { USFA_STATEMENT_TASK_TITLE } from "./usfa";
import { completeUsfaTaskIfReady, lockUsfaStatementUpload } from "./usfaTaskCompletion";

function fakeTransaction(statementCount: number) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    select: () => ({ from: () => ({ where: () => ({
      limit: async () => Array.from({ length: statementCount }, (_, index) => ({ id: index + 1 })),
    }) }) }),
    update: () => ({ set: (values: Record<string, unknown>) => ({
      where: () => ({ returning: async () => { updates.push(values); return [{ id: 12 }]; } }),
    }) }),
  };
}

test("USFA bank-statement upload completes the task on the third stored statement, not before", async () => {
  const two = fakeTransaction(2);
  assert.equal(await completeUsfaTaskIfReady(two, 576, "usfundadvisor", "bank_statement"), false);
  assert.equal(two.updates.length, 0);
  const three = fakeTransaction(3);
  assert.equal(await completeUsfaTaskIfReady(three, 576, "usfundadvisor", "bank_statement"), true);
  assert.equal(three.updates[0]?.isCompleted, true);
  assert.ok(three.updates[0]?.completedAt instanceof Date);
  const unrelated = fakeTransaction(3);
  assert.equal(await completeUsfaTaskIfReady(unrelated, 576, "manual", "bank_statement"), false);
  assert.equal(await completeUsfaTaskIfReady(unrelated, 576, "usfundadvisor", "other"), false);
  assert.equal(unrelated.updates.length, 0);
});

test("three simultaneous successful statement inserts complete the task exactly once", async () => {
  const [lead] = await db.insert(leadsTable).values({
    externalId: `concurrent-statements-${randomUUID()}`, leadSource: "usfundadvisor",
  }).returning();
  try {
    await db.insert(tasksTable).values({
      leadId: lead.id, title: USFA_STATEMENT_TASK_TITLE, userId: null,
    });
    const outcomes = await Promise.all([1, 2, 3].map((index) =>
      db.transaction(async (tx) => {
        await lockUsfaStatementUpload(tx, lead.id, "usfundadvisor", "bank_statement");
        await tx.insert(documentsTable).values({
          leadId: lead.id, userId: null, category: "bank_statement",
          filename: `test-${index}.pdf`, fileKey: `test/${randomUUID()}`,
          fileType: "application/pdf", fileSize: 3,
        });
        return completeUsfaTaskIfReady(tx, lead.id, "usfundadvisor", "bank_statement");
      }),
    ));
    assert.deepEqual(outcomes.sort(), [false, false, true]);
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.leadId, lead.id));
    assert.equal(task?.isCompleted, true);
    assert.ok(task?.completedAt);
  } finally {
    await db.delete(leadsTable).where(eq(leadsTable.id, lead.id));
  }
});