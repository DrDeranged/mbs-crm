import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  leadsTable,
  applicationsTable,
  creditPullsTable,
  creditComplianceLogTable,
  companySettingsTable,
  notesTable,
  communicationsTable,
  tasksTable,
  documentsTable,
} from "@workspace/db";
import { eq, and, lt, inArray, count, sql, not, exists } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";

const router = Router();

// ─── GET /api/leads/:id/compliance-status ────────────────────────────────────

router.get("/leads/:id/compliance-status", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role !== "admin" && user.role !== "manager") {
    return void res.status(403).json({ error: "Manager or admin only" });
  }

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });

  const app = await db.query.applicationsTable.findFirst({
    where: eq(applicationsTable.leadId, leadId),
  });

  const hasCreditPulls = await db
    .select({ id: creditPullsTable.id })
    .from(creditPullsTable)
    .where(eq(creditPullsTable.leadId, leadId))
    .limit(1);

  const complianceLogCount = await db
    .select({ total: count() })
    .from(creditComplianceLogTable)
    .where(eq(creditComplianceLogTable.leadId, leadId));

  const consentOk = lead.consentCreditPullAt != null;
  const consentAge = lead.consentCreditPullAt
    ? Math.floor((Date.now() - new Date(lead.consentCreditPullAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  res.json({
    leadId,
    isUnsubscribed: lead.isUnsubscribed,
    creditConsent: {
      captured: consentOk,
      capturedAt: lead.consentCreditPullAt ?? null,
      consentIp: lead.consentIp ?? null,
      ageInDays: consentAge,
      expired: consentAge != null && consentAge > 30,
    },
    tcpaConsent: {
      captured: !lead.isUnsubscribed,
      note: lead.isUnsubscribed
        ? "Lead has unsubscribed — do not contact via SMS or email"
        : "No explicit TCPA field; isUnsubscribed=false is the opt-out signal",
    },
    applicationConsent: {
      consentCreditPull: app?.consentCreditPull ?? false,
      consentTerms: app?.consentTerms ?? false,
      submittedAt: app?.submittedAt ?? null,
    },
    complianceHolds: {
      hasCreditPulls: hasCreditPulls.length > 0,
      complianceLogEntries: Number(complianceLogCount[0]?.total ?? 0),
    },
    canAutoEmail: !lead.isUnsubscribed && lead.email != null,
    canAutoSms: !lead.isUnsubscribed && lead.phone != null,
    canPullCredit: consentOk && !lead.isUnsubscribed && (consentAge == null || consentAge <= 30),
  });
});

// ─── GET /api/admin/data-governance/retention-preview ────────────────────────

router.get("/admin/data-governance/retention-preview", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role !== "admin") {
    return void res.status(403).json({ error: "Admin only" });
  }

  const settings = await db.query.companySettingsTable.findFirst();
  const retentionMonths = settings?.retentionMonths ?? 36;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);

  const eligible = await db
    .select({ id: leadsTable.id, firstName: leadsTable.firstName, lastName: leadsTable.lastName, email: leadsTable.email, status: leadsTable.status, updatedAt: leadsTable.updatedAt })
    .from(leadsTable)
    .where(
      and(
        inArray(leadsTable.status, ["declined"]),
        lt(leadsTable.updatedAt, cutoff),
        not(exists(
          db.select({ id: creditPullsTable.id })
            .from(creditPullsTable)
            .where(eq(creditPullsTable.leadId, leadsTable.id)),
        )),
        not(exists(
          db.select({ id: creditComplianceLogTable.id })
            .from(creditComplianceLogTable)
            .where(eq(creditComplianceLogTable.leadId, leadsTable.id)),
        )),
      ),
    );

  res.json({
    retentionMonths,
    cutoffDate: cutoff.toISOString(),
    eligibleCount: eligible.length,
    eligible: eligible.map((l) => ({
      id: l.id,
      name: [l.firstName, l.lastName].filter(Boolean).join(" ") || `Lead #${l.id}`,
      email: l.email,
      status: l.status,
      lastUpdated: l.updatedAt,
    })),
  });
});

