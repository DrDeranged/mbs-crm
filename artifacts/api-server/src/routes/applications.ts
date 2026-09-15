import { Router, type Request, type Response } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { randomBytes } from "crypto";
import { deriveKey, checkIdempotency, storeIdempotency } from "../lib/idempotency";
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
  tasksTable,
} from "@workspace/db";
import { encrypt, maskSsn } from "../lib/encryption";
import { getUserDisplayName } from "../lib/authHelpers";
import { createNotification, notifyAllManagers } from "../lib/notify";
import { extractBankStatement } from "../lib/ocrBankStatement";
import { objectStorageClient } from "../lib/objectStorage";
import { requireUser } from "../lib/authHelpers";
import { calculateLeadScore } from "../lib/leadScoring";
import { logPiiAccess } from "../lib/piiAccess";
import { getBrandLogoUrl, getPublicBaseUrl } from "../lib/brand";
import { resolveInboundAssignee } from "../lib/leadDistribution";
import { doSendEmail } from "./email";
import {
  buildSignedApplicationHtml,
  normalizeSignature,
} from "../lib/applicationSignature";
import {
  firstValidationError,
  parseApplicationSubmission,
} from "../lib/applicationValidation";
import {
  getPublicApplicationConsentText,
  getServerOwnedApplicationConsent,
} from "../lib/applicationConsent";

const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const submitRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const statusRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

