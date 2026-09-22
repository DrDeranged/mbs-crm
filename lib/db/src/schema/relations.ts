import { relations } from "drizzle-orm";
import { leadsTable } from "./leads";
import { dealsTable } from "./deals";
import { usersTable } from "./users";
import { userIdentitiesTable } from "./userIdentities";
import { adminAuditLogTable } from "./adminAuditLog";
import { notificationsTable } from "./notifications";
import { companiesTable } from "./companies";
import { notesTable } from "./notes";
import { tasksTable } from "./tasks";
import { documentsTable } from "./documents";
import { leadStatusHistoryTable } from "./leadStatusHistory";
import { activityLogTable } from "./activityLog";
import { communicationsTable } from "./communications";
import { emailTemplatesTable } from "./emailTemplates";
import { dripSequencesTable } from "./dripSequences";
import { dripSequenceStepsTable } from "./dripSequenceSteps";
import { dripEnrollmentsTable } from "./dripEnrollments";
import { emailSendsTable } from "./emailSends";
import { lendersTable, lenderGuidelineVersionsTable, lenderMatchesTable, lenderSubmissionsTable, partnerContactsTable } from "./lenders";
import { dealApprovalsTable } from "./dealApprovals";
import { flyerTemplatesTable, generatedFlyersTable } from "./flyers";
import { collateralTemplatesTable, collateralRendersTable } from "./collateral";
import { applicationsTable, bankStatementExtractionsTable, underwritingCorrectionsTable } from "./applications";
import { creditPullsTable, creditComplianceLogTable } from "./creditPulls";
import { workflowRulesTable } from "./workflowRules";
import { retiredRepSlugsTable } from "./retiredRepSlugs";
import { usfaApplicationEmailLogTable, usfaIntakeLogTable, usfaIntakePrefillTable, usfaPrefillInvitesTable } from "./usfaIntake";
import { pushSubscriptionsTable } from "./pushSubscriptions";
import { notificationPreferencesTable } from "./notificationPreferences";
import { campaignsTable, campaignAudiencePresetsTable, campaignApprovalsTable, campaignAudiencePreviewsTable, campaignAuditEventsTable, campaignLaunchesTable, campaignRecipientsTable } from "./campaigns";

export const leadsRelations = relations(leadsTable, ({ one, many }) => ({
  assignedRep: one(usersTable, {
    fields: [leadsTable.assignedRepId],
    references: [usersTable.id],
  }),
  company: one(companiesTable, {
    fields: [leadsTable.id],
    references: [companiesTable.leadId],
  }),
  notes: many(notesTable),
  tasks: many(tasksTable),
  documents: many(documentsTable),
  statusHistory: many(leadStatusHistoryTable),
  activityLog: many(activityLogTable),
  deals: many(dealsTable),
  communications: many(communicationsTable),
  emailSends: many(emailSendsTable),
  dripEnrollments: many(dripEnrollmentsTable),
  lenderMatches: many(lenderMatchesTable),
  lenderSubmissions: many(lenderSubmissionsTable),
  usfaIntakeLogs: many(usfaIntakeLogTable),
  usfaIntakePrefill: many(usfaIntakePrefillTable),
  usfaPrefillInvites: many(usfaPrefillInvitesTable),
  usfaApplicationEmailLogs: many(usfaApplicationEmailLogTable),
  collateralRenders: many(collateralRendersTable),
}));

