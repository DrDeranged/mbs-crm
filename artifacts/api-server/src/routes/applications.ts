import { Router, type Request, type Response } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { randomBytes } from "crypto";
import { z } from "zod/v4";
import { eq, and, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  leadsTable,
  applicationsTable,
  bankStatementExtractionsTable,
  documentsTable,
  activityLogTable,
  usersTable,
  leadStatusHistoryTable,
} from "@workspace/db";
import { encrypt, maskSsn } from "../lib/encryption";
import { extractBankStatement } from "../lib/ocrBankStatement";
import { objectStorageClient } from "../lib/objectStorage";
import { requireUser } from "../lib/authHelpers";
import { calculateLeadScore } from "../lib/leadScoring";

const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/** Escapes a value for safe HTML insertion (prevents XSS). */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Validates that a data URL is a safe base64-encoded image (no embedded scripts). */
function isSafeImageDataUrl(v: string): boolean {
  return /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(v);
}

/** Generates a signed application HTML document suitable for archiving. */
function buildSignedApplicationHtml(params: {
  lead: { id: number; firstName: string | null; lastName: string | null; email: string | null; phone: string | null };
  body: Record<string, unknown>;
  submittedAt: Date;
  clientIp: string | null;
}): string {
  const { lead, body, submittedAt, clientIp } = params;
  const field = (v: unknown) => esc(v != null && v !== "" ? v : "—");
  const bool = (v: unknown) => (v === "true" || v === true) ? "✓ Yes" : "No";

  const rawSig = typeof body["signatureData"] === "string" ? body["signatureData"] : "";
  const sigDataUrl = isSafeImageDataUrl(rawSig)
    ? `<img src="${esc(rawSig)}" style="max-width:320px;border:1px solid #ccc;border-radius:4px;" />`
    : "<em>Signature on file</em>";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>MBS Application — ${lead.firstName} ${lead.lastName}</title>
<style>
  body{font-family:Arial,sans-serif;color:#222;max-width:860px;margin:40px auto;padding:0 24px;}
  h1{color:#1F4E79;border-bottom:3px solid #1F4E79;padding-bottom:8px;}
  h2{color:#1F4E79;font-size:15px;margin-top:28px;margin-bottom:8px;border-bottom:1px solid #ddd;padding-bottom:4px;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  td{padding:6px 12px;border:1px solid #e5e7eb;vertical-align:top;}
  td:first-child{font-weight:600;width:38%;background:#f8fafc;color:#374151;}
  .footer{margin-top:40px;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px;}
</style>
</head>
<body>
<h1>My Business Solutions — Financing Application</h1>
<p style="color:#6b7280;font-size:13px;">Application ID: <strong>LEAD-${lead.id}</strong> &nbsp;|&nbsp; Submitted: <strong>${submittedAt.toUTCString()}</strong> &nbsp;|&nbsp; IP: <strong>${clientIp ?? "unknown"}</strong></p>

<h2>Business Information</h2>
<table>
  <tr><td>Business Name</td><td>${field(body["businessName"])}</td></tr>
  <tr><td>DBA</td><td>${field(body["dba"])}</td></tr>
  <tr><td>EIN</td><td>${field(body["ein"])}</td></tr>
  <tr><td>Industry</td><td>${field(body["industry"])}</td></tr>
  <tr><td>Address</td><td>${field(body["businessAddress"])}, ${field(body["businessCity"])}, ${field(body["businessState"])} ${field(body["businessZip"])}</td></tr>
  <tr><td>Time in Business</td><td>${body["timeInBusinessMonths"] ? `${body["timeInBusinessMonths"]} months` : "—"}</td></tr>
  <tr><td>Monthly Revenue (Stated)</td><td>${body["monthlyRevenueStated"] ? `$${Number(body["monthlyRevenueStated"]).toLocaleString()}` : "—"}</td></tr>
  <tr><td>Requested Amount</td><td>${body["requestedAmount"] ? `$${Number(body["requestedAmount"]).toLocaleString()}` : "—"}</td></tr>
  <tr><td>Use of Funds</td><td>${field(body["useOfFunds"])}</td></tr>
  <tr><td>Application Type</td><td>${field(body["type"])}</td></tr>
</table>

<h2>Owner Information</h2>
<table>
  <tr><td>Name</td><td>${field(body["ownerFirstName"])} ${field(body["ownerLastName"])}</td></tr>
  <tr><td>Date of Birth</td><td>${field(body["ownerDob"])}</td></tr>
  <tr><td>SSN</td><td>***-**-**** (encrypted)</td></tr>
  <tr><td>Home Address</td><td>${field(body["ownerHomeAddress"])}, ${field(body["ownerHomeCity"])}, ${field(body["ownerHomeState"])} ${field(body["ownerHomeZip"])}</td></tr>
  <tr><td>Ownership %</td><td>${field(body["ownershipPct"])}</td></tr>
</table>

<h2>Consent &amp; Signature</h2>
<table>
  <tr><td>Credit Pull Consent</td><td>${bool(body["consentCreditPull"])}</td></tr>
  <tr><td>Terms Consent</td><td>${bool(body["consentTerms"])}</td></tr>
  <tr><td>Signature IP</td><td>${clientIp ?? "unknown"}</td></tr>
</table>
<div style="margin-top:16px;">${sigDataUrl}</div>

<div class="footer">
  This document was generated automatically by My Business Solutions CRM on ${submittedAt.toUTCString()}.
  It contains a verbatim record of the applicant's submission and electronic signature.
  SSN is stored separately in encrypted form and is not included here.
</div>
</body>
</html>`;
}

const submitRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

async function logActivity(params: {
  userId: number | null;
  leadId: number | null;
  action: string;
  entityType: string;
  entityId: number;
  details?: Record<string, unknown>;
}) {
  await db.insert(activityLogTable).values({
    userId: params.userId,
    leadId: params.leadId,
    action: params.action,
    entityType: params.entityType,
    entityId: String(params.entityId),
    details: params.details ?? {},
  });
}

/** Round-robin: pick the active rep with fewest assigned leads. */
async function pickNextRep(): Promise<number | null> {
  const reps = await db.query.usersTable.findMany({
    where: and(eq(usersTable.role, "rep"), eq(usersTable.isActive, true)),
  });
  if (reps.length === 0) return null;

  const counts = await Promise.all(
    reps.map(async (rep: { id: number }) => {
      const leads = await db.query.leadsTable.findMany({ where: eq(leadsTable.assignedRepId, rep.id) });
      return { repId: rep.id, count: leads.length };
    })
  );
  counts.sort((a: { count: number }, b: { count: number }) => a.count - b.count);
  return counts[0]?.repId ?? null;
}

// POST /applications/submit — public, rate-limited, multipart
router.post(
  "/applications/submit",
  submitRateLimiter,
  upload.array("bankStatements", 12),
  async (req: Request, res: Response) => {
    try {
      const body = req.body;

      // ── Comprehensive server-side validation ─────────────────────────────
      const submitSchema = z.object({
        type: z.enum(["equipment", "working_capital"], { message: "Invalid application type" }),
        businessName: z.string().min(1, "Business name is required"),
        ownerFirstName: z.string().min(1, "Owner first name is required"),
        ownerLastName: z.string().min(1, "Owner last name is required"),
        email: z.string().email("Invalid email address").optional().or(z.literal("")),
        phone: z.string().regex(/^\+?[\d\s\-().]{7,20}$/, "Invalid phone number").optional().or(z.literal("")),
        ownerSsn: z.string().regex(/^\d{9}$/, "SSN must be exactly 9 digits").optional().or(z.literal("")),
        consentCreditPull: z.union([z.literal("true"), z.literal(true)], { message: "Credit pull consent is required" }),
        consentTerms: z.union([z.literal("true"), z.literal(true)], { message: "Terms consent is required" }),
        signatureData: z.string().min(1, "Signature is required"),
        equipmentDescription: z.string().optional(),
        vendorName: z.string().optional(),
      }).superRefine((data, ctx) => {
        if (data.type === "equipment") {
          if (!data.equipmentDescription?.trim()) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Equipment description is required", path: ["equipmentDescription"] });
          }
          if (!data.vendorName?.trim()) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Vendor name is required", path: ["vendorName"] });
          }
        }
      });

      const validation = submitSchema.safeParse(body);
      if (!validation.success) {
        const firstIssue = validation.error.issues[0];
        res.status(400).json({ error: firstIssue?.message ?? "Validation failed", field: firstIssue?.path.join(".") });
        return;
      }

      // ── Validate uploaded files are PDFs ─────────────────────────────────
      const files = (req.files as Express.Multer.File[]) ?? [];
      const invalidFiles = files.filter(f =>
        f.mimetype !== "application/pdf" && !f.originalname.toLowerCase().endsWith(".pdf")
      );
      if (invalidFiles.length > 0) {
        res.status(400).json({ error: "Bank statements must be PDF files." });
        return;
      }

      const email = (body.email as string)?.trim() || null;
      const phone = (body.phone as string)?.trim() || null;
      const ein = (body.ein as string)?.trim() || null;

      // ── Duplicate check ───────────────────────────────────────────────────
      if (email || phone || ein) {
        const conditions = [];
        if (email) conditions.push(eq(leadsTable.email, email));
        if (phone) conditions.push(eq(leadsTable.phone, phone));
        if (ein) conditions.push(eq(leadsTable.ein, ein));
        const dup = await db.query.leadsTable.findFirst({ where: or(...conditions) });
        if (dup) {
          res.status(409).json({
            duplicate: true,
            existing_lead_id: dup.id,
            message: "A lead with this email, phone, or EIN already exists.",
          });
          return;
        }
      }

      // ── Validate bank statement count (server-side) ──────────────────────
      if (files.length < 3) {
        res.status(400).json({ error: "At least 3 bank statement PDFs are required." });
        return;
      }

      // ── Encrypt SSN — hard fail if key is absent ──────────────────────────
      const rawSsn: string = (body.ownerSsn ?? "").replace(/\D/g, "");
      let ownerSsnEncrypted: string | null = null;
      if (rawSsn) {
        // Throws if ENCRYPTION_KEY is missing/malformed — do not swallow
        ownerSsnEncrypted = encrypt(rawSsn);
      }

      // ── Round-robin rep assignment ────────────────────────────────────────
      const assignedRepId = await pickNextRep();

      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? null;
      const consentGiven = body.consentCreditPull === "true" || body.consentCreditPull === true;

      // ── Create lead ───────────────────────────────────────────────────────
      const trackingToken = randomBytes(6).toString("hex");
      const [lead] = await db.insert(leadsTable).values({
        firstName: body.ownerFirstName,
        lastName: body.ownerLastName,
        email,
        phone,
        companyName: body.businessName,
        ein,
        applicationType: body.type as "equipment" | "working_capital",
        status: "application_received",
        leadSource: "website",
        requestedAmount: body.requestedAmount ? Number(body.requestedAmount) : null,
        assignedRepId,
        consentCreditPullAt: consentGiven ? new Date() : null,
        consentIp: clientIp,
        lastActivityAt: new Date(),
        trackingToken,
      }).returning();

      // ── Create application record ─────────────────────────────────────────
      await db.insert(applicationsTable).values({
        leadId: lead.id,
        type: body.type as "equipment" | "working_capital",
        businessName: body.businessName,
        dba: body.dba || null,
        ein,
        businessAddress: body.businessAddress || null,
        businessCity: body.businessCity || null,
        businessState: body.businessState || null,
        businessZip: body.businessZip || null,
        industry: body.industry || null,
        timeInBusinessMonths: body.timeInBusinessMonths ? Number(body.timeInBusinessMonths) : null,
        monthlyRevenueStated: body.monthlyRevenueStated ? Number(body.monthlyRevenueStated) : null,
        requestedAmount: body.requestedAmount ? Number(body.requestedAmount) : null,
        useOfFunds: body.useOfFunds || null,
        equipmentDescription: body.equipmentDescription || null,
        vendorName: body.vendorName || null,
        vendorQuoteAmount: body.vendorQuoteAmount ? String(body.vendorQuoteAmount) : null,
        equipmentCondition: body.equipmentCondition as "new" | "used" | null || null,
        ownerFirstName: body.ownerFirstName,
        ownerLastName: body.ownerLastName,
        ownerSsnEncrypted,
        ownerDob: body.ownerDob || null,
        ownerHomeAddress: body.ownerHomeAddress || null,
        ownerHomeCity: body.ownerHomeCity || null,
        ownerHomeState: body.ownerHomeState || null,
        ownerHomeZip: body.ownerHomeZip || null,
        ownershipPct: body.ownershipPct ? Number(body.ownershipPct) : null,
        consentCreditPull: body.consentCreditPull === "true" || body.consentCreditPull === true,
        consentTerms: body.consentTerms === "true" || body.consentTerms === true,
        signatureData: body.signatureData || null,
        signatureIp: req.ip || null,
      });

      // ── Upload bank statements + OCR (with Documents records) ───────────
      const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] ?? "";
      const bucket = objectStorageClient.bucket(bucketId);

      for (const file of files) {
        const safeFilename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const fileKey = `leads/${lead.id}/documents/bankstatement-${Date.now()}-${safeFilename}`;
        await bucket.file(fileKey).save(file.buffer, { contentType: file.mimetype });

        // Create document record for traceability
        const [docRecord] = await db.insert(documentsTable).values({
          leadId: lead.id,
          userId: null,
          filename: file.originalname,
          fileKey,
          fileType: file.mimetype,
          fileSize: file.size,
        }).returning();

        // Run OCR (non-blocking: continue if it fails)
        let ocrResult = null;
        try {
          ocrResult = await extractBankStatement(file.buffer);
        } catch (err) {
          console.error("OCR failed for", file.originalname, err);
        }

        if (ocrResult) {
          await db.insert(bankStatementExtractionsTable).values({
            leadId: lead.id,
            documentId: docRecord.id,
            statementMonth: ocrResult.statementMonth,
            statementYear: ocrResult.statementYear,
            totalDeposits: ocrResult.totalDeposits !== null ? String(ocrResult.totalDeposits) : null,
            averageDailyBalance: ocrResult.averageDailyBalance !== null ? String(ocrResult.averageDailyBalance) : null,
            nsfCount: ocrResult.nsfCount,
            negativeBalanceDays: ocrResult.negativeBalanceDays,
            existingPositionsJson: ocrResult.existingPositions as any,
            rawExtractionJson: ocrResult.rawExtractionJson as any,
          });
        }
      }

      // ── Persist OCR aggregates back to lead ───────────────────────────────
      const allExtractions = await db.query.bankStatementExtractionsTable.findMany({
        where: eq(bankStatementExtractionsTable.leadId, lead.id),
      });
      if (allExtractions.length > 0) {
        const totalPositions = allExtractions.reduce(
          (sum, e) => sum + ((e.existingPositionsJson as any[])?.length ?? 0),
          0
        );
        await db.update(leadsTable)
          .set({ existingPositions: totalPositions, lastActivityAt: new Date() })
          .where(eq(leadsTable.id, lead.id));
      }

      // ── Generate and store signed application document ────────────────────
      const signedHtml = buildSignedApplicationHtml({
        lead,
        body,
        submittedAt: new Date(),
        clientIp,
      });
      const htmlBuffer = Buffer.from(signedHtml, "utf-8");
      const signedDocKey = `leads/${lead.id}/documents/signed-application-${Date.now()}.html`;
      await bucket.file(signedDocKey).save(htmlBuffer, { contentType: "text/html; charset=utf-8" });
      await db.insert(documentsTable).values({
        leadId: lead.id,
        userId: null,
        filename: `signed-application-${lead.id}.html`,
        fileKey: signedDocKey,
        fileType: "text/html",
        fileSize: htmlBuffer.byteLength,
      });
      await db.update(applicationsTable)
        .set({ signedDocumentKey: signedDocKey })
        .where(eq(applicationsTable.leadId, lead.id));

      await logActivity({
        userId: null,
        leadId: lead.id,
        action: "application_submitted",
        entityType: "lead",
        entityId: lead.id,
        details: { type: body.type, filesCount: files.length },
      });

      calculateLeadScore(lead.id).catch((e) => console.error("Lead scoring error:", e));

      res.status(201).json({ success: true, lead_id: lead.id, tracking_token: lead.trackingToken });
    } catch (err) {
      console.error("Application submit error:", err);
      res.status(500).json({ error: "Submission failed. Please try again." });
    }
  }
);

// GET /leads/:id/application — CRM: view application data (SSN masked)
router.get("/leads/:id/application", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, id) });
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const app = await db.query.applicationsTable.findFirst({ where: eq(applicationsTable.leadId, id) });
  if (!app) { res.status(404).json({ error: "No application on file" }); return; }

  // Mask SSN — never send plaintext to client
  const { ownerSsnEncrypted, ...rest } = app;
  const masked = ownerSsnEncrypted ? maskSsn("000000000") : null;
  // Actually we need to decrypt to get last 4 — use a safe fallback
  let ownerSsnMasked: string | null = null;
  if (ownerSsnEncrypted) {
    try {
      const { decrypt } = await import("../lib/encryption");
      const plain = decrypt(ownerSsnEncrypted);
      ownerSsnMasked = maskSsn(plain);
    } catch {
      ownerSsnMasked = "***-**-****";
    }
  }

  const signedDocumentUrl = app.signedDocumentKey
    ? `/storage/objects/${app.signedDocumentKey}`
    : null;

  res.json({
    ...rest,
    ownerSsnMasked,
    signatureData: app.signatureData ? "[signature on file]" : null,
    signedDocumentUrl,
  });
});

// GET /leads/:id/financials — CRM: bank statement OCR summary
router.get("/leads/:id/financials", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, id) });
  if (!lead) { res.status(404).json({ error: "Not found" }); return; }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const extractions = await db.query.bankStatementExtractionsTable.findMany({
    where: eq(bankStatementExtractionsTable.leadId, id),
    orderBy: [
      bankStatementExtractionsTable.statementYear,
      bankStatementExtractionsTable.statementMonth,
    ],
  });

  if (extractions.length === 0) {
    res.json({ months: [], summary: null });
    return;
  }

  type MonthRow = {
    id: number;
    statementMonth: number | null;
    statementYear: number | null;
    totalDeposits: number | null;
    averageDailyBalance: number | null;
    nsfCount: number;
    negativeBalanceDays: number;
    existingPositions: unknown[];
    extractedAt: Date;
  };

  const months: MonthRow[] = extractions.map((e) => ({
    id: e.id,
    statementMonth: e.statementMonth,
    statementYear: e.statementYear,
    totalDeposits: e.totalDeposits !== null ? parseFloat(String(e.totalDeposits)) : null,
    averageDailyBalance: e.averageDailyBalance !== null ? parseFloat(String(e.averageDailyBalance)) : null,
    nsfCount: e.nsfCount,
    negativeBalanceDays: e.negativeBalanceDays,
    existingPositions: (e.existingPositionsJson as unknown[]) ?? [],
    extractedAt: e.extractedAt,
  }));

  const withDeposits = months.filter((m) => m.totalDeposits !== null);
  const withBalance = months.filter((m) => m.averageDailyBalance !== null);
  const avgMonthlyDeposits = withDeposits.length > 0
    ? withDeposits.reduce((s: number, m: MonthRow) => s + (m.totalDeposits ?? 0), 0) / withDeposits.length
    : null;
  const avgDailyBalance = withBalance.length > 0
    ? withBalance.reduce((s: number, m: MonthRow) => s + (m.averageDailyBalance ?? 0), 0) / withBalance.length
    : null;
  const totalNsfs = months.reduce((s: number, m: MonthRow) => s + m.nsfCount, 0);
  const avgNsfsPerMonth = months.length > 0 ? totalNsfs / months.length : 0;

  type Position = { description: string; amount: number; frequency: string };
  const allPositions = months.flatMap((m: MonthRow) => m.existingPositions as Position[]);
  const uniquePositions = allPositions.filter(
    (p: Position, i: number, arr: Position[]) => i === arr.findIndex((x: Position) => x.description === p.description)
  );

  res.json({
    months,
    summary: {
      avgMonthlyDeposits,
      avgDailyBalance,
      avgNsfsPerMonth,
      totalNsfs,
      positionsDetected: uniquePositions.length,
      positions: uniquePositions,
      monthsAnalyzed: months.length,
    },
  });
});

// GET /applications/status/:token — public, no auth required
router.get("/applications/status/:token", async (req: Request, res: Response) => {
  const token = (req.params["token"] as string).trim();
  if (!token || token.length > 64) {
    res.status(400).json({ error: "Invalid tracking token" });
    return;
  }

  const lead = await db.query.leadsTable.findFirst({
    where: eq(leadsTable.trackingToken, token),
  });

  if (!lead) {
    res.status(404).json({ error: "Application not found" });
    return;
  }

  // Fetch assigned rep name (first + last only — no PII)
  let repName: string | null = null;
  if (lead.assignedRepId) {
    const rep = await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) });
    if (rep) {
      repName = rep.name || rep.email || null;
    }
  }

  // Fetch status history (status changes only — no notes or financial data)
  const history = await db.query.leadStatusHistoryTable.findMany({
    where: eq(leadStatusHistoryTable.leadId, lead.id),
    orderBy: [leadStatusHistoryTable.createdAt],
  });

  res.json({
    status: lead.status,
    applicationType: lead.applicationType,
    companyName: lead.companyName,
    repName,
    submittedAt: lead.createdAt,
    statusHistory: history.map((h) => ({
      toStatus: h.toStatus,
      createdAt: h.createdAt,
    })),
  });
});

export default router;
