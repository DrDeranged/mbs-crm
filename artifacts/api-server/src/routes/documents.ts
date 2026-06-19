import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import { db } from "@workspace/db";
import { documentsTable, leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireUser, userToApi } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { ListDocumentsParams, DownloadDocumentParams } from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
import { Readable } from "stream";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const objectStorage = new ObjectStorageService();

function docToApi(doc: typeof documentsTable.$inferSelect, uploader?: any) {
  return {
    id: doc.id,
    leadId: doc.leadId,
    userId: doc.userId,
    uploader: uploader ? userToApi(uploader) : null,
    filename: doc.filename,
    fileKey: doc.fileKey,
    fileType: doc.fileType,
    fileSize: doc.fileSize,
    createdAt: doc.createdAt.toISOString(),
  };
}

router.get("/leads/:id/documents", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const params = ListDocumentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, params.data.id) });
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const docs = await db.query.documentsTable.findMany({
    where: eq(documentsTable.leadId, params.data.id),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: { uploader: true },
  });

  res.json(docs.map((d) => docToApi(d, (d as any).uploader)));
});

router.post("/leads/:id/documents", upload.single("file"), async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  const leadId = Number(req.params.id);
  if (isNaN(leadId)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const ext = path.extname(req.file.originalname);
    const fileKey = `leads/${leadId}/documents/${Date.now()}${ext}`;
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "";
    const bucket = objectStorage["client"].bucket(bucketId);
    const file = bucket.file(fileKey);
    await file.save(req.file.buffer, { contentType: req.file.mimetype });

    const [doc] = await db.insert(documentsTable).values({
      leadId,
      userId: user.id,
      filename: req.file.originalname,
      fileKey,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
    }).returning();

    await logActivity({
      userId: user.id,
      leadId,
      action: "document_uploaded",
      entityType: "document",
      entityId: doc.id,
      details: { filename: req.file.originalname },
    });

    res.status(201).json(docToApi(doc, user));
  } catch (err) {
    req.log.error({ err }, "Failed to upload document");
    res.status(500).json({ error: "Upload failed" });
  }
});

router.get("/documents/:docId/download", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const params = DownloadDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const doc = await db.query.documentsTable.findFirst({ where: eq(documentsTable.id, params.data.docId) });
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, doc.leadId) });
  if (lead && user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "";
    const bucket = objectStorage["client"].bucket(bucketId);
    const file = bucket.file(doc.fileKey);
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 15 * 60 * 1000,
    });
    res.json({ downloadUrl: signedUrl, filename: doc.filename });
  } catch (err) {
    req.log.error({ err }, "Failed to generate download URL");
    res.status(500).json({ error: "Could not generate download URL" });
  }
});

export default router;