export const usersRelations = relations(usersTable, ({ many }) => ({
  identities: many(userIdentitiesTable),
  pushSubscriptions: many(pushSubscriptionsTable),
  notificationPreferences: many(notificationPreferencesTable),
  leads: many(leadsTable),
  deals: many(dealsTable),
  notes: many(notesTable),
  tasks: many(tasksTable),
  documents: many(documentsTable),
  activityLog: many(activityLogTable),
  communications: many(communicationsTable),
  emailSends: many(emailSendsTable),
  emailTemplates: many(emailTemplatesTable),
  dripSequences: many(dripSequencesTable),
  notifications: many(notificationsTable),
  retiredRepSlugs: many(retiredRepSlugsTable),
  lenderSubmissions: many(lenderSubmissionsTable),
  approvals: many(dealApprovalsTable),
  collateralTemplates: many(collateralTemplatesTable),
  collateralRenders: many(collateralRendersTable),
  adminAuditRows: many(adminAuditLogTable),
  campaigns: many(campaignsTable),
  campaignAudiencePresets: many(campaignAudiencePresetsTable),
  campaignApprovals: many(campaignApprovalsTable),
  campaignAudiencePreviews: many(campaignAudiencePreviewsTable),
  campaignLaunches: many(campaignLaunchesTable),
  campaignAuditEvents: many(campaignAuditEventsTable),
}));

export const userIdentitiesRelations = relations(userIdentitiesTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [userIdentitiesTable.userId],
    references: [usersTable.id],
  }),
}));

export const adminAuditLogRelations = relations(adminAuditLogTable, ({ one }) => ({
  actor: one(usersTable, { fields: [adminAuditLogTable.actorUserId], references: [usersTable.id] }),
}));

export const retiredRepSlugsRelations = relations(retiredRepSlugsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [retiredRepSlugsTable.userId],
    references: [usersTable.id],
  }),
}));

export const companiesRelations = relations(companiesTable, ({ one }) => ({
  lead: one(leadsTable, {
    fields: [companiesTable.leadId],
    references: [leadsTable.id],
  }),
}));

export const usfaIntakeLogRelations = relations(usfaIntakeLogTable, ({ one }) => ({
  lead: one(leadsTable, { fields: [usfaIntakeLogTable.leadId], references: [leadsTable.id] }),
}));

export const usfaIntakePrefillRelations = relations(usfaIntakePrefillTable, ({ one }) => ({
  lead: one(leadsTable, { fields: [usfaIntakePrefillTable.leadId], references: [leadsTable.id] }),
}));
export const usfaPrefillInvitesRelations = relations(usfaPrefillInvitesTable, ({ one }) => ({
  lead: one(leadsTable, { fields: [usfaPrefillInvitesTable.leadId], references: [leadsTable.id] }),
  rep: one(usersTable, { fields: [usfaPrefillInvitesTable.repUserId], references: [usersTable.id] }),
}));

export const usfaApplicationEmailLogRelations = relations(usfaApplicationEmailLogTable, ({ one }) => ({
  lead: one(leadsTable, { fields: [usfaApplicationEmailLogTable.leadId], references: [leadsTable.id] }),
}));

export const notesRelations = relations(notesTable, ({ one }) => ({
  lead: one(leadsTable, {
    fields: [notesTable.leadId],
    references: [leadsTable.id],
  }),
  author: one(usersTable, {
    fields: [notesTable.userId],
    references: [usersTable.id],
  }),
}));

export const tasksRelations = relations(tasksTable, ({ one }) => ({
  lead: one(leadsTable, {
    fields: [tasksTable.leadId],
    references: [leadsTable.id],
  }),
  assignedUser: one(usersTable, {
    fields: [tasksTable.userId],
    references: [usersTable.id],
  }),
}));

export const documentsRelations = relations(documentsTable, ({ one }) => ({
  lead: one(leadsTable, {
    fields: [documentsTable.leadId],
    references: [leadsTable.id],
  }),
  uploader: one(usersTable, {
    fields: [documentsTable.userId],
    references: [usersTable.id],
  }),
}));

export const leadStatusHistoryRelations = relations(leadStatusHistoryTable, ({ one }) => ({
  lead: one(leadsTable, {
    fields: [leadStatusHistoryTable.leadId],
    references: [leadsTable.id],
  }),
  changedBy: one(usersTable, {
    fields: [leadStatusHistoryTable.changedByUserId],
    references: [usersTable.id],
  }),
}));

