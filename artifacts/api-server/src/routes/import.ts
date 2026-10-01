import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { leadsTable, companiesTable } from "@workspace/db";
import { or, ilike } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import {
  normalizeLeadVertical,
  parseLeadImportBuffer,
  resolveLeadImportValue,
  type ParsedLeadImportRow,
} from "../lib/leadImport";

const router: IRouter = Router();
const columnMappingSchema = z.record(z.string(), z.string());
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    if (
      allowed.includes(file.mimetype) ||
      file.originalname.endsWith(".csv") ||
      file.originalname.endsWith(".xlsx") ||
      file.originalname.endsWith(".xls")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV and Excel (.xlsx/.xls) files are supported"));
    }
  },
});

/**
 * POST /leads/import/preview
 *
 * Upload a CSV or XLSX file and get back the detected column headers plus
 * the first 5 data rows so the user can verify the mapping before confirming.
 */
router.post("/leads/import/preview", upload.single("file"), async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") {
    res.status(403).json({ error: "Forbidden: managers and admins only" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  const { headers, rows } = await parseLeadImportBuffer(req.file.buffer, req.file.mimetype, req.file.originalname);
  if (rows.length === 0) {
    res.status(400).json({ error: "File is empty or has no data rows" });
    return;
  }

  res.json({
    headers,
    previewRows: rows.slice(0, 5),
    totalRows: rows.length,
  });
});

/**
 * POST /leads/import
 *
 * Upload a CSV or XLSX file and import all leads. Skips duplicates by email.
 * Optionally accepts a columnMapping object to map file columns to lead fields.
 */
router.post("/leads/import", upload.single("file"), async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") {
    res.status(403).json({ error: "Forbidden: managers and admins only" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  let columnMapping: Record<string, string> = {};
  const rawColumnMapping = (req.body as Record<string, unknown> | undefined)?.columnMapping;
  if (rawColumnMapping !== undefined && rawColumnMapping !== "") {
    try {
      const parsed = columnMappingSchema.safeParse(
        typeof rawColumnMapping === "string" ? JSON.parse(rawColumnMapping) : rawColumnMapping,
      );
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid columnMapping" });
      }
      columnMapping = parsed.data;
    } catch {
      return void res.status(400).json({ error: "Invalid columnMapping" });
    }
  }

  const { rows } = await parseLeadImportBuffer(req.file.buffer, req.file.mimetype, req.file.originalname);
  if (rows.length === 0) {
    res.status(400).json({ error: "File is empty or has no data rows" });
    return;
  }

  // Frontend sends mapping as { fileColumn -> leadField }.
  // Invert to { leadField -> fileColumn } so resolve() can look up by canonical field name.
  const invertedMapping: Record<string, string> = {};
  for (const [fileCol, leadField] of Object.entries(columnMapping)) {
    if (leadField && leadField !== "__skip__") {
      invertedMapping[leadField] = fileCol;
    }
  }

  const resolve = (row: ParsedLeadImportRow, ...candidates: string[]) =>
    resolveLeadImportValue(row, invertedMapping, ...candidates);

  let imported = 0;
  let skipped = 0;
  const duplicates: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const firstName = resolve(row, "first_name", "firstname", "first");
    const lastName = resolve(row, "last_name", "lastname", "last");
    const email = resolve(row, "email")?.toLowerCase() || null;
    const phone = resolve(row, "phone", "phone_number") || null;
    const companyName = resolve(row, "company_name", "company", "business_name") || null;
    const ein = resolve(row, "ein", "tax_id") || null;
    const vertical = normalizeLeadVertical(resolve(row, "vertical", "business_vertical", "industry_vertical"));

    if (!firstName && !lastName && !email) {
      skipped++;
      continue;
    }

    const dupConditions = [];
    if (email) dupConditions.push(ilike(leadsTable.email, email));
    if (phone) dupConditions.push(ilike(leadsTable.phone, phone));
    if (ein) dupConditions.push(ilike(leadsTable.ein, ein));

    if (dupConditions.length > 0) {
      const existing = await db.query.leadsTable.findFirst({
        where: or(...dupConditions),
      });
      if (existing) {
        const reason = email && existing.email?.toLowerCase() === email
          ? `Duplicate email: ${email}`
          : phone && existing.phone === phone
          ? `Duplicate phone: ${phone}`
          : `Duplicate EIN: ${ein}`;
        duplicates.push({ row: rowNum, reason });
        skipped++;
        continue;
      }
    }

    const appType = resolve(row, "application_type", "applicationtype", "financing_type") || "working_capital";
    const leadSource = resolve(row, "lead_source", "leadsource", "source") || "import";
    const notes = resolve(row, "notes");

    const industry = resolve(row, "industry") || null;
    const state = resolve(row, "state") || null;

    const lead = await db.transaction(async (tx) => {
      const [txLead] = await tx.insert(leadsTable).values({
        firstName,
        lastName,
        email,
        phone,
        companyName,
        vertical,
        ein,
        applicationType: appType as any,
        leadSource: leadSource as any,
        assignedRepId: null,
      }).returning();

      if (companyName && (industry || state)) {
        await tx.insert(companiesTable).values({ leadId: txLead.id, industry, state }).catch(() => {});
      }

      return txLead;
    });

    await logActivity({
      userId: user.id,
      leadId: lead.id,
      action: "lead_created",
      entityType: "lead",
      entityId: lead.id,
      details: { row: rowNum, source: req.file.originalname.endsWith(".xlsx") || req.file.originalname.endsWith(".xls") ? "xlsx_import" : "csv_import" },
    });

    if (notes) {
      await logActivity({
        userId: user.id,
        leadId: lead.id,
        action: "captured",
        entityType: "lead",
        entityId: lead.id,
        details: {
          source: "csv_import",
          message: notes.slice(0, 2000),
        },
      });
    }

    imported++;
  }

  res.json({ imported, skipped, duplicates });
});

export default router;
