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

export interface BackupPayload {
  exportedAt: string;
  note: string;
  tables: {
    leads: unknown[];
    applications: unknown[];
    companies: unknown[];
    notes: unknown[];
    tasks: unknown[];
    documents: unknown[];
    communications: unknown[];
    lenders: unknown[];
    creditPulls: unknown[];
    emailSends: unknown[];
    activityLog: unknown[];
  };
  counts: Record<string, number>;
}

/**
 * Gather a PII-safe snapshot of all CRM data.
 * Rules enforced here (single source of truth for both HTTP export and backup job):
 *   - SSNs: ownerSsnEncrypted exported as stored ciphertext only — never decrypted
 *   - Raw credit payloads: explicit column-level select excludes the bureau response payload
 *   - Documents: storage keys only, no binary content
 */
export async function gatherBackupPayload(): Promise<BackupPayload> {
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

  const counts = {
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
  };

  return {
    exportedAt: new Date().toISOString(),
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
    counts,
  };
}