export const activityLogRelations = relations(activityLogTable, ({ one }) => ({
  lead: one(leadsTable, {
    fields: [activityLogTable.leadId],
    references: [leadsTable.id],
  }),
  user: one(usersTable, {
    fields: [activityLogTable.userId],
    references: [usersTable.id],
  }),
  deal: one(dealsTable, {
    fields: [activityLogTable.dealId],
    references: [dealsTable.id],
  }),
}));

export const dealsRelations = relations(dealsTable, ({ one, many }) => ({
  lead: one(leadsTable, {
    fields: [dealsTable.leadId],
    references: [leadsTable.id],
  }),
  assignedUser: one(usersTable, {
    fields: [dealsTable.assignedTo],
    references: [usersTable.id],
  }),
  activityLog: many(activityLogTable),
  lenderSubmissions: many(lenderSubmissionsTable),
  approvals: many(dealApprovalsTable),
}));

export const dealApprovalsRelations = relations(dealApprovalsTable, ({ one }) => ({
  deal: one(dealsTable, { fields: [dealApprovalsTable.dealId], references: [dealsTable.id] }),
  lender: one(lendersTable, { fields: [dealApprovalsTable.lenderId], references: [lendersTable.id] }),
  document: one(documentsTable, { fields: [dealApprovalsTable.approvalDocumentId], references: [documentsTable.id] }),
  creator: one(usersTable, { fields: [dealApprovalsTable.createdBy], references: [usersTable.id] }),
}));

export const partnerContactsRelations = relations(partnerContactsTable, ({ one }) => ({
  partner: one(lendersTable, { fields: [partnerContactsTable.partnerId], references: [lendersTable.id] }),
  creator: one(usersTable, { fields: [partnerContactsTable.createdBy], references: [usersTable.id] }),
}));

export const communicationsRelations = relations(communicationsTable, ({ one }) => ({
  lead: one(leadsTable, {
    fields: [communicationsTable.leadId],
    references: [leadsTable.id],
  }),
  user: one(usersTable, {
    fields: [communicationsTable.userId],
    references: [usersTable.id],
  }),
}));

export const emailTemplatesRelations = relations(emailTemplatesTable, ({ one, many }) => ({
  creator: one(usersTable, {
    fields: [emailTemplatesTable.createdBy],
    references: [usersTable.id],
  }),
  owner: one(usersTable, {
    fields: [emailTemplatesTable.ownerId],
    references: [usersTable.id],
    relationName: "email_template_owner",
  }),
  emailSends: many(emailSendsTable),
  sequenceSteps: many(dripSequenceStepsTable),
}));

export const dripSequencesRelations = relations(dripSequencesTable, ({ one, many }) => ({
  creator: one(usersTable, {
    fields: [dripSequencesTable.createdBy],
    references: [usersTable.id],
  }),
  owner: one(usersTable, {
    fields: [dripSequencesTable.ownerId],
    references: [usersTable.id],
    relationName: "drip_sequence_owner",
  }),
  steps: many(dripSequenceStepsTable),
  enrollments: many(dripEnrollmentsTable),
}));

export const dripSequenceStepsRelations = relations(dripSequenceStepsTable, ({ one }) => ({
  sequence: one(dripSequencesTable, {
    fields: [dripSequenceStepsTable.sequenceId],
    references: [dripSequencesTable.id],
  }),
  template: one(emailTemplatesTable, {
    fields: [dripSequenceStepsTable.templateId],
    references: [emailTemplatesTable.id],
  }),
}));

export const dripEnrollmentsRelations = relations(dripEnrollmentsTable, ({ one }) => ({
  lead: one(leadsTable, {
    fields: [dripEnrollmentsTable.leadId],
    references: [leadsTable.id],
  }),
  sequence: one(dripSequencesTable, {
    fields: [dripEnrollmentsTable.sequenceId],
    references: [dripSequencesTable.id],
  }),
}));

