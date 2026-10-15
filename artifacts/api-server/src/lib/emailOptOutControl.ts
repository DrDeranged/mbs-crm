import type { Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { db, dripEnrollmentsTable, emailSendsTable, leadsTable } from "@workspace/db";
import { requireUser } from "./authHelpers";
import { logActivity } from "./activityHelper";

export const emailOptOutInput = z.object({
  isUnsubscribed: z.boolean(),
  reason: z.string().trim().min(1).max(2000),
}).strict();
const bulkInput = emailOptOutInput.extend({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
});

export function createEmailOptOutHandler(bulk = false, dependencies: {
  database?: typeof db;
  authenticate?: typeof requireUser;
  recordActivity?: typeof logActivity;
} = {}) {
  const database = dependencies.database ?? db;
  return async (req: Request, res: Response) => {
    const actor = await (dependencies.authenticate ?? requireUser)(req, res);
    if (!actor) return;
    if (!["admin", "manager"].includes(actor.role)) {
      res.status(403).json({ error: "Manager or admin only" });
      return;
    }
    const parsed = (bulk ? bulkInput : emailOptOutInput).safeParse(req.body);
    const leadId = bulk ? null : z.coerce.number().int().positive().safeParse(req.params["id"]);
    if (!parsed.success || (leadId && !leadId.success)) {
      res.status(400).json({ error: "Valid lead IDs, opt-out state and a nonblank reason are required" });
      return;
    }
    const ids = [...new Set(bulk ? (parsed.data as z.infer<typeof bulkInput>).ids : [leadId && leadId.success ? leadId.data : 0])];
    const result = await database.transaction(async tx => {
      // Lock in deterministic order: concurrent manual changes cannot audit stale
      // previous values, and a bulk operation is all-or-nothing.
      const leads = await tx.select().from(leadsTable).where(inArray(leadsTable.id, ids))
        .orderBy(leadsTable.id).for("update");
      if (leads.length !== ids.length) return null;
      const now = new Date();
      for (const lead of leads) {
        await tx.update(leadsTable).set({ isUnsubscribed: parsed.data.isUnsubscribed, updatedAt: now })
          .where(eq(leadsTable.id, lead.id));
        await (dependencies.recordActivity ?? logActivity)({
          userId: actor.id, leadId: lead.id, action: "email_opt_out_changed",
          entityType: "lead", entityId: lead.id,
          details: { reason: parsed.data.reason, isUnsubscribed: parsed.data.isUnsubscribed, previousValue: lead.isUnsubscribed },
        }, tx);
      }
      if (parsed.data.isUnsubscribed) {
        await tx.update(dripEnrollmentsTable).set({ status: "unenrolled", unenrolledAt: now })
          .where(and(inArray(dripEnrollmentsTable.leadId, ids), eq(dripEnrollmentsTable.status, "active")));
        await tx.update(emailSendsTable).set({ status: "unsubscribed", updatedAt: now })
          .where(and(inArray(emailSendsTable.leadId, ids), eq(emailSendsTable.status, "queued")));
      }
      // Clearing never resurrects queued sends or active drip enrollments.
      return { updated: leads.length };
    });
    if (!result) { res.status(404).json({ error: "One or more leads were not found; nothing changed" }); return; }
    res.json(result);
  };
}
