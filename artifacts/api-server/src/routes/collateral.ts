import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import sgMail from "@sendgrid/mail";
import {
  collateralRendersTable, collateralTemplatesTable, leadsTable, usersTable,
} from "@workspace/db";
import { db } from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { renderCollateral, renderFinanceApplicationCollateral, FINANCE_APPLICATION_SOURCE_KEY } from "../lib/collateralPersonalization";
import { ObjectStorageService } from "../lib/objectStorage";
import { getPublicBaseUrl } from "../lib/brand";

const router = Router();
const templateBody = z.object({
  name: z.string().trim().min(1), category: z.enum(["flyer", "one_pager", "application", "letter", "other"]),
  kind: z.enum(["html", "image_overlay"]), sourceKey: z.string().min(1), status: z.enum(["draft", "published"]).optional(),
});
const secret = process.env.SESSION_SECRET || "development-collateral-secret";
const objectStorage = new ObjectStorageService();
const signed = (value: string) => `${value}.${crypto.createHmac("sha256", secret).update(value).digest("hex")}`;

async function user(req: Request, res: Response) {
  return requireUser(req, res);
}
function isAdmin(u: { role: string }) { return u.role === "admin"; }
function repFields(u: typeof usersTable.$inferSelect) {
  return { name: u.name?.trim() || u.email, title: u.title?.trim() || "", phone: u.mobileNumber?.trim() || "", email: u.email, slug: u.slug || String(u.id) };
}
async function sourceBytes(sourceKey: string): Promise<{ bytes: Buffer; format: "pdf" | "png" }> {
  const file = await objectStorage.getObjectEntityFile(sourceKey);
  const [bytes] = await file.download();
  if (bytes.subarray(0, 5).toString() === "%PDF-") return { bytes, format: "pdf" };
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { bytes, format: "png" };
  throw new Error("Collateral source is not a PNG or PDF");
}
async function renderTemplatePdf(t: typeof collateralTemplatesTable.$inferSelect, rep: typeof usersTable.$inferSelect): Promise<Buffer> {
  if (t.sourceKey === FINANCE_APPLICATION_SOURCE_KEY) {
    return renderFinanceApplicationCollateral({ rep: repFields(rep), logoUrl: null });
  }
  if (t.kind === "html") {
    let source = t.sourceKey;
    if (source.startsWith("/objects/")) {
      const file = await objectStorage.getObjectEntityFile(source);
      const [bytes] = await file.download();
      source = bytes.toString("utf8");
    }
    return renderCollateral({ kind: "html", source, rep: repFields(rep), format: "pdf" });
  }
  // Legacy flyer rows stored HTML directly. Migration 031 preserves their
  // source verbatim while classifying them under the requested image_overlay
  // library kind, so keep those rows renderable without duplicating the old
  // flyer renderer or pretending the HTML is a binary image.
  if (!t.sourceKey.startsWith("/objects/") && /<[^>]+>/.test(t.sourceKey)) {
    return renderCollateral({ kind: "html", source: t.sourceKey, rep: repFields(rep), format: "pdf" });
  }
  const source = await sourceBytes(t.sourceKey);
  return renderCollateral({ kind: "image_overlay", source: source.bytes, sourceFormat: source.format, rep: repFields(rep), format: "pdf" });
}

router.get("/collateral/templates", async (req, res) => {
  const u = await user(req, res); if (!u) return;
  const rows = await db.select().from(collateralTemplatesTable)
    .where(u.role === "admin" && req.query.includeDrafts === "true" ? undefined : eq(collateralTemplatesTable.status, "published"))
    .orderBy(desc(collateralTemplatesTable.updatedAt));
  res.json(rows.map((t) => ({ ...t, thumbnailUrl: t.kind === "image_overlay" ? `/api/collateral/templates/${t.id}/thumbnail` : null })));
});

