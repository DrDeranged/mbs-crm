import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { eq } from "drizzle-orm";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireUser } from "../lib/authHelpers";
import { db } from "@workspace/db";
import { documentsTable, leadsTable } from "@workspace/db";
import { z } from "zod/v4";
import { verifyVoicemailPlaybackToken } from "../lib/voicemail";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const CAMPAIGN_FLYER_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;
const MAX_CAMPAIGN_FLYER_BYTES = 15 * 1024 * 1024;

router.post("/storage/campaign-flyers/request-url", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "manager" && user.role !== "admin") {
    res.status(403).json({ error: "Manager or admin role required" });
    return;
  }
  const parsed = z.object({
    name: z.string().trim().min(1).max(255),
    size: z.number().int().positive().max(MAX_CAMPAIGN_FLYER_BYTES),
    contentType: z.enum(CAMPAIGN_FLYER_TYPES),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `Flyers must be PNG, JPG, WebP, or PDF files up to ${MAX_CAMPAIGN_FLYER_BYTES / 1024 / 1024} MB` });
    return;
  }
  try {
    const upload = await objectStorageService.getCampaignFlyerUploadURL(user.id);
    res.json({ ...upload, name: parsed.data.name, size: parsed.data.size, contentType: parsed.data.contentType });
  } catch (error) {
    req.log.error({ err: error }, "Error generating campaign flyer upload URL");
    res.status(500).json({ error: "Failed to generate flyer upload URL" });
  }
});

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const fileKey = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadUrl: uploadURL,
        fileKey,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * Authenticated, short-lived playback for inbound voicemail recordings.
 * The token is an HMAC over the document id and expiry; the lead ownership
 * check below remains authoritative even if a token is disclosed.
 */
router.get("/storage/voicemail-playback/:token", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const documentId = verifyVoicemailPlaybackToken(req.params.token as string);
  if (!documentId) {
    res.status(404).json({ error: "Playback link expired or invalid" });
    return;
  }
  try {
    const doc = await db.query.documentsTable.findFirst({ where: eq(documentsTable.id, documentId) });
    if (!doc || (!doc.label?.startsWith("Voicemail ") && !doc.label?.startsWith("Call recording "))) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }
    const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, doc.leadId) });
    if (!lead || (user.role === "rep" && lead.assignedRepId !== user.id)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const file = await objectStorageService.getObjectEntityFile(`/objects/${doc.fileKey}`);
    const response = await objectStorageService.downloadObject(file, 0);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Disposition", `inline; filename="${doc.filename.replace(/["\\\r\n]/g, "_")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    else res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving voicemail playback");
    res.status(500).json({ error: "Failed to serve voicemail playback" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;

    // Deny-by-default: only serve paths that match a known authorized pattern.
    // Currently the only private objects are lead documents.
    if (/^leads\/\d+\/documents\/(?:voicemail|call-recording)-[^/]+\.mp3$/i.test(wildcardPath)) {
      res.status(404).json({ error: "Recording playback must use a signed URL" });
      return;
    }
    const leadDocMatch = wildcardPath.match(/^leads\/(\d+)\/documents\/.+/);
    const campaignFlyerMatch = wildcardPath.match(/^campaigns\/(\d+)\/.+/);
    if (leadDocMatch) {
      const leadId = Number(leadDocMatch[1]);
      // Reps may only access documents on leads assigned to them.
      if (user.role === "rep") {
        const lead = await db.query.leadsTable.findFirst({
          where: eq(leadsTable.id, leadId),
        });
        if (!lead || lead.assignedRepId !== user.id) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
      } else {
        // Managers and admins: verify the document record exists in DB (prevents path guessing).
        const doc = await db.query.documentsTable.findFirst({
          where: eq(documentsTable.leadId, leadId),
        });
        if (!doc) {
          res.status(404).json({ error: "Object not found" });
          return;
        }
      }
    } else if (campaignFlyerMatch) {
      const ownerId = Number(campaignFlyerMatch[1]);
      if (user.role !== "admin" && user.role !== "manager" && user.id !== ownerId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      // Managers may preview a just-uploaded file before saving it. Reps cannot browse campaign assets.
      if (user.role === "rep" || (user.role !== "admin" && user.role !== "manager")) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    } else {
      // Unrecognized private object path — deny access by default.
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
