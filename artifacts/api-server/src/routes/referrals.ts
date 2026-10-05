import { Router } from "express";
import { and, eq, ilike, or, desc, sql } from "drizzle-orm";
import { db, leadsTable, lendersTable, dealsTable, campaignEngagementTable } from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { ATTRIBUTION_WINDOW_MS, signAttributionToken, verifyAttributionToken, validateReferrer, referrerRecipient, mostRecentCampaign, attributeReferral } from "../lib/campaignAttribution";
import { sanitizeLikeInput } from "../lib/sanitize";

const router = Router();
const accessibleLead = (user: { id: number; role: string }) => user.role === "rep" ? eq(leadsTable.assignedRepId, user.id) : undefined;
const accessibleDeal = (user: { id: number; role: string }) => user.role === "rep" ? eq(dealsTable.assignedTo, user.id) : undefined;
const idParam = (value: unknown) => typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

export async function resolvePublicReferral(token: string, database: any = db) {
  const p = verifyAttributionToken(token);
  if (!p || p.kind !== "referral" || !["lead", "partner"].includes(p.type) || !Number.isSafeInteger(p.id) || p.id <= 0) return null;
  const referrer = await validateReferrer({
    referredByLeadId: p.type === "lead" ? p.id : null,
    referredByPartnerId: p.type === "partner" ? p.id : null,
  }, null, undefined, database);
  const table = p.type === "lead" ? leadsTable : lendersTable;
  const [record] = await database.select().from(table).where(eq(table.id, p.id)).limit(1);
  if (!record) return null;
  // Names deliberately reveal only the holder's supplied signed referral,
  // never a searchable public CRM directory or the referrer's contact data.
  const label = p.type === "partner" ? record.name : record.companyName || `${record.firstName ?? ""} ${record.lastName ?? ""}`.trim() || "Referring customer";
  return { ...referrer, token, label, type: p.type, id: p.id, explicitSendId: Number.isSafeInteger(p.emailSendId) ? p.emailSendId : undefined };
}
router.get("/public/referrals/:token", async (req, res) => {
  try {
    const resolved = await resolvePublicReferral(String(req.params.token));
    if (!resolved) return void res.status(404).json({ error: "Referral link expired or unavailable" });
    res.set("Cache-Control", "no-store").json({ token: resolved.token, type: resolved.type, id: resolved.id, label: resolved.label });
  } catch { res.status(404).json({ error: "Referral link expired or unavailable" }); }
});

router.get("/referrals/options", async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  const pattern = `%${sanitizeLikeInput(search)}%`;
  const [leads, partners] = await Promise.all([
    db.select({ id: leadsTable.id, first: leadsTable.firstName, last: leadsTable.lastName, company: leadsTable.companyName }).from(leadsTable)
      .where(and(accessibleLead(user), search ? or(ilike(leadsTable.firstName, pattern), ilike(leadsTable.lastName, pattern), ilike(leadsTable.companyName, pattern)) : undefined)).limit(50),
    db.select({ id: lendersTable.id, name: lendersTable.name }).from(lendersTable).where(search ? ilike(lendersTable.name, pattern) : undefined).limit(50),
  ]);
  res.json([...leads.map(l => ({ type: "lead", id: l.id, label: l.company || `${l.first ?? ""} ${l.last ?? ""}`.trim() || `Lead #${l.id}` })),
    ...partners.map(p => ({ type: "partner", id: p.id, label: p.name }))]);
});

