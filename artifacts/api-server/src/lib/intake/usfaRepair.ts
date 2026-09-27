import { google } from "googleapis";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, activityLogTable, companySettingsTable, documentsTable, leadsTable, tasksTable, usfaIntakeLogTable,
} from "@workspace/db";
import { createUsfaStatementTasks, validateUsfaHeaders } from "./usfaPoller";
import { logger } from "../logger";
import {
  getUsfaStatementLinks, USFA_STATEMENT_TASK_TITLE, type UsfaRow, type UsfaStatementLink,
} from "./usfa";

export type UsfaRepairEntry = {
  leadId: number;
  storedLinkCount: number;
  sheetLinkCount: number | null;
  linksUpdated: boolean;
  taskAction: "created" | "collapsed" | "updated" | "unchanged";
  removedTaskCount: number;
  taskCompleted: boolean;
  error?: string;
};

type SheetRow = { row: UsfaRow; rowNumber: number };
type SheetRows = { rows: Map<string, SheetRow>; duplicateIds: Set<string> };

function storedLinks(metadata: unknown): { urls: string[]; bySlot: UsfaStatementLink[] } {
  const record = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  const urls = Array.isArray(record.statementLinks)
    ? record.statementLinks.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const bySlot = Array.isArray(record.statementLinksBySlot)
    ? record.statementLinksBySlot.filter((value): value is UsfaStatementLink =>
      Boolean(value && typeof value === "object" && "slot" in value && "url" in value &&
        ["A", "B", "C", "D"].includes(String(value.slot)) && typeof value.url === "string"))
    : [];
  return { urls, bySlot };
}

export function planUsfaLinkRepair(metadata: unknown, sheetLinks: UsfaStatementLink[]) {
  const existing = storedLinks(metadata);
  // Do not erase already recorded links if the vendor temporarily clears a row.
  const next = sheetLinks.length ? sheetLinks : existing.bySlot;
  const nextUrls = sheetLinks.length ? sheetLinks.map(({ url }) => url) : existing.urls;
  return {
    storedLinkCount: existing.urls.length,
    sheetLinkCount: sheetLinks.length,
    changed: JSON.stringify(existing.urls) !== JSON.stringify(nextUrls) ||
      (sheetLinks.length > 0 && (existing.bySlot.length !== next.length ||
        existing.bySlot.some((link, index) =>
          link.slot !== next[index]?.slot || link.url !== next[index]?.url))),
    urls: nextUrls,
    bySlot: next,
  };
}

async function loadUsfaSheetRows(): Promise<SheetRows> {
  const [settings] = await db.select({
    usfaSheetId: companySettingsTable.usfaSheetId,
    usfaSheetTab: companySettingsTable.usfaSheetTab,
  }).from(companySettingsTable).limit(1);
  if (!settings?.usfaSheetId) throw new Error("Sheet ID is not configured.");
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Google service account is not configured.");
  let credentials: { client_email: string; private_key: string };
  try {
    credentials = JSON.parse(raw);
    if (typeof credentials.client_email !== "string" || typeof credentials.private_key !== "string") {
      throw new Error("Invalid credentials");
    }
  } catch {
    throw new Error("Google service account credentials are invalid.");
  }
  const auth = new google.auth.GoogleAuth({
    credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const tab = settings.usfaSheetTab || "Sheet1";
  // Reading the whole used tab, rather than A:AB, keeps statement columns
  // available even when the vendor inserts additional columns.
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: settings.usfaSheetId, range: `'${tab.replaceAll("'", "''")}'`,
  });
  const [first = [], ...values] = response.data.values ?? [];
  const headers = first.map(String);
  if (!validateUsfaHeaders(headers)) throw new Error("The USFA Sheet is missing required headers.");
  const rows = new Map<string, SheetRow>();
  const duplicateIds = new Set<string>();
  const idIndex = headers.indexOf("Id");
  values.forEach((values, index) => {
    const id = String(values[idIndex] ?? "").trim();
    if (!id) return;
    if (rows.has(id)) duplicateIds.add(id);
    else rows.set(id, {
      row: Object.fromEntries(headers.map((header, column) => [header, values[column] ?? null])),
      rowNumber: index + 2,
    });
  });
  return { rows, duplicateIds };
}

