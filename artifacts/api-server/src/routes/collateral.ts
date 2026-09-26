import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type Request, type Response } from "express";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod/v4";
import sgMail from "@sendgrid/mail";
import {
  COLLATERAL_FLYER_AUDIENCES, COLLATERAL_FLYER_CATEGORIES, COLLATERAL_FLYER_VERTICALS,
  collateralRendersTable, collateralTemplatesTable, leadsTable, usersTable,
} from "@workspace/db";
import { db } from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { renderCollateral, renderFinanceApplicationCollateral, FINANCE_APPLICATION_SOURCE_KEY } from "../lib/collateralPersonalization";
import { enrichApplicationPdfRep } from "../lib/applicationPdf";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { getPublicBaseUrl } from "../lib/brand";
import {
  canEmailCollateralToLead,
  canManageCollateralTemplates,
  canReadCollateralTemplate,
  canRenderCollateralForRep,
} from "../lib/collateralAccess";

const router = Router();
const templateBody = z.object({
  name: z.string().trim().min(1), category: z.enum(["flyer", "one_pager", "application", "letter", "other"]),
  kind: z.enum(["html", "image_overlay"]), sourceKey: z.string().min(1), status: z.enum(["draft", "published"]).optional(),
});
const collateralTemplatesQuery = z.object({
  includeDrafts: z.union([
    z.boolean(),
    z.enum(["true", "1", "false", "0"]).transform((value) => value === "true" || value === "1"),
  ]).optional().default(false),
});
const secret = process.env.SESSION_SECRET ?? "";
function signingSecret(): string {
  if (!secret) throw new Error("SESSION_SECRET is required for collateral links");
  return secret;
}
const objectStorage = new ObjectStorageService();
const signed = (value: string) => `${value}.${crypto.createHmac("sha256", signingSecret()).update(value).digest("hex")}`;
const MAX_COLLATERAL_FLYER_BYTES = 15 * 1024 * 1024;
const MAX_COLLATERAL_FLYER_BATCH = 50;
const COLLATERAL_FLYER_PUBLIC_TTL_SECONDS = 15 * 60;
type CampaignFlyerTokenPayload = {
  templateId: number;
  objectPath: string;
  digest: string;
  generation: string;
  name: string;
  contentType: "image/png" | "application/pdf";
  expiresAt: number;
};

export type SignedCampaignFlyerInput = Omit<CampaignFlyerTokenPayload, "expiresAt">;

export function buildSignedCampaignFlyerUrl(
  input: SignedCampaignFlyerInput,
  ttlSeconds = COLLATERAL_FLYER_PUBLIC_TTL_SECONDS,
): string {
  if (!Number.isInteger(input.templateId) || input.templateId < 1 ||
      !/^\/objects\/collateral-library\/[0-9a-f-]{36}$/.test(input.objectPath) ||
      !/^[a-f0-9]{64}$/i.test(input.digest) || !input.generation ||
      !["image/png", "application/pdf"].includes(input.contentType) ||
      !Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 7 * 24 * 60 * 60) {
    throw new Error("Invalid approved campaign flyer link input");
  }
  const payload: CampaignFlyerTokenPayload = { ...input, expiresAt: Date.now() + ttlSeconds * 1000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", signingSecret()).update(encoded).digest("base64url");
  return `${getPublicBaseUrl()}/api/collateral/flyers/public/${encoded}.${signature}`;
}

export function normalizeCollateralFlyerDisplayName(name: string, filename?: string | null): string {
  if (/rahmare/i.test(name)) return name.replace(/rahmare/gi, "Ray Davis");
  if (filename && /rahmare/i.test(filename)) return `${name} — Ray Davis`;
  return name;
}

export function detectCollateralFlyerContentType(bytes: Buffer): "image/png" | "application/pdf" {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(pngSignature) &&
      bytes.subarray(12, 16).toString("ascii") === "IHDR" &&
      bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0) {
    return "image/png";
  }
  if (bytes.length >= 10 && bytes.subarray(0, 5).toString("ascii") === "%PDF-" &&
      bytes.subarray(Math.max(0, bytes.length - 1024)).includes(Buffer.from("%%EOF"))) {
    return "application/pdf";
  }
  throw new Error("Flyer bytes must be a valid PNG or PDF");
}
const CAMPAIGN_SOURCES: Record<string, string> = {
  "mbs://campaign/working-capital": "working-capital.png",
  "mbs://campaign/equipment-financing": "equipment-financing.png",
};

