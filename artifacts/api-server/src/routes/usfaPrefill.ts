import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, leadsTable, usersTable, usfaIntakePrefillTable, usfaPrefillInvitesTable } from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { decrypt } from "../lib/encryption";
import { recordPiiAccess } from "../lib/piiAccess";
import { getPublicBaseUrl } from "../lib/brand";

const router = Router();
const INVITE_TTL_MS = 15 * 60 * 1000;

export function hashUsfaInvite(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function createUsfaInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function findUsfaInvite(token: string, slug: string) {
  return db.query.usfaPrefillInvitesTable.findFirst({
    where: and(
      eq(usfaPrefillInvitesTable.tokenHash, hashUsfaInvite(token)),
      eq(usfaPrefillInvitesTable.repSlug, slug.toLowerCase()),
      isNull(usfaPrefillInvitesTable.revokedAt),
      isNull(usfaPrefillInvitesTable.usedAt),
      gt(usfaPrefillInvitesTable.expiresAt, new Date()),
    ),
  });
}

async function issueInvite(req: Request, res: Response): Promise<void> {
  const user = await requireUser(req, res);
  if (!user) return;
  const leadId = Number(req.params.id);
  if (!Number.isInteger(leadId) || leadId <= 0) {
    res.status(400).json({ error: "Invalid lead ID", field: "id" });
    return;
  }
  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead || lead.leadSource !== "usfundadvisor") {
    res.status(404).json({ error: "USFA lead not found" });
    return;
  }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (user.role !== "admin" && user.role !== "rep") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const rep = user.role === "rep"
    ? user
    : (lead.assignedRepId
      ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) })
      : null);
  if (!rep?.slug || !rep.isActive) {
    res.status(409).json({ error: "Lead has no active representative slug" });
    return;
  }
  const token = createUsfaInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.insert(usfaPrefillInvitesTable).values({
    tokenHash: hashUsfaInvite(token),
    leadId,
    repUserId: rep.id,
    repSlug: rep.slug,
    expiresAt,
  });
  res.status(201).json({ url: `${getPublicBaseUrl()}/r/${encodeURIComponent(rep.slug)}?invite=${encodeURIComponent(token)}`, expiresAt });
}

router.post("/leads/:id/usfa-application-link", issueInvite);

router.get("/public/reps/:slug/usfa-prefill/:token", async (req: Request, res: Response): Promise<void> => {
  const slug = String(req.params.slug ?? "").toLowerCase();
  const token = String(req.params.token ?? "");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || token.length < 32) {
    res.status(404).json({ error: "Prefill not found" });
    return;
  }
  const invite = await findUsfaInvite(token, slug);
  if (!invite) {
    res.status(404).json({ error: "Prefill not found" });
    return;
  }
  const [prefill] = await db.select().from(usfaIntakePrefillTable)
    .where(eq(usfaIntakePrefillTable.leadId, invite.leadId))
    .orderBy(desc(usfaIntakePrefillTable.createdAt), desc(usfaIntakePrefillTable.id))
    .limit(1);
  if (!prefill) {
    res.status(404).json({ error: "Prefill not found" });
    return;
  }
  try {
    const payload = JSON.parse(decrypt(prefill.encryptedPayload)) as { ssn?: unknown; dob?: unknown };
    if (typeof payload.ssn !== "string" && typeof payload.dob !== "string") {
      res.status(404).json({ error: "Prefill not found" });
      return;
    }
    await recordPiiAccess({
      userId: invite.repUserId,
      leadId: invite.leadId,
      fieldCategory: "ssn",
      action: "view",
      ip: req.ip,
      metadata: { purpose: "usfa-prefill", inviteId: invite.id, repSlug: slug },
    });
    res.json({
      ...(typeof payload.ssn === "string" ? { ownerSsn: payload.ssn } : {}),
      ...(typeof payload.dob === "string" ? { ownerDob: payload.dob } : {}),
    });
  } catch {
    res.status(404).json({ error: "Prefill not found" });
  }
});

export async function claimUsfaInvite(
  database: Pick<typeof db, "update">,
  token: string,
  slug: string,
  leadId: number,
): Promise<boolean> {
  const [updated] = await database.update(usfaPrefillInvitesTable)
    .set({ usedAt: new Date() })
    .where(and(
      eq(usfaPrefillInvitesTable.tokenHash, hashUsfaInvite(token)),
      eq(usfaPrefillInvitesTable.repSlug, slug),
      eq(usfaPrefillInvitesTable.leadId, leadId),
      isNull(usfaPrefillInvitesTable.revokedAt),
      isNull(usfaPrefillInvitesTable.usedAt),
      gt(usfaPrefillInvitesTable.expiresAt, new Date()),
    )).returning({ id: usfaPrefillInvitesTable.id });
  return Boolean(updated);
}

/** Compatibility wrapper for callers that do not already own a transaction. */
export async function markUsfaInviteUsed(token: string, slug: string, leadId: number): Promise<boolean> {
  return claimUsfaInvite(db, token, slug, leadId);
}

export default router;