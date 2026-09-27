import { and, eq } from "drizzle-orm";
import { documentsTable, leadsTable, tasksTable } from "@workspace/db";
import { USFA_STATEMENT_TASK_TITLE } from "./usfa";

type CompletionTransaction = {
  select: (...args: any[]) => any;
  update: (...args: any[]) => any;
};

export async function lockUsfaStatementUpload(
  tx: CompletionTransaction, leadId: number, leadSource: string | null, category: string,
): Promise<void> {
  if (leadSource !== "usfundadvisor" || category !== "bank_statement") return;
  // Serialize uploads before inserting the document. The third transaction
  // then sees both earlier committed statements when it counts the documents.
  await tx.select({ id: leadsTable.id }).from(leadsTable)
    .where(eq(leadsTable.id, leadId)).for("update");
}

export async function completeUsfaTaskIfReady(
  tx: CompletionTransaction, leadId: number, leadSource: string | null, category: string,
): Promise<boolean> {
  if (leadSource !== "usfundadvisor" || category !== "bank_statement") return false;
  const statements = await tx.select({ id: documentsTable.id }).from(documentsTable)
    .where(and(eq(documentsTable.leadId, leadId), eq(documentsTable.category, "bank_statement")))
    .limit(3);
  if (statements.length < 3) return false;
  const updated = await tx.update(tasksTable).set({
    isCompleted: true, completedAt: new Date(), updatedAt: new Date(),
  }).where(and(eq(tasksTable.leadId, leadId), eq(tasksTable.title, USFA_STATEMENT_TASK_TITLE),
    eq(tasksTable.isCompleted, false))).returning({ id: tasksTable.id });
  return updated.length > 0;
}