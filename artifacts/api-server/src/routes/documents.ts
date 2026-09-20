import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import { db } from "@workspace/db";
import { documentsTable, leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireUser, userToApi } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { ListDocumentsParams, DownloadDocumentParams } from "@workspace/api-zod";
import { isDocumentCategory } from "../lib/documentsCategory";
import { documentContentDisposition } from "../lib/documentDownload";

type Database = typeof db;
export type DocumentsRouteDependencies = {
  database?: Database;
  authenticate?: typeof requireUser;
  activityLogger?: typeof logActivity;
};

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/csv",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("File type not allowed. Accepted: PDF, images, Word, Excel, text/CSV."));
    }
  },
});
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
    category: doc.category,
    label: doc.label,
    createdAt: doc.createdAt.toISOString(),
  };
}

export function createDocumentsRouter(dependencies: DocumentsRouteDependencies = {}): IRouter {
  const database = dependencies.database ?? db;
  const authenticate = dependencies.authenticate ?? requireUser;
  const activityLogger = dependencies.activityLogger ?? logActivity;
  const router: IRouter = Router();

  router.get("/leads/:id/documents", async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;

  const params = ListDocumentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const lead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, params.data.id) });
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const docs = await database.query.documentsTable.findMany({
    where: eq(documentsTable.leadId, params.data.id),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: { uploader: true },
  });

  res.json(docs.map((d) => docToApi(d, (d as any).uploader)));
  });

  router.post("/leads/:id/documents", upload.single("file"), async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
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

  const lead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const category = req.body?.category;
  if (!isDocumentCategory(category)) {
    res.status(400).json({ error: "A valid document category is required" });
    return;
  }

  try {
    const ext = path.extname(req.file.originalname);
    const fileKey = `leads/${leadId}/documents/${Date.now()}${ext}`;
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "";
    const { objectStorageClient } = await import("../lib/objectStorage");
    const bucket = objectStorageClient.bucket(bucketId);
    const file = bucket.file(fileKey);
    await file.save(req.file.buffer, { contentType: req.file.mimetype });

    const [doc] = await database.insert(documentsTable).values({
      leadId,
      userId: user.id,
      filename: req.file.originalname,
      fileKey,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      category,
      label: typeof req.body?.label === "string" ? req.body.label : null,
    }).returning();

    await activityLogger({
      userId: user.id,
      leadId,
      action: "document_uploaded",
      entityType: "document",
      entityId: doc.id,
      details: { filename: req.file.originalname, category },
    });

    res.status(201).json(docToApi(doc, user));
  } catch (err) {
    req.log.error({ err }, "Failed to upload document");
    res.status(500).json({ error: "Upload failed" });
  }
  });

  router.patch("/documents/:docId", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;

    const params = DownloadDocumentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }
    const doc = await database.query.documentsTable.findFirst({
      where: eq(documentsTable.id, params.data.docId),
    });
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const lead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, doc.leadId) });
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    if (user.role === "rep" && lead.assignedRepId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const category = req.body?.category;
    if (!isDocumentCategory(category)) {
      res.status(400).json({ error: "A valid document category is required" });
      return;
    }

    const [updated] = await database.update(documentsTable)
      .set({ category })
      .where(eq(documentsTable.id, doc.id))
      .returning();
    await activityLogger({
      userId: user.id,
      leadId: lead.id,
      action: "document_category_updated",
      entityType: "document",
      entityId: doc.id,
      details: { filename: doc.filename, category },
    });
    res.json(docToApi(updated, undefined));
  });

  router.get("/documents/:docId/download", async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;

  const params = DownloadDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const doc = await database.query.documentsTable.findFirst({ where: eq(documentsTable.id, params.data.docId) });
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const lead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, doc.leadId) });
  if (lead && user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "";
    const { objectStorageClient } = await import("../lib/objectStorage");
    const bucket = objectStorageClient.bucket(bucketId);
    const file = bucket.file(doc.fileKey);
    if (req.query.direct === "true") {
      const [contents] = await file.download();
      res
        .type(doc.fileType || "application/octet-stream")
        .set("Content-Disposition", documentContentDisposition(doc.filename, doc.id))
        .set("Cache-Control", "private, no-store")
        .send(contents);
      return;
    }
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

  return router;
}

export default createDocumentsRouter();
