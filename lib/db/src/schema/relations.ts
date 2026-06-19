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
}));

export const usersRelations = relations(usersTable, ({ many }) => ({
  leads: many(leadsTable),
  notes: many(notesTable),
  tasks: many(tasksTable),
  documents: many(documentsTable),
  activityLog: many(activityLogTable),
  communications: many(communicationsTable),
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