for (const type of ["lead", "partner"] as const) {
  router.post(`/referrals/${type}/:id/link`, async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const id = idParam(req.params.id); if (!id) return void res.status(400).json({ error: "Invalid ID" });
    try {
      const referrer = await validateReferrer({ referredByLeadId: type === "lead" ? id : null, referredByPartnerId: type === "partner" ? id : null }, user);
      const recipient = await referrerRecipient(referrer);
      const source = recipient ? await mostRecentCampaign(recipient, new Date()) : null;
      res.json({ token: signAttributionToken({ kind: "referral", type, id, emailSendId: source?.emailSendId ?? null, expiresAt: Date.now() + ATTRIBUTION_WINDOW_MS }) });
    } catch { res.status(400).json({ error: "Referrer unavailable" }); }
  });
  router.get(`/referrals/${type}/:id`, async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const id = idParam(req.params.id); if (!id) return void res.status(400).json({ error: "Invalid ID" });
    try { await validateReferrer({ referredByLeadId: type === "lead" ? id : null, referredByPartnerId: type === "partner" ? id : null }, user); }
    catch { return void res.status(404).json({ error: "Referrer unavailable" }); }
    const [leads, deals] = await Promise.all([
      db.select({ id: leadsTable.id, firstName: leadsTable.firstName, lastName: leadsTable.lastName, companyName: leadsTable.companyName,
        status: leadsTable.status, referredAt: leadsTable.referredAt, referralCampaignId: campaignEngagementTable.campaignId })
        .from(leadsTable).leftJoin(campaignEngagementTable, and(eq(campaignEngagementTable.leadId, leadsTable.id), eq(campaignEngagementTable.kind, "referral")))
        .where(and(accessibleLead(user), eq(type === "lead" ? leadsTable.referredByLeadId : leadsTable.referredByPartnerId, id))).orderBy(desc(leadsTable.createdAt)).limit(250),
      db.select({ id: dealsTable.id, leadId: sql<number | null>`CASE WHEN ${user.role !== "rep"} OR EXISTS
        (SELECT 1 FROM leads l WHERE l.id = ${dealsTable.leadId} AND l.assigned_rep_id = ${user.id}) THEN ${dealsTable.leadId} ELSE NULL END`,
        stage: dealsTable.stage, amount: dealsTable.amount, actualGm: dealsTable.actualGm }).from(dealsTable)
        .where(and(accessibleDeal(user), eq(type === "lead" ? dealsTable.referredByLeadId : dealsTable.referredByPartnerId, id))).limit(250),
    ]);
    res.json({ leads, deals });
  });
}

for (const type of ["lead", "deal"] as const) {
  router.patch(`/referrals/${type}/:id`, async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const id = idParam(req.params.id); if (!id) return void res.status(400).json({ error: "Invalid ID" });
    if (!req.body || !Object.hasOwn(req.body, "referredByLeadId") || !Object.hasOwn(req.body, "referredByPartnerId")) {
      return void res.status(400).json({ error: "Supply both referral fields, using null to clear" });
    }
    try {
      const result = await db.transaction(async tx => {
        const table = type === "lead" ? leadsTable : dealsTable;
        const [record] = await tx.select().from(table).where(eq(table.id, id)).for("update").limit(1);
        if (!record || (user.role === "rep" && (type === "lead" ? (record as any).assignedRepId : (record as any).assignedTo) !== user.id)) throw new Error("Record unavailable");
        const referrer = await validateReferrer(req.body, user, type === "lead" ? id : (record as any).leadId ?? undefined, tx);
        const at = type === "lead" ? (record as any).referredAt ?? record.createdAt : record.createdAt;
        const [updated] = await tx.update(table).set({ ...referrer, updatedAt: new Date(), ...(type === "lead" ? { referredAt: at } : {}) }).where(eq(table.id, id)).returning();
        if (type === "lead" && !(record as any).referredAt && !(record as any).referredByLeadId && !(record as any).referredByPartnerId) {
          await attributeReferral(id, referrer, at, tx);
        }
        await logActivity({ userId: user.id, leadId: type === "lead" ? id : (record as any).leadId, dealId: type === "deal" ? id : null,
          action: "referral_corrected", entityType: type, entityId: id,
          details: { from: { referredByLeadId: record.referredByLeadId, referredByPartnerId: record.referredByPartnerId }, to: referrer, campaignCreditPreserved: true } }, tx);
        return { id: updated.id, ...referrer };
      });
      res.json(result);
    } catch { res.status(400).json({ error: "Invalid referral or inaccessible record" }); }
  });
}
export default router;
