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

function serviceAccountCredentials(raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON): Record<string, string> | null {
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

type UsfaHeaderReader = (credentials: Record<string, string>, sheetId: string, range: string) => Promise<unknown[]>;

async function readUsfaHeader(credentials: Record<string, string>, sheetId: string, range: string): Promise<unknown[]> {
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return response.data.values?.[0] ?? [];
}

export async function testUsfaSheetConnection(
  sheetId: string | null,
  tab: string,
  options: { rawCredentials?: string; readHeader?: UsfaHeaderReader } = {},
): Promise<{ ok: true; columnCount: number } | { ok: false; error: string }> {
  if (!sheetId?.trim()) return { ok: false, error: "Save a Sheet ID before testing the connection." };
  if (!tab.trim() || tab.length > 100 || /[\x00-\x1f]/.test(tab) || sheetId.length > 256) {
    return { ok: false, error: "The saved Sheet ID or Tab is invalid." };
  }
  const raw = options.rawCredentials === undefined ? process.env.GOOGLE_SERVICE_ACCOUNT_JSON : options.rawCredentials;
  if (!raw?.trim()) return { ok: false, error: "Google service account is absent." };
  const credentials = serviceAccountCredentials(raw);
  if (!credentials) return { ok: false, error: "Google service account credentials are invalid." };
  try {
    const range = `'${tab.replaceAll("'", "''")}'!1:1`;
    const headers = await (options.readHeader ?? readUsfaHeader)(credentials, sheetId.trim(), range);
    return { ok: true, columnCount: headers.length };
  } catch (error) {
    // Google errors can contain request details. Only return classified errors,
    // never the provider's raw message or the service-account JSON.
    const providerError = error as { code?: string | number; response?: { status?: number }; message?: string };
    const status = Number(providerError.response?.status ?? providerError.code);
    if (status === 401 || status === 403 || /invalid_grant|unauthorized|permission|credential/i.test(providerError.message ?? "")) {
      return { ok: false, error: "Google authentication or access was denied. Verify the service account and share the sheet with it." };
    }
    if (status === 404) return { ok: false, error: "Google Sheet or Tab not found, or the sheet is not shared with the service account." };
    if (status === 400) return { ok: false, error: "Google rejected the Sheet ID or Tab. Check the saved settings." };
    return { ok: false, error: `Could not read the Google Sheet header${Number.isInteger(status) ? ` (HTTP ${status})` : ""}.` };
  }
}

type UsfaTaskTransaction = {
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
};

export async function createUsfaStatementTasks(
  tx: UsfaTaskTransaction,
  leadId: number,
  assignedRepId: number | null,
  taskPlan: NonNullable<ReturnType<typeof mapUsfaRow>["taskPlan"]>,
): Promise<number> {
  const values = {
    leadId,
    title: taskPlan.title,
    description: `${taskPlan.statementCount} statement link(s) require download from the USFA dashboard.`,
    isCompleted: false,
  };
  if (assignedRepId != null) {
    await tx.insert(tasksTable).values({ ...values, userId: assignedRepId });
    return 1;
  }
  const admins = await tx.select({ id: usersTable.id }).from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));
  if (admins.length > 0) {
    for (const admin of admins) {
      await tx.insert(tasksTable).values({ ...values, userId: admin.id });
    }
    return admins.length;
  }
  // user_id is nullable for the administrator queue until an admin exists.
  await tx.insert(tasksTable).values({ ...values, userId: null });
  return 1;
}

function rowObject(headers: string[], values: unknown[]): UsfaRow {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null]));
}