/** The repair reads the Sheet once; each lead is reconciled in its own transaction. */
export async function repairUsfaLeads(
  source: () => Promise<SheetRows> = loadUsfaSheetRows,
  onlyLeadIds?: number[],
  actorId: number | null = null,
): Promise<{ leads: UsfaRepairEntry[] }> {
  const { rows, duplicateIds } = await source();
  const leads = await db.select({
    id: leadsTable.id, externalId: leadsTable.externalId, assignedRepId: leadsTable.assignedRepId,
  }).from(leadsTable).where(onlyLeadIds
    ? and(eq(leadsTable.leadSource, "usfundadvisor"), inArray(leadsTable.id, onlyLeadIds))
    : eq(leadsTable.leadSource, "usfundadvisor")).orderBy(leadsTable.id);
  const report: UsfaRepairEntry[] = [];

  for (const lead of leads) {
    const externalId = lead.externalId?.trim();
    const match = externalId ? rows.get(externalId) : undefined;
    const entry: UsfaRepairEntry = {
      leadId: lead.id, storedLinkCount: 0,
      sheetLinkCount: match && !duplicateIds.has(externalId!) ? getUsfaStatementLinks(match.row).length : null,
      linksUpdated: false, taskAction: "unchanged", removedTaskCount: 0, taskCompleted: false,
    };
    try {
      await db.transaction(async (tx) => {
        // Serialize repair with other repairs for this lead.
        await tx.select({ id: leadsTable.id }).from(leadsTable)
          .where(eq(leadsTable.id, lead.id)).for("update");
        // A lead can have several intake receipts after reapplications. Only
        // the receipt for its current Sheet external ID owns these links.
        const receipt = externalId
          ? (await tx.select().from(usfaIntakeLogTable)
            .where(eq(usfaIntakeLogTable.externalId, externalId)).limit(1))[0]
          : undefined;
        const previous = storedLinks(receipt?.metadata);
        entry.storedLinkCount = previous.urls.length;
        if (receipt?.leadId != null && receipt.leadId !== lead.id) {
          entry.error = "The source receipt belongs to a different lead.";
        } else if (!externalId) entry.error = "Lead has no external ID; Sheet row cannot be matched.";
        else if (duplicateIds.has(externalId)) entry.error = "Multiple Sheet rows have this external ID.";
        else if (!match) entry.error = "Sheet row not found for this external ID.";
        else {
          const sheetLinks = getUsfaStatementLinks(match.row);
          const plan = planUsfaLinkRepair(receipt?.metadata, sheetLinks);
          if (plan.changed || !receipt) {
            const metadata = {
              ...(receipt?.metadata && typeof receipt.metadata === "object" ? receipt.metadata as object : {}),
              statementLinks: plan.urls,
              statementLinksBySlot: plan.bySlot,
            };
            if (receipt) {
              await tx.update(usfaIntakeLogTable).set({ metadata })
                .where(eq(usfaIntakeLogTable.id, receipt.id));
            } else {
              await tx.insert(usfaIntakeLogTable).values({
                externalId, leadId: lead.id, rowNumber: match.rowNumber, status: "dup", metadata,
              });
            }
            entry.linksUpdated = plan.changed;
          }
        }

        // Reapplications can introduce a second external ID on the same
        // lead. Their receipts retain their own provenance and must also
        // track any new links in their respective Sheet rows.
        const reapplications = await tx.select().from(usfaIntakeLogTable)
          .where(eq(usfaIntakeLogTable.leadId, lead.id));
        for (const secondary of reapplications) {
          if (secondary.externalId === externalId || duplicateIds.has(secondary.externalId)) continue;
          const secondaryRow = rows.get(secondary.externalId);
          if (!secondaryRow) continue;
          const plan = planUsfaLinkRepair(secondary.metadata, getUsfaStatementLinks(secondaryRow.row));
          if (!plan.changed) continue;
          await tx.update(usfaIntakeLogTable).set({
            metadata: {
              ...(secondary.metadata && typeof secondary.metadata === "object" ? secondary.metadata as object : {}),
              statementLinks: plan.urls, statementLinksBySlot: plan.bySlot,
            },
          }).where(eq(usfaIntakeLogTable.id, secondary.id));
          entry.linksUpdated = true;
        }

        const tasks = await tx.select().from(tasksTable).where(and(
          eq(tasksTable.leadId, lead.id), eq(tasksTable.title, USFA_STATEMENT_TASK_TITLE),
        )).orderBy(tasksTable.id);
        const bankDocs = await tx.select({ id: documentsTable.id }).from(documentsTable)
          .where(and(eq(documentsTable.leadId, lead.id), eq(documentsTable.category, "bank_statement")))
          .limit(3);
        const completed = bankDocs.length >= 3;
        if (!tasks.length) {
          await createUsfaStatementTasks(tx, lead.id, lead.assignedRepId, {
            title: USFA_STATEMENT_TASK_TITLE, statementCount: entry.sheetLinkCount ?? entry.storedLinkCount,
          });
          if (completed) {
            await tx.update(tasksTable).set({
              isCompleted: true, completedAt: new Date(), updatedAt: new Date(),
            }).where(and(eq(tasksTable.leadId, lead.id), eq(tasksTable.title, USFA_STATEMENT_TASK_TITLE)));
          }
          entry.taskAction = "created";
          entry.taskCompleted = completed;
        } else {
          const keeper = tasks.find((task) => task.isCompleted) ?? tasks[0];
          const changes: Partial<typeof tasksTable.$inferInsert> = {};
          if (keeper.userId !== lead.assignedRepId) changes.userId = lead.assignedRepId;
          if (!keeper.dueDate) changes.dueDate = new Date().toISOString().slice(0, 10);
          if (completed && !keeper.isCompleted) {
            changes.isCompleted = true;
            changes.completedAt = new Date();
          }
          if (Object.keys(changes).length) {
            await tx.update(tasksTable).set({ ...changes, updatedAt: new Date() })
              .where(eq(tasksTable.id, keeper.id));
          }
          const extraIds = tasks.filter((task) => task.id !== keeper.id).map((task) => task.id);
          entry.removedTaskCount = extraIds.length;
          entry.taskCompleted = keeper.isCompleted || completed;
          if (extraIds.length) {
            await tx.insert(activityLogTable).values({
              userId: actorId, leadId: lead.id,
              action: "usfa_statement_tasks_consolidated", entityType: "lead", entityId: String(lead.id),
              details: { keptTaskId: keeper.id, removedTaskIds: extraIds },
            });
            await tx.delete(tasksTable).where(inArray(tasksTable.id, extraIds));
          }
          if (extraIds.length) entry.taskAction = "collapsed";
          else if (Object.keys(changes).length) entry.taskAction = "updated";
        }
      });
    } catch {
      // Do not disclose Sheet URLs, provider errors, or database details.
      logger.warn({ leadId: lead.id }, "USFA lead repair failed");
      entry.linksUpdated = false;
      entry.taskAction = "unchanged";
      entry.removedTaskCount = 0;
      entry.error = "Could not repair this lead; retry or inspect server logs.";
    }
    report.push(entry);
  }
  return { leads: report };
}