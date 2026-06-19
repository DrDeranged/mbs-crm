import { Router, type Request, type Response } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { eq, and, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  leadsTable,
  applicationsTable,
  bankStatementExtractionsTable,
  activityLogTable,
  usersTable,
} from "@workspace/db";
import { encrypt, maskSsn } from "../lib/encryption";
import { extractBankStatement } from "../lib/ocrBankStatement";
import { objectStorageClient } from "../lib/objectStorage";
import { requireUser } from "../lib/authHelpers";

const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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

      // ── Validate required fields ──────────────────────────────────────────
      if (!body.type || !body.ownerFirstName || !body.ownerLastName || !body.businessName) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const email = body.email?.trim() || null;
      const phone = body.phone?.trim() || null;
      const ein = body.ein?.trim() || null;

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

      // ── Encrypt SSN ───────────────────────────────────────────────────────
      const rawSsn: string = body.ownerSsn ?? "";
      let ownerSsnEncrypted: string | null = null;
      if (rawSsn) {
        try {
          ownerSsnEncrypted = encrypt(rawSsn);
        } catch {
          // ENCRYPTION_KEY not set — store null (don't block submission)
        }
      }

      // ── Round-robin rep assignment ────────────────────────────────────────
      const assignedRepId = await pickNextRep();

      // ── Create lead ───────────────────────────────────────────────────────
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
        lastActivityAt: new Date(),
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

      // ── Upload bank statements + OCR ──────────────────────────────────────
      const files = (req.files as Express.Multer.File[]) ?? [];
      const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] ?? "";
      const bucket = objectStorageClient.bucket(bucketId);

      for (const file of files) {
        const fileKey = `applications/${lead.id}/bank-statements/${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        await bucket.file(fileKey).save(file.buffer, { contentType: file.mimetype });

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
            documentId: null,
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

      await logActivity({
        userId: null,
        leadId: lead.id,
        action: "application_submitted",
        entityType: "lead",
        entityId: lead.id,
        details: { type: body.type, filesCount: files.length },
      });

      res.status(201).json({ success: true, leadId: lead.id });
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

  res.json({ ...rest, ownerSsnMasked, signatureData: app.signatureData ? "[signature on file]" : null });
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

export default router;