export async function ingestUsfaRow(row: UsfaRow, rowNumber = 0): Promise<{ status: "ok" | "dup"; leadId: number | null }> {
  const mapped = mapUsfaRow(row);
  const outcome: {
    status: "ok" | "dup";
    leadId: number | null;
    notification?: { title: string; body: string };
  } = await db.transaction(async (tx): Promise<{
    status: "ok" | "dup";
    leadId: number | null;
    notification?: { title: string; body: string };
  }> => {
    const prior = await tx.query.usfaIntakeLogTable.findFirst({
      where: eq(usfaIntakeLogTable.externalId, mapped.externalId),
    });
    if (prior && prior.status !== "error") return { status: "dup", leadId: prior.leadId };
    if (prior?.status === "error") {
      await tx.delete(usfaIntakeLogTable).where(eq(usfaIntakeLogTable.id, prior.id));
    }

    const externalLead = await tx.query.leadsTable.findFirst({
      where: eq(leadsTable.externalId, mapped.externalId),
    });
    const conditions = [];
    if (mapped.dedupePlan.allowEmailMatch && mapped.lead.email) conditions.push(eq(leadsTable.email, mapped.lead.email));
    if (mapped.lead.phone) conditions.push(eq(leadsTable.phone, mapped.lead.phone));
    const existing = externalLead ?? (conditions.length
      ? await tx.query.leadsTable.findFirst({ where: or(...conditions) })
      : undefined);
    if (existing) {
      const companyValues = {
        ...(mapped.company.name ? { name: mapped.company.name } : {}),
        ...(mapped.company.address ? { address: mapped.company.address } : {}),
        ...(mapped.company.city ? { city: mapped.company.city } : {}),
        ...(mapped.company.state ? { state: mapped.company.state } : {}),
        ...(mapped.company.zip ? { zip: mapped.company.zip } : {}),
        ...(mapped.company.industry ? { industry: mapped.company.industry } : {}),
        ...(mapped.company.timeInBusinessMonths != null ? { timeInBusinessMonths: mapped.company.timeInBusinessMonths } : {}),
        ...(mapped.company.annualRevenue != null ? { annualRevenue: String(mapped.company.annualRevenue) } : {}),
      };
      const [company] = await tx.query.companiesTable.findMany({
        where: eq(companiesTable.leadId, existing.id),
        limit: 1,
      });
      if (company) {
        if (Object.keys(companyValues).length > 0) {
          await tx.update(companiesTable).set({ ...companyValues, updatedAt: new Date() })
            .where(eq(companiesTable.id, company.id));
        }
      } else {
        await tx.insert(companiesTable).values({
          leadId: existing.id,
          ...mapped.company,
          annualRevenue: mapped.company.annualRevenue == null ? null : String(mapped.company.annualRevenue),
        });
      }
      if (mapped.intakePrefill) {
        await tx.insert(usfaIntakePrefillTable).values({
          leadId: existing.id,
          encryptedPayload: encrypt(JSON.stringify(mapped.intakePrefill)),
        }).onConflictDoUpdate({
          target: usfaIntakePrefillTable.leadId,
          set: { encryptedPayload: encrypt(JSON.stringify(mapped.intakePrefill)), updatedAt: new Date() },
        });
      }
      await tx.insert(activityLogTable).values({
        userId: null, leadId: existing.id, action: "usfa_note", entityType: "lead",
        entityId: String(existing.id), details: {
          comments: mapped.metadata.comments,
          source: "usfundadvisor",
          reapplication: true,
          externalId: mapped.externalId,
          statementLinks: mapped.metadata.statementLinks,
        },
      });
      if (mapped.taskPlan) {
        await createUsfaStatementTasks(tx, existing.id, existing.assignedRepId, mapped.taskPlan);
      }
      await tx.insert(usfaIntakeLogTable).values({
        externalId: mapped.externalId, rowNumber, leadId: existing.id, status: "dup",
        metadata: {
          ...mapped.metadata,
          reason: "reapplication",
          emailMatchAllowed: mapped.dedupePlan.allowEmailMatch,
        },
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
      }).onConflictDoUpdate({
        target: usfaIntakePrefillTable.leadId,
        set: { encryptedPayload: encrypt(JSON.stringify(mapped.intakePrefill)), updatedAt: new Date() },
      });
    }
    await tx.insert(activityLogTable).values({
      userId: null, leadId: lead.id, action: "usfa_note", entityType: "lead",
      entityId: String(lead.id), details: { comments: mapped.metadata.comments, source: "usfundadvisor" },
    });
    if (mapped.taskPlan) {
      await createUsfaStatementTasks(tx, lead.id, lead.assignedRepId, mapped.taskPlan);
    }
    await tx.insert(usfaIntakeLogTable).values({
      externalId: mapped.externalId, rowNumber, leadId: lead.id, status: "ok",
      metadata: mapped.metadata,
    });
    return {
      status: "ok",
      leadId: lead.id,
      notification: {
        title: "New USFA lead received",
        body: `${mapped.lead.companyName ?? "A USFA lead"} was added from the USFA intake sheet.`,
      },
    };
  });
  const notification = outcome.notification;
  if (outcome.status === "ok" && notification) {
    await notifyAllAdmins("application_received", notification.title, notification.body, outcome.leadId);
  }
  return { status: outcome.status, leadId: outcome.leadId };
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