import { and, eq, sql } from "drizzle-orm";
import { communicationsTable, db, leadsTable } from "@workspace/db";
import { selectNextInboundAssigneeInTransaction } from "./leadDistribution";

/** Shared by answered, missed and voicemail callbacks; retries keep their lead. */
export async function ensureInboundCallLead(
  call: Pick<typeof communicationsTable.$inferSelect, "id" | "fromNumber">,
  database: typeof db = db,
) {
  const phone = call.fromNumber || "unknown";
  return database.transaction(async (tx) => {
    // Callback ordering/retries and simultaneous calls from one number must not
    // create extra leads or advance the shared round-robin cursor twice.
    const lockKey = call.fromNumber ? `inbound-call:${phone}` : `inbound-call-id:${call.id}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const current = await tx.query.communicationsTable.findFirst({
      where: and(eq(communicationsTable.id, call.id), eq(communicationsTable.direction, "inbound"), eq(communicationsTable.type, "call")),
    });
    if (!current) throw new Error("Inbound call not found");
    let lead = current.leadId
      ? await tx.query.leadsTable.findFirst({ where: eq(leadsTable.id, current.leadId) })
      : undefined;
    if (!lead && call.fromNumber) {
      lead = await tx.query.leadsTable.findFirst({ where: eq(leadsTable.phone, phone) });
    }
    if (!lead) {
      // Same persisted cursor, eligible pool and transaction as USFA intake.
      // Manual mode/no eligible rep leaves the lead in the assignment queue.
      const assignment = await selectNextInboundAssigneeInTransaction(tx);
      [lead] = await tx.insert(leadsTable).values({
        phone,
        firstName: "Inbound",
        lastName: "Caller",
        leadSource: "inbound-call",
        assignedRepId: assignment?.repId ?? null,
      }).returning();
    }
    if (!lead) throw new Error("Inbound lead creation failed");
    if (current.leadId !== lead.id) {
      await tx.update(communicationsTable).set({ leadId: lead.id })
        .where(eq(communicationsTable.id, call.id));
    }
    return lead;
  });
}
