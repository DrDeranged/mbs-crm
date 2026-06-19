import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { leadsTable, companiesTable } from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are supported"));
    }
  },
});

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (lines.length < 2) return { headers: [], rows: [] };

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

  const headers = parseLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });
    rows.push(row);
  }
  return { headers, rows };
}

const FIELD_MAP: Record<string, string> = {
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
  phone: "phone",
  company_name: "companyName",
  ein: "ein",
  application_type: "applicationType",
  lead_source: "leadSource",
};

router.post("/leads/import", upload.single("file"), async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  const text = req.file.buffer.toString("utf-8");
  const { rows } = parseCSV(text);

  if (rows.length === 0) {
    res.status(400).json({ error: "CSV file is empty or has no data rows" });
    return;
  }

  let imported = 0;
  let skipped = 0;
  const duplicates: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const firstName = row.first_name || row.firstname || "";
    const lastName = row.last_name || row.lastname || "";
    const email = row.email?.toLowerCase() || null;
    const phone = row.phone || null;
    const companyName = row.company_name || row.company || null;
    const ein = row.ein || null;

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

    const appType = row.application_type || row.applicationtype || "working_capital";
    const leadSource = row.lead_source || row.leadsource || "import";

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

    if (companyName && !row.company_name_skip) {
      const industry = row.industry || null;
      const state = row.state || null;
      if (industry || state) {
        await db.insert(companiesTable).values({ leadId: lead.id, industry, state }).catch(() => {});
      }
    }

    await logActivity({
      userId: user.id,
      leadId: lead.id,
      action: "imported",
      entityType: "lead",
      entityId: lead.id,
      details: { row: rowNum, source: "csv_import" },
    });

    imported++;
  }

  res.json({ imported, skipped, duplicates });
});

export default router;