router.get("/collateral/templates/:id", async (req, res) => {
  const u = await user(req, res); if (!u) return;
  const t = await db.query.collateralTemplatesTable.findFirst({ where: eq(collateralTemplatesTable.id, Number(req.params.id)) });
  if (!t || (t.status !== "published" && !isAdmin(u))) return void res.status(404).json({ error: "Template not found" });
  res.json(t);
});
router.get("/collateral/templates/:id/thumbnail", async (req, res) => {
  const u = await user(req, res); if (!u) return;
  const t = await db.query.collateralTemplatesTable.findFirst({ where: eq(collateralTemplatesTable.id, Number(req.params.id)) });
  if (!t || (t.status !== "published" && !isAdmin(u))) return void res.status(404).json({ error: "Template not found" });
  const title = t.name.replace(/[<&>"]/g, "");
  res.type("svg").send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#f4f7fa"/><rect x="0" y="0" width="640" height="72" fill="#0B2948"/><rect x="32" y="28" width="120" height="16" rx="8" fill="#17B26A"/><text x="32" y="150" fill="#0B2948" font-family="Arial" font-size="28" font-weight="bold">${title}</text><text x="32" y="190" fill="#64748b" font-family="Arial" font-size="15">Personalized collateral preview</text><rect x="32" y="300" width="576" height="2" fill="#17B26A"/></svg>`);
});

router.post("/collateral/templates", async (req, res) => {
  const u = await user(req, res); if (!u || !isAdmin(u)) return void res.status(403).json({ error: "Admin access required" });
  const parsed = templateBody.safeParse(req.body); if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message });
  const [row] = await db.insert(collateralTemplatesTable).values({ ...parsed.data, createdBy: u.id }).returning();
  res.status(201).json(row);
});
router.patch("/collateral/templates/:id", async (req, res) => {
  const u = await user(req, res); if (!u || !isAdmin(u)) return void res.status(403).json({ error: "Admin access required" });
  const patch = templateBody.partial().safeParse(req.body); if (!patch.success) return void res.status(400).json({ error: "Invalid template" });
  const [row] = await db.update(collateralTemplatesTable).set({ ...patch.data, updatedAt: new Date() })
    .where(eq(collateralTemplatesTable.id, Number(req.params.id))).returning();
  if (!row) return void res.status(404).json({ error: "Template not found" });
  res.json(row);
});
router.post("/collateral/templates/:id/publish", async (req, res) => {
  const u = await user(req, res); if (!u || !isAdmin(u)) return void res.status(403).json({ error: "Admin access required" });
  const [row] = await db.update(collateralTemplatesTable).set({ status: "published", updatedAt: new Date() }).where(eq(collateralTemplatesTable.id, Number(req.params.id))).returning();
  res.json(row);
});
router.post("/collateral/templates/:id/archive", async (req, res) => {
  const u = await user(req, res); if (!u || !isAdmin(u)) return void res.status(403).json({ error: "Admin access required" });
  const [row] = await db.update(collateralTemplatesTable).set({ status: "draft", updatedAt: new Date() }).where(eq(collateralTemplatesTable.id, Number(req.params.id))).returning();
  res.json(row);
});

router.get("/collateral/templates/:id/render", async (req, res) => {
  const viewer = await user(req, res); if (!viewer) return;
  const t = await db.query.collateralTemplatesTable.findFirst({ where: eq(collateralTemplatesTable.id, Number(req.params.id)) });
  if (!t || (t.status !== "published" && !isAdmin(viewer))) return void res.status(404).json({ error: "Template not found" });
  const repId = Number(req.query.repId) || viewer.id;
  if (!isAdmin(viewer) && repId !== viewer.id) return void res.status(403).json({ error: "Forbidden" });
  const rep = await db.query.usersTable.findFirst({ where: eq(usersTable.id, repId) });
  if (!rep) return void res.status(404).json({ error: "Rep not found" });
  const fields = repFields(rep);
  const sha256 = crypto.createHash("sha256").update(JSON.stringify({ template: t, fields })).digest("hex");
  let render = await db.query.collateralRendersTable.findFirst({ where: and(eq(collateralRendersTable.templateId, t.id), eq(collateralRendersTable.userId, rep.id), eq(collateralRendersTable.sha256, sha256)) });
  if (!render) {
    const fileKey = `/objects/collateral/${t.id}/${rep.id}/${sha256}.pdf`;
    const pdf = await renderTemplatePdf(t, rep);
    await objectStorage.saveObjectEntity(fileKey, pdf, "application/pdf");
    [render] = await db.insert(collateralRendersTable).values({ templateId: t.id, userId: rep.id, fileKey, sha256 }).returning();
  }
  res.json({ template: t, renderId: render.id, sha256, rep: fields, pdfUrl: `/api/collateral/renders/${render.id}/pdf`, pngUrl: `/api/collateral/renders/${render.id}/png`, shareUrl: `/api/collateral/renders/${render.id}/link` });
});

