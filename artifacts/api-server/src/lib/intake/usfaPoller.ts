import { google } from "googleapis";
import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  activityLogTable,
  companiesTable,
  companySettingsTable,
  leadsTable,
  tasksTable,
  usersTable,
  usfaIntakeLogTable,
  usfaIntakePrefillTable,
} from "@workspace/db";
import { encrypt } from "../encryption";
import { logger } from "../logger";
import { notifyAllAdmins } from "../notify";
import { selectNextInboundAssigneeInTransaction } from "../leadDistribution";
import { mapUsfaRow, USFA_HEADERS, type UsfaRow } from "./usfa";

export type UsfaRunResult = {
  status: "ok" | "skipped";
  reason?: string;
  processed: number;
  skipped: number;
  duplicates: number;
  errors: number;
  headerValid: boolean;
};

function serviceAccountCredentials(): Record<string, string> | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || typeof value.client_email !== "string" || typeof value.private_key !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

export function validateUsfaHeaders(row: unknown[]): boolean {
  const headers = new Set(row.map((value) => String(value ?? "").trim()));
  return USFA_HEADERS.every((header) => headers.has(header));
}

function rowObject(headers: string[], values: unknown[]): UsfaRow {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null]));
}

export async function ingestUsfaRow(row: UsfaRow, rowNumber = 0): Promise<{ status: "ok" | "dup"; leadId: number | null }> {
  const mapped = mapUsfaRow(row);
  return db.transaction(async (tx) => {
    const prior = await tx.query.usfaIntakeLogTable.findFirst({
      where: eq(usfaIntakeLogTable.externalId, mapped.externalId),
    });
    if (prior) return { status: prior.status === "error" ? "ok" : "dup", leadId: prior.leadId };

    const conditions = [];
    if (mapped.dedupePlan.allowEmailMatch && mapped.lead.email) conditions.push(eq(leadsTable.email, mapped.lead.email));
    if (mapped.lead.phone) conditions.push(eq(leadsTable.phone, mapped.lead.phone));
    const existing = conditions.length
      ? await tx.query.leadsTable.findFirst({ where: or(...conditions) })
      : undefined;
    if (existing) {
      await tx.insert(usfaIntakeLogTable).values({
        externalId: mapped.externalId, rowNumber, leadId: existing.id, status: "dup",
        metadata: { reason: "reapplication", emailMatchAllowed: mapped.dedupePlan.allowEmailMatch },
      });
      return { status: "dup", leadId: existing.id };
    }

    const assignment = await selectNextInboundAssigneeInTransaction(tx);
    const [lead] = await tx.insert(leadsTable).values({
      ...mapped.lead,
      createdAt: mapped.lead.createdAt ?? new Date(),
      status: "new_lead",
      assignedRepId: assignment?.repId ?? null,
    }).returning();
    await tx.insert(companiesTable).values({
      leadId: lead.id,
      ...mapped.company,
      annualRevenue: mapped.company.annualRevenue == null ? null : String(mapped.company.annualRevenue),
    });
    if (mapped.intakePrefill) {
      await tx.insert(usfaIntakePrefillTable).values({
        leadId: lead.id,
        encryptedPayload: encrypt(JSON.stringify(mapped.intakePrefill)),
      });
    }
    await tx.insert(activityLogTable).values({
      userId: null, leadId: lead.id, action: "usfa_note", entityType: "lead",
      entityId: String(lead.id), details: { comments: mapped.metadata.comments, source: "usfundadvisor" },
    });
    if (mapped.taskPlan) {
      const [admin] = await tx.select({ id: usersTable.id }).from(usersTable)
        .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true))).limit(1);
      if (admin) {
        await tx.insert(tasksTable).values({
          leadId: lead.id, userId: admin.id, title: mapped.taskPlan.title,
          description: `${mapped.taskPlan.statementCount} statement link(s) require download from the USFA dashboard.`,
          isCompleted: false,
        });
      }
    }
    await tx.insert(usfaIntakeLogTable).values({
      externalId: mapped.externalId, rowNumber, leadId: lead.id, status: "ok",
      metadata: mapped.metadata,
    });
    await notifyAllAdmins(
      "application_received",
      "New USFA lead received",
      `${mapped.lead.companyName ?? "A USFA lead"} was added from the USFA intake sheet.`,
      lead.id,
    );
    return { status: "ok", leadId: lead.id };
  });
}

export async function runUsfaSheetPoll(): Promise<UsfaRunResult> {
  const credentials = serviceAccountCredentials();
  if (!credentials) return { status: "skipped", reason: "GOOGLE_SERVICE_ACCOUNT_JSON is not configured", processed: 0, skipped: 0, duplicates: 0, errors: 0, headerValid: false };
  const [settings] = await db.select().from(companySettingsTable).limit(1);
  if (!settings?.usfaSheetId) return { status: "skipped", reason: "USFA sheet ID is not configured", processed: 0, skipped: 0, duplicates: 0, errors: 0, headerValid: false };
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: settings.usfaSheetId,
    range: `${settings.usfaSheetTab || "Sheet1"}!A:AB`,
  });
  const values = response.data.values ?? [];
  const headers = (values[0] ?? []).map(String);
  if (!validateUsfaHeaders(headers)) {
    logger.warn({ sheetTab: settings.usfaSheetTab || "Sheet1" }, "USFA sheet header validation failed; skipping run");
    return { status: "skipped", reason: "Sheet is missing one or more required headers", processed: 0, skipped: 0, duplicates: 0, errors: 0, headerValid: false };
  }
  const result: UsfaRunResult = { status: "ok", processed: 0, skipped: 0, duplicates: 0, errors: 0, headerValid: true };
  for (let index = 1; index < values.length; index++) {
    const rowNumber = index + 1;
    const externalId = String(values[index]?.[headers.indexOf("Id")] ?? "").trim();
    if (!externalId) { result.errors++; continue; }
    const prior = await db.query.usfaIntakeLogTable.findFirst({ where: eq(usfaIntakeLogTable.externalId, externalId) });
    if (prior) { result.skipped++; continue; }
    try {
      const outcome = await ingestUsfaRow(rowObject(headers, values[index] ?? []), rowNumber);
       if (outcome.status === "dup") result.duplicates++; else result.processed++;
    } catch (error) {
      result.errors++;
      await db.insert(usfaIntakeLogTable).values({ externalId, rowNumber, status: "error", error: error instanceof Error ? error.message : "Unknown ingestion error" }).onConflictDoNothing();
      logger.error({ err: error, externalId, rowNumber }, "USFA row ingestion failed");
    }
  }
  return result;
}

export function startUsfaPoller(): ReturnType<typeof setInterval> {
  const interval = setInterval(() => {
    runUsfaSheetPoll().catch((error) => logger.error({ err: error }, "USFA sheet poll failed"));
  }, 5 * 60 * 1000);
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) logger.info("USFA sheet poller disarmed: GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
  return interval;
}