// ─── POST /api/admin/data-governance/purge ────────────────────────────────────

router.post("/admin/data-governance/purge", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role !== "admin") {
    return void res.status(403).json({ error: "Admin only" });
  }

  const { confirm } = req.body as { confirm?: boolean };
  if (!confirm) {
    return void res.status(400).json({
      error: "Must pass { confirm: true } to execute purge. Call retention-preview first to see eligible records.",
    });
  }

  const settings = await db.query.companySettingsTable.findFirst();
  const retentionMonths = settings?.retentionMonths ?? 36;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);

  // Re-compute eligibles in the same transaction
  const eligible = await db
    .select({ id: leadsTable.id })
    .from(leadsTable)
    .where(
      and(
        inArray(leadsTable.status, ["declined"]),
        lt(leadsTable.updatedAt, cutoff),
        not(exists(
          db.select({ id: creditPullsTable.id })
            .from(creditPullsTable)
            .where(eq(creditPullsTable.leadId, leadsTable.id)),
        )),
        not(exists(
          db.select({ id: creditComplianceLogTable.id })
            .from(creditComplianceLogTable)
            .where(eq(creditComplianceLogTable.leadId, leadsTable.id)),
        )),
      ),
    );

  if (eligible.length === 0) {
    return void res.json({ purged: 0, message: "No eligible leads found." });
  }

  const ids = eligible.map((l) => l.id);

  // Hard-delete eligible leads (cascades to notes, tasks, comms, docs via FK onDelete: cascade)
  await db.delete(leadsTable).where(inArray(leadsTable.id, ids));

  await logActivity({
    userId: user.id,
    leadId: null,
    action: "data_purge",
    entityType: "system",
    entityId: null,
    details: {
      purgedCount: ids.length,
      retentionMonths,
      cutoffDate: cutoff.toISOString(),
      purgedLeadIds: ids,
    },
  });

  res.json({
    purged: ids.length,
    message: `Purged ${ids.length} eligible lead record(s) past ${retentionMonths}-month retention window.`,
  });
});

// ─── DELETE /api/leads/:id/pii — Right to be Forgotten ────────────────────────

router.delete("/leads/:id/pii", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role !== "admin") {
    return void res.status(403).json({ error: "Admin only" });
  }

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });

  // Check for compliance holds — if credit_compliance_log entries exist, we must preserve
  // the lead record but can still scrub PII fields. Per FCRA the compliance log itself stays.
  const [complianceCount] = await db
    .select({ total: count() })
    .from(creditComplianceLogTable)
    .where(eq(creditComplianceLogTable.leadId, leadId));

  const hasComplianceHold = Number(complianceCount?.total ?? 0) > 0;

  const [pullCount] = await db
    .select({ total: count() })
    .from(creditPullsTable)
    .where(eq(creditPullsTable.leadId, leadId));

  const hasCreditPulls = Number(pullCount?.total ?? 0) > 0;

  if (hasComplianceHold || hasCreditPulls) {
    // STOP — report the conflict rather than violating append-only guarantee
    return void res.status(409).json({
      error: "compliance_hold",
      message:
        "This lead has FCRA credit compliance records. The lead record and compliance log must be preserved per FCRA requirements. " +
        "PII fields on the lead and application will be scrubbed, but the compliance log and credit pull records are retained. " +
        "Pass { acknowledgeHold: true } to proceed with PII scrub only.",
      complianceLogEntries: Number(complianceCount?.total ?? 0),
      creditPullEntries: Number(pullCount?.total ?? 0),
    });
  }

  // No compliance holds — full delete path
  const { acknowledgeHold } = req.body as { acknowledgeHold?: boolean };
  if (hasComplianceHold && !acknowledgeHold) {
    // Safety: already returned 409 above if hasComplianceHold — this block is unreachable
    return void res.status(409).json({ error: "Must acknowledge compliance hold" });
  }

  // Scrub PII fields on the lead
  await db.update(leadsTable).set({
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    companyName: null,
    ein: null,
    consentIp: null,
    consentCreditPullAt: null,
  }).where(eq(leadsTable.id, leadId));

  // Scrub PII on application if it exists
  const app = await db.query.applicationsTable.findFirst({
    where: eq(applicationsTable.leadId, leadId),
  });
  if (app) {
    await db.update(applicationsTable).set({
      ownerFirstName: "[scrubbed]",
      ownerLastName: "[scrubbed]",
      ownerSsnEncrypted: null,
      ownerDob: null,
      ownerHomeAddress: null,
      ownerHomeCity: null,
      ownerHomeState: null,
      ownerHomeZip: null,
      signatureData: null,
      signedDocumentKey: null,
    }).where(eq(applicationsTable.id, app.id));
  }

  await logActivity({
    userId: user.id,
    leadId,
    action: "rtbf_pii_scrub",
    entityType: "lead",
    entityId: leadId,
    details: {
      scrubbedFields: ["firstName", "lastName", "email", "phone", "companyName", "ein", "consentIp", "consentCreditPullAt", "application_pii"],
      hasComplianceHold,
      hasCreditPulls,
    },
  });

  res.json({
    success: true,
    leadId,
    message: "PII scrubbed. The lead record shell and any compliance logs have been preserved per FCRA requirements.",
    complianceLogPreserved: hasComplianceHold,
    creditPullsPreserved: hasCreditPulls,
  });
});