router.get("/collateral/renders/:id/pdf", async (req, res) => {
  const u = await user(req, res); if (!u) return;
  const r = await db.query.collateralRendersTable.findFirst({ where: eq(collateralRendersTable.id, Number(req.params.id)), with: { template: true, user: true } });
  if (!r || (u.role === "rep" && r.userId !== u.id)) return void res.status(404).json({ error: "Render not found" });
  try {
    const file = await objectStorage.getObjectEntityFile(r.fileKey);
    const [pdf] = await file.download();
    res.type("application/pdf").send(pdf);
  }
  catch { res.status(503).json({ error: "PDF rendering unavailable" }); }
});
router.get("/collateral/renders/:id/png", async (_req, res) => res.status(503).json({ error: "PNG rendering unavailable: sharp is not installed" }));
router.post("/collateral/renders/:id/email", async (req, res) => {
  const u = await user(req, res); if (!u) return;
  const body = z.object({ leadId: z.coerce.number().int().positive(), subject: z.string().trim().min(1).default("A resource for your business"), bodyHtml: z.string().trim().min(1) }).safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "leadId, subject, and bodyHtml are required" });
  const r = await db.query.collateralRendersTable.findFirst({ where: eq(collateralRendersTable.id, Number(req.params.id)), with: { template: true, user: true } });
  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, body.data.leadId) });
  if (!r || !lead?.email || (u.role === "rep" && r.userId !== u.id)) return void res.status(404).json({ error: "Render or lead not found" });
  try {
    const file = await objectStorage.getObjectEntityFile(r.fileKey);
    const [pdf] = await file.download();
    sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");
    await sgMail.send({ to: lead.email, from: { email: "funding@my-business-solutions.com", name: "My Business Solutions" }, replyTo: { email: r.user.email, name: r.user.name || r.user.email }, subject: body.data.subject, html: body.data.bodyHtml, attachments: [{ content: pdf.toString("base64"), filename: `${r.template.name}.pdf`, type: "application/pdf", disposition: "attachment" }] });
    await db.update(collateralRendersTable).set({ leadId: lead.id }).where(eq(collateralRendersTable.id, r.id));
    await logActivity({ userId: u.id, leadId: lead.id, action: "collateral_emailed", entityType: "collateral_render", entityId: r.id, details: { templateId: r.templateId, to: lead.email } });
    res.json({ sent: true });
  } catch { res.status(503).json({ error: "Email delivery failed" }); }
});
router.get("/collateral/renders/:id/link", async (req, res) => {
  const u = await user(req, res); if (!u) return;
  const token = signed(`${req.params.id}:${Date.now() + 7 * 86400000}`);
  res.json({ url: `${getPublicBaseUrl()}/api/collateral/shared/${token}`, expiresInDays: 7 });
});
router.get("/collateral/shared/:token", async (req, res) => {
  const [payload, signature] = req.params.token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(payload || "").digest("hex");
  const [id, expires] = (payload || "").split(":");
  if (!signature || signature !== expected || !expires || Number(expires) < Date.now()) return void res.status(403).json({ error: "Link expired or invalid" });
  const r = await db.query.collateralRendersTable.findFirst({ where: eq(collateralRendersTable.id, Number(id)), with: { template: true, user: true } });
  if (!r) return void res.status(404).json({ error: "Render not found" });
  try {
    const file = await objectStorage.getObjectEntityFile(r.fileKey);
    const [pdf] = await file.download();
    res.type("application/pdf").set("Content-Disposition", `attachment; filename="collateral-${r.id}.pdf"`).send(pdf);
  } catch { res.status(503).json({ error: "PDF rendering unavailable" }); }
});

export default router;