export function campaignAssetPaths(
  sourceKey: string,
  moduleUrl = import.meta.url,
): string[] {
  const filename = CAMPAIGN_SOURCES[sourceKey];
  if (!filename) return [];
  return [
    fileURLToPath(new URL(`../../assets/campaigns/${filename}`, moduleUrl)),
    fileURLToPath(new URL(`../assets/campaigns/${filename}`, moduleUrl)),
  ];
}

export async function campaignSourceBytes(sourceKey: string): Promise<Buffer | null> {
  for (const assetPath of campaignAssetPaths(sourceKey)) {
    try {
      return await fs.readFile(assetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return null;
}

export type CollateralMailClient = {
  setApiKey: (key: string) => void;
  send: (message: any) => Promise<unknown>;
};

export function canAccessCollateralRender(
  viewer: { id: number; role: string },
  renderOwnerId: number,
): boolean {
  return viewer.role !== "rep" || viewer.id === renderOwnerId;
}

export async function sendCollateralEmail(client: CollateralMailClient, input: {
  leadEmail: string;
  repEmail: string;
  repName: string | null;
  subject: string;
  bodyHtml: string;
  templateName: string;
  pdf: Buffer;
}): Promise<void> {
  client.setApiKey(process.env.SENDGRID_API_KEY || "");
  await client.send({
    to: input.leadEmail,
    from: { email: "funding@my-business-solutions.com", name: "My Business Solutions" },
    replyTo: { email: input.repEmail, name: input.repName || input.repEmail },
    subject: input.subject,
    html: input.bodyHtml,
    attachments: [{
      content: input.pdf.toString("base64"),
      filename: `${input.templateName}.pdf`,
      type: "application/pdf",
      disposition: "attachment",
    }],
  });
}

export async function recordCollateralEmailDelivery(
  deps: {
    associateRender: (renderId: number, leadId: number) => Promise<void>;
    writeActivity: (params: Parameters<typeof logActivity>[0]) => Promise<unknown>;
  },
  params: {
    renderId: number;
    templateId: number;
    leadId: number;
    userId: number;
    recipientEmail: string;
  },
): Promise<void> {
  await deps.associateRender(params.renderId, params.leadId);
  await deps.writeActivity({
    userId: params.userId,
    leadId: params.leadId,
    action: "collateral_emailed",
    entityType: "collateral_render",
    entityId: params.renderId,
    details: { templateId: params.templateId, to: params.recipientEmail },
  });
}

async function user(req: Request, res: Response) {
  return requireUser(req, res);
}
function isAdmin(u: { role: string }) { return u.role === "admin"; }
function repFields(u: typeof usersTable.$inferSelect) {
  return { name: u.name?.trim() || u.email, title: u.title?.trim() || "", phone: u.mobileNumber?.trim() || "", email: u.email, slug: u.slug || String(u.id) };
}
async function sourceBytes(sourceKey: string): Promise<{ bytes: Buffer; format: "pdf" | "png" }> {
  const campaignBytes = await campaignSourceBytes(sourceKey);
  if (campaignBytes) return { bytes: campaignBytes, format: "png" };
  const file = await objectStorage.getObjectEntityFile(sourceKey);
  const [bytes] = await file.download();
  if (bytes.subarray(0, 5).toString() === "%PDF-") return { bytes, format: "pdf" };
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { bytes, format: "png" };
  throw new Error("Collateral source is not a PNG or PDF");
}
async function renderTemplatePdf(t: typeof collateralTemplatesTable.$inferSelect, rep: typeof usersTable.$inferSelect): Promise<Buffer> {
  if (t.sourceKey === FINANCE_APPLICATION_SOURCE_KEY) {
    return renderFinanceApplicationCollateral({
      rep: await enrichApplicationPdfRep(db, rep.id, repFields(rep)),
      logoUrl: null,
    });
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

type CollateralTemplateListDeps = {
  getUser: typeof user;
  listTemplates: (includeDrafts: boolean) => Promise<Array<typeof collateralTemplatesTable.$inferSelect>>;
};

export function listCollateralTemplatesHandler(deps: CollateralTemplateListDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const u = await deps.getUser(req, res);
    if (!u) return;
    const query = collateralTemplatesQuery.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Invalid includeDrafts query value" });
      return;
    }
    const includeDrafts = u.role === "admin" && query.data.includeDrafts;
    const rows = await deps.listTemplates(includeDrafts);
    res.json(rows.map((t) => ({
      ...t,
      thumbnailUrl: t.kind === "image_overlay" ? `/api/collateral/templates/${t.id}/thumbnail` : null,
    })));
  };
}

type CampaignAssetHandlerDeps = {
  getUser: typeof user;
  readSource: typeof campaignSourceBytes;
};

export function campaignAssetHandler(
  disposition: "inline" | "attachment",
  deps: CampaignAssetHandlerDeps = {
    getUser: user,
    readSource: campaignSourceBytes,
  },
) {
  return async (req: Request, res: Response): Promise<void> => {
    const u = await deps.getUser(req, res);
    if (!u) return;
    const slug = req.params["slug"] as string;
    const bytes = await deps.readSource(`mbs://campaign/${slug}`);
    if (!bytes) {
      res.status(404).json({ error: "Campaign asset not found" });
      return;
    }
    const cacheControl = disposition === "attachment"
      ? "private, no-store"
      : "private, max-age=3600";
    res
      .type("image/png")
      .set("Content-Disposition", `${disposition}; filename="${slug}.png"`)
      .set("Cache-Control", cacheControl)
      .send(bytes);
  };
}

router.get("/collateral/templates", listCollateralTemplatesHandler({
  getUser: user,
  listTemplates: async (includeDrafts) => db.select().from(collateralTemplatesTable)
    .where(includeDrafts ? undefined : eq(collateralTemplatesTable.status, "published"))
    .orderBy(desc(collateralTemplatesTable.updatedAt)),
}));
const flyerUploadRequest = z.object({
  files: z.array(z.object({
    originalFilename: z.string().trim().min(1).max(255),
    size: z.number().int().positive().max(MAX_COLLATERAL_FLYER_BYTES),
    contentType: z.enum(["image/png", "application/pdf"]),
  })).min(1).max(MAX_COLLATERAL_FLYER_BATCH),
});
const flyerRegistration = z.object({
  items: z.array(z.object({
    objectPath: z.string().min(1),
    name: z.string().trim().min(1).max(255),
    originalFilename: z.string().trim().min(1).max(255),
    category: z.enum(COLLATERAL_FLYER_CATEGORIES),
    vertical: z.enum(COLLATERAL_FLYER_VERTICALS),
    audience: z.enum(COLLATERAL_FLYER_AUDIENCES),
    repId: z.number().int().positive().nullable().optional(),
  })).min(1).max(MAX_COLLATERAL_FLYER_BATCH),
});
const flyerListQuery = z.object({
  category: z.enum(COLLATERAL_FLYER_CATEGORIES).optional(),
  vertical: z.enum(COLLATERAL_FLYER_VERTICALS).optional(),
  audience: z.enum(COLLATERAL_FLYER_AUDIENCES).optional(),
  repId: z.coerce.number().int().positive().optional(),
});

router.post("/collateral/flyers/upload-urls", async (req, res) => {
  const u = await user(req, res);
  if (!u || !isAdmin(u)) return void res.status(403).json({ error: "Admin access required" });
  const parsed = flyerUploadRequest.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Upload files must be PNG or PDF, up to 15 MB each; maximum 50 files" });
  try {
    const uploads = await Promise.all(parsed.data.files.map(async (item, index) => ({
      index,
      originalFilename: item.originalFilename,
      size: item.size,
      contentType: item.contentType,
      ...(await objectStorage.getCollateralFlyerUploadURL(u.id)),
    })));
    res.json({ uploads });
  } catch (error) {
    req.log.error({ err: error }, "Error generating collateral flyer upload URLs");
    res.status(500).json({ error: "Failed to generate flyer upload URLs" });
  }
});

router.post("/collateral/flyers/register", async (req, res) => {
  const u = await user(req, res);
  if (!u || !isAdmin(u)) return void res.status(403).json({ error: "Admin access required" });
  const parsed = flyerRegistration.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid flyer registration request" });
  const seenPaths = new Set<string>();
  for (const item of parsed.data.items) {
    const stagingPath = new RegExp(`^/objects/collateral-flyers/staging/${u.id}/[0-9a-f-]{36}$`);
    if (!stagingPath.test(item.objectPath) || seenPaths.has(item.objectPath)) {
      return void res.status(400).json({ error: "Each flyer must reference a unique upload created for this admin" });
    }
    seenPaths.add(item.objectPath);
  }
  try {
    const verified = [];
    for (const item of parsed.data.items) {
      const uploaded = await objectStorage.readObjectEntity(item.objectPath, MAX_COLLATERAL_FLYER_BYTES);
      if (uploaded.size < 1 || uploaded.size > MAX_COLLATERAL_FLYER_BYTES || uploaded.bytes.length !== uploaded.size) {
        return void res.status(400).json({ error: "Uploaded flyer size is invalid or exceeds 15 MB" });
      }
      const contentType = detectCollateralFlyerContentType(uploaded.bytes);
      if (contentType !== "image/png" && contentType !== "application/pdf") {
        return void res.status(400).json({ error: "Flyer bytes must be PNG or PDF" });
      }
      if (item.repId != null && !await db.query.usersTable.findFirst({ where: eq(usersTable.id, item.repId) })) {
        return void res.status(400).json({ error: `Rep user ${item.repId} was not found` });
      }
      verified.push({ item, bytes: uploaded.bytes, contentType });
    }

    const templates = [];
    for (const { item, bytes, contentType } of verified) {
      const objectPath = `/objects/collateral-library/${crypto.randomUUID()}`;
      const digest = crypto.createHash("sha256").update(bytes).digest("hex");
      await objectStorage.saveObjectEntity(objectPath, bytes, contentType);
      const finalAsset = await objectStorage.readObjectEntity(objectPath, MAX_COLLATERAL_FLYER_BYTES);
      if (finalAsset.size !== bytes.length || finalAsset.generation === "" ||
          crypto.createHash("sha256").update(finalAsset.bytes).digest("hex") !== digest) {
        throw new Error("Server-owned flyer copy failed integrity verification");
      }
      const [template] = await db.insert(collateralTemplatesTable).values({
        name: item.name,
        category: "flyer",
        kind: "image_overlay",
        sourceKey: objectPath,
        status: "published",
        campaignCategory: item.category,
        vertical: item.vertical,
        audience: item.audience,
        repUserId: item.repId ?? null,
        originalFilename: item.originalFilename,
        assetSha256: digest,
        assetContentType: contentType,
        assetGeneration: finalAsset.generation,
        assetSize: bytes.length,
        createdBy: u.id,
      }).returning();
      if (!template) throw new Error("Flyer registration failed");
      templates.push(template);
    }
    res.status(201).json({ templates: templates.map((template) => ({
      templateId: template.id,
      objectPath: template.sourceKey,
      name: normalizeCollateralFlyerDisplayName(template.name, template.originalFilename),
      contentType: template.assetContentType,
      size: template.assetSize,
      category: template.campaignCategory,
      vertical: template.vertical,
      audience: template.audience,
      repId: template.repUserId,
    })) });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return void res.status(400).json({ error: "Uploaded staging flyer was not found" });
    req.log.error({ err: error }, "Error verifying or registering collateral flyers");
    res.status(400).json({ error: error instanceof Error ? error.message : "Flyer registration failed" });
  }
});

router.get("/collateral/flyers", async (req, res) => {
  const u = await user(req, res);
  if (!u) return;
  const parsed = flyerListQuery.safeParse(req.query);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid flyer filter" });
  const filters: any[] = [
    eq(collateralTemplatesTable.category, "flyer"),
    eq(collateralTemplatesTable.kind, "image_overlay"),
    eq(collateralTemplatesTable.status, "published"),
    isNotNull(collateralTemplatesTable.campaignCategory),
  ];
  if (parsed.data.category) filters.push(eq(collateralTemplatesTable.campaignCategory, parsed.data.category));
  if (parsed.data.vertical) filters.push(eq(collateralTemplatesTable.vertical, parsed.data.vertical));
  if (parsed.data.audience) filters.push(eq(collateralTemplatesTable.audience, parsed.data.audience));
  if (parsed.data.repId) filters.push(eq(collateralTemplatesTable.repUserId, parsed.data.repId));
  const rows = await db.select().from(collateralTemplatesTable).where(and(...filters)).orderBy(desc(collateralTemplatesTable.updatedAt));
  res.json(rows.map((template) => ({
    templateId: template.id,
    objectPath: template.sourceKey,
    name: normalizeCollateralFlyerDisplayName(template.name, template.originalFilename),
    contentType: template.assetContentType,
    size: template.assetSize,
    category: template.campaignCategory,
    vertical: template.vertical,
    audience: template.audience,
    repId: template.repUserId,
  })));
});

router.get("/collateral/flyers/:id/public-url", async (req, res) => {
  const u = await user(req, res);
  if (!u) return;
  const id = Number(req.params.id);
  const template = Number.isInteger(id) && id > 0
    ? await db.query.collateralTemplatesTable.findFirst({ where: eq(collateralTemplatesTable.id, id) })
    : null;
  if (!template || template.category !== "flyer" || template.status !== "published" ||
      !template.campaignCategory || !template.assetSha256 || !template.assetGeneration ||
      !template.assetContentType || !template.assetSize) {
    return void res.status(404).json({ error: "Published library flyer not found" });
  }
  const expiresAt = Date.now() + COLLATERAL_FLYER_PUBLIC_TTL_SECONDS * 1000;
  const url = buildSignedCampaignFlyerUrl({
    templateId: template.id,
    objectPath: template.sourceKey,
    digest: template.assetSha256,
    generation: template.assetGeneration,
    name: normalizeCollateralFlyerDisplayName(template.name, template.originalFilename),
    contentType: template.assetContentType as "image/png" | "application/pdf",
  }, COLLATERAL_FLYER_PUBLIC_TTL_SECONDS);
  res.json({ url, expiresAt: new Date(expiresAt).toISOString(), expiresInSeconds: COLLATERAL_FLYER_PUBLIC_TTL_SECONDS });
});

router.get("/collateral/flyers/public/:token", async (req, res) => {
  if (!secret) return void res.status(503).json({ error: "Collateral links are not configured" });
  const [encoded, signature] = String(req.params.token).split(".");
  if (!encoded || !signature) return void res.status(403).json({ error: "Flyer link expired or invalid" });
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); } catch { return void res.status(403).json({ error: "Flyer link expired or invalid" }); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return void res.status(403).json({ error: "Flyer link expired or invalid" });
  }
  let payload: CampaignFlyerTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as CampaignFlyerTokenPayload;
  } catch { return void res.status(403).json({ error: "Flyer link expired or invalid" }); }
  if (!payload || !Number.isInteger(payload.templateId) || payload.expiresAt <= Date.now() ||
      !/^\/objects\/collateral-library\/[0-9a-f-]{36}$/.test(payload.objectPath) ||
      !/^[a-f0-9]{64}$/i.test(payload.digest) ||
      !["image/png", "application/pdf"].includes(payload.contentType)) {
    return void res.status(403).json({ error: "Flyer link expired or invalid" });
  }
  const template = await db.query.collateralTemplatesTable.findFirst({
    where: eq(collateralTemplatesTable.id, payload.templateId),
  });
  if (!template || template.category !== "flyer" || template.status !== "published" ||
      !template.campaignCategory || template.sourceKey !== payload.objectPath ||
      template.assetSha256 !== payload.digest || template.assetGeneration !== payload.generation ||
      template.assetContentType !== payload.contentType ||
      (template.name !== payload.name &&
        normalizeCollateralFlyerDisplayName(template.name, template.originalFilename) !== payload.name)) {
    return void res.status(404).json({ error: "Approved flyer not found" });
  }
  try {
    const asset = await objectStorage.readObjectEntity(payload.objectPath, MAX_COLLATERAL_FLYER_BYTES);
    const actualDigest = crypto.createHash("sha256").update(asset.bytes).digest("hex");
    if (asset.generation !== payload.generation || asset.size !== template.assetSize ||
        asset.bytes.length !== asset.size || actualDigest !== payload.digest ||
        detectCollateralFlyerContentType(asset.bytes) !== payload.contentType) {
      return void res.status(409).json({ error: "Approved flyer integrity check failed" });
    }
    const extension = payload.contentType === "image/png" ? "png" : "pdf";
    const displayName = normalizeCollateralFlyerDisplayName(template.name, template.originalFilename);
    const filename = `${displayName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "flyer"}.${extension}`;
    res.type(payload.contentType)
      .set("Content-Disposition", `inline; filename="${filename}"`)
      .set("Cache-Control", "public, max-age=60")
      .send(asset.bytes);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return void res.status(404).json({ error: "Approved flyer not found" });
    req.log.error({ err: error }, "Error serving signed campaign flyer");
    res.status(503).json({ error: "Approved flyer unavailable" });
  }
});
router.get("/collateral/campaign-assets/:slug", campaignAssetHandler("inline"));
router.get("/collateral/campaign-assets/:slug/download", campaignAssetHandler("attachment"));