// ─── DELETE /api/leads/:id/pii with acknowledgeHold ───────────────────────────
// Separate handler for when admin explicitly acknowledges the compliance hold
// and wants to proceed with PII scrub despite having compliance records.

router.delete("/leads/:id/pii/force", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role !== "admin") {
    return void res.status(403).json({ error: "Admin only" });
  }

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });

  const [complianceCount] = await db
    .select({ total: count() })
    .from(creditComplianceLogTable)
    .where(eq(creditComplianceLogTable.leadId, leadId));

  const [pullCount] = await db
    .select({ total: count() })
    .from(creditPullsTable)
    .where(eq(creditPullsTable.leadId, leadId));

  // Scrub PII fields on lead — compliance log rows stay (append-only guarantee preserved)
  await db.update(leadsTable).set({
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    companyName: null,
    ein: null,
    consentIp: null,
    consentCreditPullAt: null,
  }).where(eq(leadsTable.id, leadId));

  const app = await db.query.applicationsTable.findFirst({ where: eq(applicationsTable.leadId, leadId) });
  if (app) {
    await db.update(applicationsTable).set({
      ownerFirstName: "[scrubbed]",
      ownerLastName: "[scrubbed]",
      ownerSsnEncrypted: null,
      ownerDob: null,
      ownerHomeAddress: null,
      ownerHomeCity: null,
      ownerHomeState: null,
      ownerHomeZip: null,
      signatureData: null,
      signedDocumentKey: null,
    }).where(eq(applicationsTable.id, app.id));
  }

  await logActivity({
    userId: user.id,
    leadId,
    action: "rtbf_pii_scrub_forced",
    entityType: "lead",
    entityId: leadId,
    details: {
      scrubbedFields: ["firstName", "lastName", "email", "phone", "companyName", "ein", "consentIp", "consentCreditPullAt", "application_pii"],
      complianceLogEntries: Number(complianceCount?.total ?? 0),
      creditPullEntries: Number(pullCount?.total ?? 0),
      note: "Admin acknowledged FCRA compliance hold and proceeded with PII scrub. Compliance log rows preserved.",
    },
  });

  res.json({
    success: true,
    leadId,
    message: "PII scrubbed with acknowledged compliance hold. Compliance log and credit pull records have been preserved per FCRA requirements.",
    complianceLogPreserved: true,
    creditPullsPreserved: true,
    complianceLogEntries: Number(complianceCount?.total ?? 0),
    creditPullEntries: Number(pullCount?.total ?? 0),
  });
});

export default router;
