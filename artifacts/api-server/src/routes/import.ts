import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db } from "@workspace/db";
import { leadsTable, companiesTable } from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";

const router: IRouter = Router();
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

type ParsedRow = Record<string, string>;

function parseBuffer(buffer: Buffer, mimetype: string, originalname: string): { headers: string[]; rows: ParsedRow[] } {
  const isExcel =
    mimetype.includes("spreadsheetml") ||
    mimetype.includes("ms-excel") ||
    originalname.endsWith(".xlsx") ||
    originalname.endsWith(".xls");

  let rawRows: Record<string, unknown>[];

  if (isExcel) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  } else {
    const text = buffer.toString("utf-8");
    rawRows = csvToRows(text);
  }

  if (rawRows.length === 0) return { headers: [], rows: [] };

  const headers = Object.keys(rawRows[0]).map((h) =>
    h.toLowerCase().replace(/\s+/g, "_"),
  );
  const rows: ParsedRow[] = rawRows.map((r) => {
    const out: ParsedRow = {};
    headers.forEach((h, i) => {
      out[h] = String(Object.values(r)[i] ?? "");
    });
    return out;
  });

  return { headers, rows };
}

function csvToRows(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });
    rows.push(row);
  }
  return rows;
}

/**
 * POST /leads/import/preview
 *
 * Upload a CSV or XLSX file and get back the detected column headers plus
 * the first 5 data rows so the user can verify the mapping before confirming.
 */
router.post("/leads/import/preview", upload.single("file"), async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  const { headers, rows } = parseBuffer(req.file.buffer, req.file.mimetype, req.file.originalname);
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

  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  let columnMapping: Record<string, string> = {};
  if (req.body?.columnMapping) {
    try {
      columnMapping = typeof req.body.columnMapping === "string"
        ? JSON.parse(req.body.columnMapping)
        : req.body.columnMapping;
    } catch {
      columnMapping = {};
    }
  }

  const { rows } = parseBuffer(req.file.buffer, req.file.mimetype, req.file.originalname);
  if (rows.length === 0) {
    res.status(400).json({ error: "File is empty or has no data rows" });
    return;
  }

  const resolve = (row: ParsedRow, ...candidates: string[]): string => {
    for (const c of candidates) {
      const mapped = columnMapping[c] || c;
      if (row[mapped]) return row[mapped];
      if (row[c]) return row[c];
    }
    return "";
  };

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

    if (!firstName && !lastName && !email) {
      skipped++;
      continue;
    }

    if (email) {
      const existing = await db.query.leadsTable.findFirst({
        where: (t, { eq }) => eq(t.email, email),
      });
      if (existing) {
        duplicates.push({ row: rowNum, reason: `Duplicate email: ${email}` });
        skipped++;
        continue;
      }
    }

    const appType = resolve(row, "application_type", "applicationtype", "financing_type") || "working_capital";
    const leadSource = resolve(row, "lead_source", "leadsource", "source") || "import";

    const [lead] = await db.insert(leadsTable).values({
      firstName,
      lastName,
      email,
      phone,
      companyName,
      ein,
      applicationType: appType as any,
      leadSource: leadSource as any,
      assignedRepId: user.role === "rep" ? user.id : null,
    }).returning();

    const industry = resolve(row, "industry") || null;
    const state = resolve(row, "state") || null;
    if (companyName && (industry || state)) {
      await db.insert(companiesTable).values({ leadId: lead.id, industry, state }).catch(() => {});
    }

    await logActivity({
      userId: user.id,
      leadId: lead.id,
      action: "imported",
      entityType: "lead",
      entityId: lead.id,
      details: { row: rowNum, source: req.file.originalname.endsWith(".xlsx") || req.file.originalname.endsWith(".xls") ? "xlsx_import" : "csv_import" },
    });

    imported++;
  }

  res.json({ imported, skipped, duplicates });
});

export default router;