export const emailSendsRelations = relations(emailSendsTable, ({ one }) => ({
  lead: one(leadsTable, {
    fields: [emailSendsTable.leadId],
    references: [leadsTable.id],
  }),
  user: one(usersTable, {
    fields: [emailSendsTable.userId],
    references: [usersTable.id],
  }),
  template: one(emailTemplatesTable, {
    fields: [emailSendsTable.templateId],
    references: [emailTemplatesTable.id],
  }),
}));

export const flyerTemplatesRelations = relations(flyerTemplatesTable, ({ one, many }) => ({
  creator: one(usersTable, { fields: [flyerTemplatesTable.createdBy], references: [usersTable.id] }),
  generatedFlyers: many(generatedFlyersTable),
}));

export const generatedFlyersRelations = relations(generatedFlyersTable, ({ one }) => ({
  lead: one(leadsTable, { fields: [generatedFlyersTable.leadId], references: [leadsTable.id] }),
  template: one(flyerTemplatesTable, { fields: [generatedFlyersTable.templateId], references: [flyerTemplatesTable.id] }),
  createdByUser: one(usersTable, { fields: [generatedFlyersTable.createdBy], references: [usersTable.id] }),
}));

export const collateralTemplatesRelations = relations(collateralTemplatesTable, ({ one, many }) => ({
  creator: one(usersTable, { fields: [collateralTemplatesTable.createdBy], references: [usersTable.id] }),
  renders: many(collateralRendersTable),
}));

export const collateralRendersRelations = relations(collateralRendersTable, ({ one }) => ({
  template: one(collateralTemplatesTable, {
    fields: [collateralRendersTable.templateId],
    references: [collateralTemplatesTable.id],
  }),
  user: one(usersTable, { fields: [collateralRendersTable.userId], references: [usersTable.id] }),
  lead: one(leadsTable, { fields: [collateralRendersTable.leadId], references: [leadsTable.id] }),
}));

export const applicationsRelations = relations(applicationsTable, ({ one }) => ({
  lead: one(leadsTable, { fields: [applicationsTable.leadId], references: [leadsTable.id] }),
}));

export const bankStatementExtractionsRelations = relations(bankStatementExtractionsTable, ({ one }) => ({
  lead: one(leadsTable, { fields: [bankStatementExtractionsTable.leadId], references: [leadsTable.id] }),
  document: one(documentsTable, { fields: [bankStatementExtractionsTable.documentId], references: [documentsTable.id] }),
}));

export const underwritingCorrectionsRelations = relations(underwritingCorrectionsTable, ({ one }) => ({
  lead: one(leadsTable, { fields: [underwritingCorrectionsTable.leadId], references: [leadsTable.id] }),
  evidenceDocument: one(documentsTable, { fields: [underwritingCorrectionsTable.evidenceDocumentId], references: [documentsTable.id] }),
  creator: one(usersTable, { fields: [underwritingCorrectionsTable.createdBy], references: [usersTable.id] }),
}));

export const creditPullsRelations = relations(creditPullsTable, ({ one, many }) => ({
  lead: one(leadsTable, { fields: [creditPullsTable.leadId], references: [leadsTable.id] }),
  pulledByUser: one(usersTable, { fields: [creditPullsTable.pulledBy], references: [usersTable.id] }),
  complianceLogs: many(creditComplianceLogTable),
}));

export const creditComplianceLogRelations = relations(creditComplianceLogTable, ({ one }) => ({
  lead: one(leadsTable, { fields: [creditComplianceLogTable.leadId], references: [leadsTable.id] }),
  user: one(usersTable, { fields: [creditComplianceLogTable.userId], references: [usersTable.id] }),
  creditPull: one(creditPullsTable, { fields: [creditComplianceLogTable.creditPullId], references: [creditPullsTable.id] }),
}));

export const workflowRulesRelations = relations(workflowRulesTable, ({ one }) => ({
  creator: one(usersTable, { fields: [workflowRulesTable.createdBy], references: [usersTable.id] }),
}));

export const lenderMatchesRelations = relations(lenderMatchesTable, ({ one }) => ({
  lead: one(leadsTable, { fields: [lenderMatchesTable.leadId], references: [leadsTable.id] }),
  lender: one(lendersTable, { fields: [lenderMatchesTable.lenderId], references: [lendersTable.id] }),
}));