router.get("/collateral/templates/:id", async (req, res) => {
  const u = await user(req, res); if (!u) return;
  const t = await db.query.collateralTemplatesTable.findFirst({ where: eq(collateralTemplatesTable.id, Number(req.params.id)) });
  if (!t || !canReadCollateralTemplate(u, t)) return void res.status(404).json({ error: "Template not found" });
  res.json(t);
});
router.get("/collateral/templates/:id/thumbnail", async (req, res) => {
  const u = await user(req, res); if (!u) return;
  const t = await db.query.collateralTemplatesTable.findFirst({ where: eq(collateralTemplatesTable.id, Number(req.params.id)) });
  if (!t || !canReadCollateralTemplate(u, t)) return void res.status(404).json({ error: "Template not found" });
  const campaignBytes = await campaignSourceBytes(t.sourceKey);
  if (campaignBytes) {
    res.type("image/png").set("Cache-Control", "private, max-age=3600").send(campaignBytes);
    return;
  }
  const title = t.name.replace(/[<&>"]/g, "");
  res.type("svg").send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#f4f7fa"/><rect x="0" y="0" width="640" height="72" fill="#0B2948"/><rect x="32" y="28" width="120" height="16" rx="8" fill="#17B26A"/><text x="32" y="150" fill="#0B2948" font-family="Arial" font-size="28" font-weight="bold">${title}</text><text x="32" y="190" fill="#64748b" font-family="Arial" font-size="15">Personalized collateral preview</text><rect x="32" y="300" width="576" height="2" fill="#17B26A"/></svg>`);
});

router.post("/collateral/templates", async (req, res) => {
  const u = await user(req, res); if (!u || !canManageCollateralTemplates(u)) return void res.status(403).json({ error: "Admin access required" });
  const parsed = templateBody.safeParse(req.body); if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message });
  const [row] = await db.insert(collateralTemplatesTable).values({ ...parsed.data, createdBy: u.id }).returning();
  res.status(201).json(row);
});
router.patch("/collateral/templates/:id", async (req, res) => {
  const u = await user(req, res); if (!u || !canManageCollateralTemplates(u)) return void res.status(403).json({ error: "Admin access required" });
  const patch = templateBody.partial().safeParse(req.body); if (!patch.success) return void res.status(400).json({ error: "Invalid template" });
  const templateId = Number(req.params.id);
  const [row] = await db.update(collateralTemplatesTable).set({ ...patch.data, updatedAt: new Date() })
    .where(and(eq(collateralTemplatesTable.id, templateId),
      sql`NOT (${collateralTemplatesTable.category} = 'flyer' AND ${collateralTemplatesTable.status} = 'published' AND ${collateralTemplatesTable.assetSha256} IS NOT NULL)`)).returning();
  if (!row) {
    const [existing] = await db.select({ id: collateralTemplatesTable.id }).from(collateralTemplatesTable)
      .where(eq(collateralTemplatesTable.id, templateId)).limit(1);
    return void res.status(existing ? 409 : 404).json({ error: existing ? "Published library flyers are immutable" : "Template not found" });
  }
  res.json(row);
});
router.post("/collateral/templates/:id/publish", async (req, res) => {
  const u = await user(req, res); if (!u || !canManageCollateralTemplates(u)) return void res.status(403).json({ error: "Admin access required" });
  const [row] = await db.update(collateralTemplatesTable).set({ status: "published", updatedAt: new Date() }).where(eq(collateralTemplatesTable.id, Number(req.params.id))).returning();
  res.json(row);
});
router.post("/collateral/templates/:id/archive", async (req, res) => {
  const u = await user(req, res); if (!u || !canManageCollateralTemplates(u)) return void res.status(403).json({ error: "Admin access required" });
  const templateId = Number(req.params.id);
  const [row] = await db.update(collateralTemplatesTable).set({ status: "draft", updatedAt: new Date() })
    .where(and(eq(collateralTemplatesTable.id, templateId),
      sql`NOT (${collateralTemplatesTable.category} = 'flyer' AND ${collateralTemplatesTable.status} = 'published' AND ${collateralTemplatesTable.assetSha256} IS NOT NULL)`)).returning();
  if (!row) {
    const [existing] = await db.select({ id: collateralTemplatesTable.id }).from(collateralTemplatesTable)
      .where(eq(collateralTemplatesTable.id, templateId)).limit(1);
    return void res.status(existing ? 409 : 404).json({ error: existing ? "Published library flyers cannot be archived while signed links may be active" : "Template not found" });
  }
  res.json(row);
});

