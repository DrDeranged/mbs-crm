import { relations } from "drizzle-orm";
import { leadsTable } from "./leads";
import { usersTable } from "./users";
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
import { lendersTable, lenderMatchesTable, lenderSubmissionsTable } from "./lenders";

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
  communications: many(communicationsTable),
  emailSends: many(emailSendsTable),
  dripEnrollments: many(dripEnrollmentsTable),
}));

export const usersRelations = relations(usersTable, ({ many }) => ({
  leads: many(leadsTable),
  notes: many(notesTable),
  tasks: many(tasksTable),
  documents: many(documentsTable),
  activityLog: many(activityLogTable),
  communications: many(communicationsTable),
  emailSends: many(emailSendsTable),
  emailTemplates: many(emailTemplatesTable),
}));

export const companiesRelations = relations(companiesTable, ({ one }) => ({
  lead: one(leadsTable, {
    fields: [companiesTable.leadId],
    references: [leadsTable.id],
  }),
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
  emailSends: many(emailSendsTable),
  sequenceSteps: many(dripSequenceStepsTable),
}));

export const dripSequencesRelations = relations(dripSequencesTable, ({ many }) => ({
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

export const lenderMatchesRelations = relations(lenderMatchesTable, ({ one }) => ({
  lead: one(leadsTable, { fields: [lenderMatchesTable.leadId], references: [leadsTable.id] }),
  lender: one(lendersTable, { fields: [lenderMatchesTable.lenderId], references: [lendersTable.id] }),
}));

export const lenderSubmissionsRelations = relations(lenderSubmissionsTable, ({ one }) => ({
  lead: one(leadsTable, { fields: [lenderSubmissionsTable.leadId], references: [leadsTable.id] }),
  lender: one(lendersTable, { fields: [lenderSubmissionsTable.lenderId], references: [lendersTable.id] }),
  submitter: one(usersTable, { fields: [lenderSubmissionsTable.submittedBy], references: [usersTable.id] }),
}));