// GET /applications/consent-text — public, immutable disclosure text
router.get("/applications/consent-text", (_req: Request, res: Response) => {
  res.json(getPublicApplicationConsentText());
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

/** Return a YYYY-MM-DD date two business days after today. */
function twoBusinessDaysOut(from = new Date()): string {
  const date = new Date(from);
  let remaining = 2;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return date.toISOString().slice(0, 10);
}

// POST /applications/submit — public, rate-limited, multipart
router.post(
  "/applications/submit",
  submitRateLimiter,
  upload.array("bankStatements", 12),
  async (req: Request, res: Response) => {
    try {
      const validation = parseApplicationSubmission(req.body as Record<string, unknown>);
      if (!validation.success) {
        const validationError = firstValidationError(validation.error.issues);
        res.status(400).json({ error: validationError.message, field: validationError.field });
        return;
      }
      // Keep typed signatures as the applicant's actual legal-name string. Drawn
      // signatures remain their original image data URL.
      const normalizedSignature = normalizeSignature(validation.data.signatureMethod, validation.data.signatureData);
      if (!normalizedSignature.success) {
        res.status(400).json({ error: normalizedSignature.error, field: normalizedSignature.field });
        return;
      }
      const applicationBody = {
        ...validation.data,
        signatureData: normalizedSignature.data,
      };

      // ── Validate uploaded files are PDFs ─────────────────────────────────
      const files = (req.files as Express.Multer.File[]) ?? [];
      const invalidFiles = files.filter(f =>
        f.mimetype !== "application/pdf" && !f.originalname.toLowerCase().endsWith(".pdf")
      );
      if (invalidFiles.length > 0) {
        res.status(400).json({ error: "Bank statements must be PDF files." });
        return;
      }

      const email = applicationBody.email?.trim() || null;
      const phone = applicationBody.phone?.trim() || null;
      const ein = applicationBody.ein?.trim() || null;

      // ── Idempotency check (15-minute window keyed on email+ein) ──────────
      const timeBucket = Math.floor(Date.now() / (15 * 60 * 1000)).toString();
      const idempKey = deriveKey(`applications/submit|${(email ?? "").toLowerCase()}|${ein ?? ""}|${timeBucket}`);
      const cachedResult = await checkIdempotency(idempKey, "applications/submit");
      if (cachedResult) {
        res.status(201).json(cachedResult);
        return;
      }

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

      // Equipment financing has an optional statement step. A direct API caller
      // omitting the flag is therefore treated as having skipped it when empty.
      const statementsSkipped = applicationBody.statementsSkipped === "true"
        || applicationBody.statementsSkipped === true
        || (applicationBody.type === "equipment" && files.length === 0);
      // ── Validate bank statement count (server-side) ──────────────────────
      if (applicationBody.type === "working_capital" && files.length < 3 && !statementsSkipped) {
        res.status(400).json({ error: "At least 3 bank statement PDFs are required." });
        return;
      }
      if (applicationBody.type === "working_capital" && files.length > 6) {
        res.status(400).json({ error: "A maximum of 6 bank statement PDFs may be uploaded." });
        return;
       }
      if (statementsSkipped && files.length > 0) {
        res.status(400).json({ error: "Remove uploaded statements before choosing to skip this step." });
        return;
       }

      // ── Encrypt SSN — hard fail if key is absent ──────────────────────────
      const rawSsn: string = (applicationBody.ownerSsn ?? "").replace(/\D/g, "");
      let ownerSsnEncrypted: string | null = null;
      if (rawSsn) {
        // Throws if ENCRYPTION_KEY is missing/malformed — do not swallow
        ownerSsnEncrypted = encrypt(rawSsn);
      }
      const rawSecondaryOwnerSsn: string = (applicationBody.secondaryOwnerSsn ?? "").replace(/\D/g, "");
      let secondaryOwnerSsnEncrypted: string | null = null;
      if (rawSecondaryOwnerSsn) {
        // Use the same AES-256-GCM application encryption as the principal owner SSN.
        secondaryOwnerSsnEncrypted = encrypt(rawSecondaryOwnerSsn);
      }

       // A QR attribution is advisory: invalid/missing values use normal assignment.
        const attributedRep = applicationBody.rep
          ? await db.query.usersTable.findFirst({
            where: and(
              eq(usersTable.slug, String(applicationBody.rep).toLowerCase()),
              eq(usersTable.role, "rep"),
              eq(usersTable.isActive, true),
            ),
          })
          : null;
        const assignedRepId = await resolveInboundAssignee(applicationBody.rep);

      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? null;
      const signatureSignedAt = new Date();
      const consentGiven = applicationBody.consentCreditPull === "true" || applicationBody.consentCreditPull === true;

      // ── Create lead + application + document rows (single transaction) ────
      const trackingToken = randomBytes(6).toString("hex");
      const { lead, application, docRecords } = await db.transaction(async (tx) => {
        const [txLead] = await tx.insert(leadsTable).values({
          firstName: applicationBody.ownerFirstName,
          lastName: applicationBody.ownerLastName,
          email,
          phone,
          companyName: applicationBody.businessName,
          ein,
          applicationType: applicationBody.type as "equipment" | "working_capital",
          status: "application_received",
           leadSource: attributedRep ? "qr-card" : "website",
          requestedAmount: applicationBody.requestedAmount ? Number(applicationBody.requestedAmount) : null,
          assignedRepId,
          consentCreditPullAt: consentGiven ? new Date() : null,
          consentIp: clientIp,
          lastActivityAt: new Date(),
          trackingToken,
        }).returning();

        await tx.insert(activityLogTable).values({
          userId: null,
          leadId: txLead.id,
          action: "lead_created",
          entityType: "lead",
          entityId: String(txLead.id),
          details: { source: attributedRep ? "qr-card" : "website", path: "application" },
        });

         if (attributedRep) {
           await tx.insert(activityLogTable).values({
             userId: null, leadId: txLead.id, action: "attributed",
             entityType: "rep_slug", entityId: attributedRep.slug ?? "",
             details: { slug: attributedRep.slug, source: "qr-card" },
           });
         }

        const [txApplication] = await tx.insert(applicationsTable).values({
          leadId: txLead.id,
          type: applicationBody.type as "equipment" | "working_capital",
          businessName: applicationBody.businessName,
          dba: applicationBody.dba || null,
          ein,
          businessAddress: applicationBody.businessAddress || null,
          businessCity: applicationBody.businessCity || null,
          businessState: applicationBody.businessState || null,
          businessZip: applicationBody.businessZip || null,
          industry: applicationBody.industry || null,
           businessType: applicationBody.businessType || null,
           annualRevenue: applicationBody.annualRevenue ? String(applicationBody.annualRevenue) : null,
           businessStartDate: applicationBody.businessStartDate || null,
           yearsUnderCurrentOwnership: applicationBody.yearsUnderCurrentOwnership ? Number(applicationBody.yearsUnderCurrentOwnership) : null,
           businessDescription: applicationBody.businessDescription || null,
           estCreditScore: applicationBody.estCreditScore || null,
           timelineFundsNeeded: applicationBody.timelineFundsNeeded || null,
          timeInBusinessMonths: applicationBody.timeInBusinessMonths ? Number(applicationBody.timeInBusinessMonths) : null,
          monthlyRevenueStated: applicationBody.monthlyRevenueStated ? Number(applicationBody.monthlyRevenueStated) : null,
          requestedAmount: applicationBody.requestedAmount ? Number(applicationBody.requestedAmount) : null,
          useOfFunds: applicationBody.useOfFunds || null,
          equipmentDescription: applicationBody.equipmentDescription || null,
          vendorName: applicationBody.vendorName || null,
          vendorQuoteAmount: applicationBody.vendorQuoteAmount ? String(applicationBody.vendorQuoteAmount) : null,
          equipmentCondition: applicationBody.equipmentCondition as "new" | "used" | null || null,
           yearMakeModel: applicationBody.yearMakeModel || null,
           trucksInFleet: applicationBody.trucksInFleet ? Number(applicationBody.trucksInFleet) : null,
           downPaymentAmount: applicationBody.downPaymentAmount ? String(applicationBody.downPaymentAmount) : null,
          ownerFirstName: applicationBody.ownerFirstName,
          ownerLastName: applicationBody.ownerLastName,
          ownerSsnEncrypted,
          ownerDob: applicationBody.ownerDob || null,
          ownerHomeAddress: applicationBody.ownerHomeAddress || null,
          ownerHomeCity: applicationBody.ownerHomeCity || null,
          ownerHomeState: applicationBody.ownerHomeState || null,
          ownerHomeZip: applicationBody.ownerHomeZip || null,
          ownershipPct: applicationBody.ownershipPct ? Number(applicationBody.ownershipPct) : null,
           secondaryOwnerName: applicationBody.secondaryOwnerName || null,
           secondaryOwnerEmail: applicationBody.secondaryOwnerEmail || null,
           secondaryOwnerAddress: applicationBody.secondaryOwnerAddress || null,
           secondaryOwnerSsnEncrypted,
           secondaryOwnerDob: applicationBody.secondaryOwnerDob || null,
           secondaryOwnerOwnershipPct: applicationBody.secondaryOwnerOwnershipPct ? Number(applicationBody.secondaryOwnerOwnershipPct) : null,
           secondaryOwnerCell: applicationBody.secondaryOwnerCell || null,
           secondaryOwnerEstCreditScore: applicationBody.secondaryOwnerEstCreditScore || null,
          consentCreditPull: applicationBody.consentCreditPull === "true" || applicationBody.consentCreditPull === true,
          consentTerms: applicationBody.consentTerms === "true" || applicationBody.consentTerms === true,
           ...getServerOwnedApplicationConsent(),
           signatureMethod: applicationBody.signatureMethod as "typed" | "drawn",
           signatureData: applicationBody.signatureData,
           signatureIp: clientIp,
           signatureSignedAt,
        }).returning();

        const txDocRecords: { file: Express.Multer.File; fileKey: string; id: number }[] = [];
        for (const file of files) {
          const safeFilename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
          const fileKey = `leads/${txLead.id}/documents/bankstatement-${Date.now()}-${safeFilename}`;
          const [docRecord] = await tx.insert(documentsTable).values({
            leadId: txLead.id,
            userId: null,
            filename: file.originalname,
            fileKey,
            fileType: file.mimetype,
            fileSize: file.size,
          }).returning();
          txDocRecords.push({ file, fileKey, id: docRecord.id });
        }

        return { lead: txLead, application: txApplication, docRecords: txDocRecords };
      });

      // ── Upload bank statements + OCR (after commit — external calls) ────
      const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] ?? "";
      const bucket = objectStorageClient.bucket(bucketId);

      for (const { file, fileKey, id: docId } of docRecords) {
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
            documentId: docId,
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
        body: applicationBody,
        submittedAt: application.submittedAt,
        signatureSignedAt,
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
        details: { type: applicationBody.type, filesCount: files.length },
      });

      if (statementsSkipped) {
        const isWorkingCapital = applicationBody.type === "working_capital";
        const message = isWorkingCapital
          ? "Bank statements skipped at application; applicant chose to send statements to their representative instead."
          : "Bank statements skipped at application (equipment)";
        await logActivity({
          userId: null,
          leadId: lead.id,
          action: "bank_statements_skipped",
          entityType: "lead",
          entityId: lead.id,
          details: { message, type: applicationBody.type, filesCount: 0 },
        });
        if (isWorkingCapital && assignedRepId) {
          await db.insert(tasksTable).values({
            leadId: lead.id,
            userId: assignedRepId,
            title: "Collect 3–6 months bank statements — applicant chose to send directly",
            description: "Applicant chose to send statements directly to their representative. Collect the last 3–6 months of business bank statements.",
            dueDate: twoBusinessDaysOut(),
          });
        }
      }

      calculateLeadScore(lead.id).catch((e) => console.error("Lead scoring error:", e));

      // ── Notify managers + assigned rep of new application ─────────────────
      notifyAllManagers(
        "application_received",
        "New application received",
        `${applicationBody.businessName} submitted a ${applicationBody.type} application`,
        lead.id,
      ).catch(() => {});
      if (assignedRepId) {
        createNotification({
          userId: assignedRepId,
          type: "application_received",
          title: "New application assigned to you",
          body: `${applicationBody.businessName} — ${applicationBody.type}`,
          leadId: lead.id,
        }).catch(() => {});
      }

      // ── Send confirmation email with tracking token (non-blocking) ─────────
      if (email && lead.trackingToken) {
        const baseUrl = getPublicBaseUrl();
        const statusUrl = `${baseUrl}/apply/status`;
        const logoUrl = getBrandLogoUrl(baseUrl);
        const token = lead.trackingToken;

        const confirmationHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;color:#1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
        <tr><td style="background:#ffffff;padding:20px 32px;border-bottom:1px solid #e2e8f0;">
          <img src="${logoUrl}" alt="My Business Solutions" width="116" height="56" style="display:block;width:116px;height:auto;border:0;" />
          <p style="margin:8px 0 0;font-size:13px;color:#64748b;">Financing made simple</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 8px;font-size:22px;color:#1e293b;">We received your application!</h2>
          <p style="margin:0 0 24px;font-size:15px;color:#475569;">Thank you for applying with My Business Solutions. Our team will review your application and be in touch shortly.</p>

          <div style="background:#f1f5f9;border-radius:8px;padding:20px;margin-bottom:24px;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Your Tracking Number</p>
            <p style="margin:0;font-size:22px;font-weight:700;font-family:monospace;color:#1F4E79;letter-spacing:.08em;">${token}</p>
          </div>

          <p style="margin:0 0 16px;font-size:14px;color:#475569;">Use your tracking number to check your application status at any time:</p>
          <a href="${statusUrl}" style="display:inline-block;background:#1F4E79;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">Check Application Status</a>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0;" />
          <p style="margin:0;font-size:12px;color:#94a3b8;">Questions? Contact us at <a href="tel:+18005550000" style="color:#1F4E79;">800-555-0000</a> or reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
        const rep = lead.assignedRepId
          ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) })
          : null;
        void doSendEmail({
          leadId: lead.id,
          userId: null,
          templateId: null,
          subject: "Your MBS Application Has Been Received",
          bodyHtml: confirmationHtml,
          toEmail: lead.email || email,
          baseUrl,
          senderMode: "default",
          rep,
        }).then(({ error }) => {
          if (error) console.error("Confirmation email failed:", error);
        }).catch((e: unknown) => console.error("Confirmation email failed:", e));
      }

      const successPayload: Record<string, unknown> = { success: true, lead_id: lead.id, tracking_token: lead.trackingToken };
      void storeIdempotency(idempKey, "applications/submit", `lead:${lead.id}`, successPayload);
      res.status(201).json(successPayload);
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
  const { ownerSsnEncrypted, secondaryOwnerSsnEncrypted, ...rest } = app;
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
  let secondaryOwnerSsnMasked: string | null = null;
  if (secondaryOwnerSsnEncrypted) {
    try {
      const { decrypt } = await import("../lib/encryption");
      secondaryOwnerSsnMasked = maskSsn(decrypt(secondaryOwnerSsnEncrypted));
    } catch {
      secondaryOwnerSsnMasked = "***-**-****";
    }
  }

  const signedDocumentUrl = app.signedDocumentKey
    ? `/storage/objects/${app.signedDocumentKey}`
    : null;

  logPiiAccess({ userId: user.id, leadId: id, fieldCategory: "application", action: "view", ip: req.ip });
  if (ownerSsnEncrypted || secondaryOwnerSsnEncrypted) {
    logPiiAccess({ userId: user.id, leadId: id, fieldCategory: "ssn", action: "view", ip: req.ip });
  }
  res.json({
    ...rest,
    ownerSsnMasked,
    secondaryOwnerSsnMasked,
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
router.get("/applications/status/:token", statusRateLimiter, async (req: Request, res: Response) => {
  const token = (req.params["token"] as string).trim();
  if (!token || token.length > 64) {
    res.status(400).json({ error: "Invalid tracking token" });
    return;
  }

  const lead = await db.query.leadsTable.findFirst({
    where: eq(leadsTable.trackingToken, token),
  });

  if (!lead) {
    await new Promise((r) => setTimeout(r, 300));
    res.status(404).json({ error: "Application not found" });
    return;
  }

  // Fetch assigned rep name (first + last only — no PII)
  let repName: string | null = null;
  if (lead.assignedRepId) {
    const rep = await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) });
    if (rep) {
      repName = getUserDisplayName(rep, "MBS representative");
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