router.get("/collateral/templates/:id/render", async (req, res) => {
  const viewer = await user(req, res); if (!viewer) return;
  const t = await db.query.collateralTemplatesTable.findFirst({ where: eq(collateralTemplatesTable.id, Number(req.params.id)) });
  if (!t || !canReadCollateralTemplate(viewer, t)) return void res.status(404).json({ error: "Template not found" });
  const repId = Number(req.query.repId) || viewer.id;
  if (!canRenderCollateralForRep(viewer, repId)) return void res.status(403).json({ error: "Forbidden" });
  const rep = await db.query.usersTable.findFirst({ where: eq(usersTable.id, repId) });
  if (!rep) return void res.status(404).json({ error: "Rep not found" });
  const fields = t.sourceKey === FINANCE_APPLICATION_SOURCE_KEY
    ? await enrichApplicationPdfRep(db, rep.id, repFields(rep))
    : repFields(rep);
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
  if (!r || !canAccessCollateralRender(u, r.userId)) return void res.status(404).json({ error: "Render not found" });
  try {
    const file = await objectStorage.getObjectEntityFile(r.fileKey);
    const [pdf] = await file.download();
    const filename = `${r.template.name.replace(/[^a-z0-9._-]+/gi, "-") || "collateral"}.pdf`;
    res
      .type("application/pdf")
      .set("Content-Disposition", `inline; filename="${filename}"`)
      .set("Cache-Control", "private, no-store")
      .send(pdf);
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
  if (!r || !lead?.email || !canAccessCollateralRender(u, r.userId)) return void res.status(404).json({ error: "Render or lead not found" });
  if (!canEmailCollateralToLead(u, lead)) return void res.status(403).json({ error: "Forbidden" });
  try {
    const file = await objectStorage.getObjectEntityFile(r.fileKey);
    const [pdf] = await file.download();
    await sendCollateralEmail(sgMail, {
      leadEmail: lead.email,
      repEmail: r.user.email,
      repName: r.user.name,
      subject: body.data.subject,
      bodyHtml: body.data.bodyHtml,
      templateName: r.template.name,
      pdf,
    });
    await recordCollateralEmailDelivery({
      associateRender: async (renderId, leadId) => {
        await db.update(collateralRendersTable).set({ leadId }).where(eq(collateralRendersTable.id, renderId));
      },
      writeActivity: logActivity,
    }, {
      renderId: r.id,
      templateId: r.templateId,
      leadId: lead.id,
      userId: u.id,
      recipientEmail: lead.email,
    });
    res.json({ sent: true });
  } catch { res.status(503).json({ error: "Email delivery failed" }); }
});
router.get("/collateral/renders/:id/link", async (req, res) => {
  const u = await user(req, res); if (!u) return;
  const r = await db.query.collateralRendersTable.findFirst({
    where: eq(collateralRendersTable.id, Number(req.params.id)),
  });
  if (!r || !canAccessCollateralRender(u, r.userId)) {
    return void res.status(404).json({ error: "Render not found" });
  }
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