export const lendersRelations = relations(lendersTable, ({ many }) => ({
  guidelineVersions: many(lenderGuidelineVersionsTable),
  contacts: many(partnerContactsTable),
  matches: many(lenderMatchesTable),
  submissions: many(lenderSubmissionsTable),
}));

export const lenderGuidelineVersionsRelations = relations(lenderGuidelineVersionsTable, ({ one }) => ({
  lender: one(lendersTable, { fields: [lenderGuidelineVersionsTable.lenderId], references: [lendersTable.id] }),
}));

export const lenderSubmissionsRelations = relations(lenderSubmissionsTable, ({ one }) => ({
  lead: one(leadsTable, { fields: [lenderSubmissionsTable.leadId], references: [leadsTable.id] }),
  deal: one(dealsTable, { fields: [lenderSubmissionsTable.dealId], references: [dealsTable.id] }),
  lender: one(lendersTable, { fields: [lenderSubmissionsTable.lenderId], references: [lendersTable.id] }),
  sender: one(usersTable, { fields: [lenderSubmissionsTable.sentBy], references: [usersTable.id] }),
}));

export const notificationsRelations = relations(notificationsTable, ({ one }) => ({
  user: one(usersTable, { fields: [notificationsTable.userId], references: [usersTable.id] }),
  lead: one(leadsTable, { fields: [notificationsTable.leadId], references: [leadsTable.id] }),
}));

export const campaignsRelations = relations(campaignsTable, ({ one, many }) => ({
  owner: one(usersTable, { fields: [campaignsTable.ownerId], references: [usersTable.id] }),
  creator: one(usersTable, { fields: [campaignsTable.createdBy], references: [usersTable.id] }),
  emailTemplate: one(emailTemplatesTable, { fields: [campaignsTable.emailTemplateId], references: [emailTemplatesTable.id] }),
  approvals: many(campaignApprovalsTable),
  launches: many(campaignLaunchesTable),
  auditEvents: many(campaignAuditEventsTable),
  recipients: many(campaignRecipientsTable),
}));

export const campaignAudiencePresetsRelations = relations(campaignAudiencePresetsTable, ({ one }) => ({
  owner: one(usersTable, { fields: [campaignAudiencePresetsTable.ownerId], references: [usersTable.id] }),
}));

export const campaignApprovalsRelations = relations(campaignApprovalsTable, ({ one }) => ({
  campaign: one(campaignsTable, { fields: [campaignApprovalsTable.campaignId], references: [campaignsTable.id] }),
  approver: one(usersTable, { fields: [campaignApprovalsTable.approvedBy], references: [usersTable.id] }),
}));

export const campaignLaunchesRelations = relations(campaignLaunchesTable, ({ one, many }) => ({
  campaign: one(campaignsTable, { fields: [campaignLaunchesTable.campaignId], references: [campaignsTable.id] }),
  requester: one(usersTable, { fields: [campaignLaunchesTable.requestedBy], references: [usersTable.id] }),
  recipients: many(campaignRecipientsTable),
}));

export const campaignRecipientsRelations = relations(campaignRecipientsTable, ({ one }) => ({
  campaign: one(campaignsTable, { fields: [campaignRecipientsTable.campaignId], references: [campaignsTable.id] }),
  launch: one(campaignLaunchesTable, { fields: [campaignRecipientsTable.launchId], references: [campaignLaunchesTable.id] }),
  lead: one(leadsTable, { fields: [campaignRecipientsTable.leadId], references: [leadsTable.id] }),
}));

export const campaignAuditEventsRelations = relations(campaignAuditEventsTable, ({ one }) => ({
  campaign: one(campaignsTable, { fields: [campaignAuditEventsTable.campaignId], references: [campaignsTable.id] }),
  actor: one(usersTable, { fields: [campaignAuditEventsTable.actorUserId], references: [usersTable.id] }),
}));
