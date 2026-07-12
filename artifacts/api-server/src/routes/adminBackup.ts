import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  leadsTable,
  applicationsTable,
  companiesTable,
  notesTable,
  tasksTable,
  documentsTable,
  communicationsTable,
  lendersTable,
  creditPullsTable,
  emailSendsTable,
  activityLogTable,
} from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";

const router = Router();

router.get("/admin/backup/export", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role !== "admin") {
    return void res.status(403).json({ error: "Admin only" });
  }

  try {
    const [
      leads,
      applications,
      companies,
      notes,
      tasks,
      documents,
      communications,
      lenders,
      creditPulls,
      emailSends,
      activityLog,
    ] = await Promise.all([
      db.select().from(leadsTable),
      db.select({
        id: applicationsTable.id,
        leadId: applicationsTable.leadId,
        type: applicationsTable.type,
        businessName: applicationsTable.businessName,
        dba: applicationsTable.dba,
        ein: applicationsTable.ein,
        businessAddress: applicationsTable.businessAddress,
        businessCity: applicationsTable.businessCity,
        businessState: applicationsTable.businessState,
        businessZip: applicationsTable.businessZip,
        industry: applicationsTable.industry,
        timeInBusinessMonths: applicationsTable.timeInBusinessMonths,
        monthlyRevenueStated: applicationsTable.monthlyRevenueStated,
        requestedAmount: applicationsTable.requestedAmount,
        useOfFunds: applicationsTable.useOfFunds,
        equipmentDescription: applicationsTable.equipmentDescription,
        vendorName: applicationsTable.vendorName,
        vendorQuoteAmount: applicationsTable.vendorQuoteAmount,
        equipmentCondition: applicationsTable.equipmentCondition,
        ownerFirstName: applicationsTable.ownerFirstName,
        ownerLastName: applicationsTable.ownerLastName,
        ownerSsnEncrypted: applicationsTable.ownerSsnEncrypted,
        ownerDob: applicationsTable.ownerDob,
        ownerHomeAddress: applicationsTable.ownerHomeAddress,
        ownerHomeCity: applicationsTable.ownerHomeCity,
        ownerHomeState: applicationsTable.ownerHomeState,
        ownerHomeZip: applicationsTable.ownerHomeZip,
        ownershipPct: applicationsTable.ownershipPct,
        consentCreditPull: applicationsTable.consentCreditPull,
        consentTerms: applicationsTable.consentTerms,
        signatureIp: applicationsTable.signatureIp,
        signedDocumentKey: applicationsTable.signedDocumentKey,
        submittedAt: applicationsTable.submittedAt,
      }).from(applicationsTable),
      db.select().from(companiesTable),
      db.select().from(notesTable),
      db.select().from(tasksTable),
      db.select({
        id: documentsTable.id,
        leadId: documentsTable.leadId,
        userId: documentsTable.userId,
        filename: documentsTable.filename,
        fileKey: documentsTable.fileKey,
        fileType: documentsTable.fileType,
        fileSize: documentsTable.fileSize,
        createdAt: documentsTable.createdAt,
      }).from(documentsTable),
      db.select().from(communicationsTable),
      db.select().from(lendersTable),
      db.select({
        id: creditPullsTable.id,
        leadId: creditPullsTable.leadId,
        pulledBy: creditPullsTable.pulledBy,
        pullType: creditPullsTable.pullType,
        status: creditPullsTable.status,
        creditScore: creditPullsTable.creditScore,
        consentCapturedAt: creditPullsTable.consentCapturedAt,
        consentIp: creditPullsTable.consentIp,
        errorMessage: creditPullsTable.errorMessage,
        createdAt: creditPullsTable.createdAt,
      }).from(creditPullsTable),
      db.select().from(emailSendsTable),
      db.select().from(activityLogTable),
    ]);

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      exportedBy: { id: user.id, name: user.name, email: user.email },
      note: "SSNs are stored as encrypted ciphertext (ownerSsnEncrypted). They were NOT decrypted for this export. Raw credit payloads are excluded.",
      tables: {
        leads,
        applications,
        companies,
        notes,
        tasks,
        documents,
        communications,
        lenders,
        creditPulls,
        emailSends,
        activityLog,
      },
    };

    await logActivity({
      userId: user.id,
      action: "backup_exported",
      entityType: "system",
      entityId: 0,
      details: {
        counts: {
          leads: leads.length,
          applications: applications.length,
          companies: companies.length,
          notes: notes.length,
          tasks: tasks.length,
          documents: documents.length,
          communications: communications.length,
          lenders: lenders.length,
          creditPulls: creditPulls.length,
          emailSends: emailSends.length,
          activityLog: activityLog.length,
        },
      },
    });

    const filename = `mbs-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(exportPayload);
  } catch (err) {
    console.error("Backup export error:", err);
    res.status(500).json({ error: "Export failed" });
  }
});

export default router;
