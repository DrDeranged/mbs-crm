import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runDripJob } from "./lib/dripJob";
import { runTaskReminderJob } from "./lib/taskReminderJob";
import { runRenewalJob } from "./lib/renewalJob";
import { runBackupJob } from "./lib/backupJob";
import { seedDefaultWorkflowRules } from "./lib/workflowEngine";
import { closeBrowser } from "./lib/renderPdf";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const intervals: ReturnType<typeof setInterval>[] = [];

async function checkApplicationSignatureColumns(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_schema = 'public'
        AND table_name = 'applications'
        AND column_name IN ('signature_method', 'signature_signed_at')
    `);
    const presentColumns = new Set(
      result.rows.map((row) => String((row as Record<string, unknown>)["column_name"])),
    );
    const requiredColumns = ["signature_method", "signature_signed_at"];
    const missingColumns = requiredColumns.filter((column) => !presentColumns.has(column));
    if (missingColumns.length > 0) {
      logger.error(
        { missingColumns, migration: "012_application_signature.sql" },
        "Required application signature columns are missing; apply 012_application_signature.sql",
      );
    }
  } catch (err) {
    logger.error(
      { err, migration: "012_application_signature.sql" },
      "Could not verify application signature columns for 012_application_signature.sql",
    );
  }
}

async function checkApplicationOptionalColumns(): Promise<void> {
  const requiredColumns = [
    "business_type",
    "annual_revenue",
    "business_start_date",
    "years_under_current_ownership",
    "business_description",
    "est_credit_score",
    "timeline_funds_needed",
    "year_make_model",
    "trucks_in_fleet",
    "down_payment_amount",
    "secondary_owner_name",
    "secondary_owner_email",
    "secondary_owner_address",
    "secondary_owner_ssn_encrypted",
    "secondary_owner_dob",
    "secondary_owner_ownership_pct",
    "secondary_owner_cell",
    "secondary_owner_est_credit_score",
  ];
  try {
    const result = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_schema = 'public'
        AND table_name = 'applications'
        AND column_name IN (${sql.join(requiredColumns.map((column) => sql`${column}`), sql`, `)})
    `);
    const presentColumns = new Set(
      result.rows.map((row) => String((row as Record<string, unknown>)["column_name"])),
    );
    const missingColumns = requiredColumns.filter((column) => !presentColumns.has(column));
    if (missingColumns.length > 0) {
      logger.error(
        { missingColumns, migration: "014_application_optional_fields.sql" },
        "Required optional application columns are missing; apply 014_application_optional_fields.sql",
      );
    }
  } catch (err) {
    logger.error(
      { err, migration: "014_application_optional_fields.sql" },
      "Could not verify optional application columns for 014_application_optional_fields.sql",
    );
  }
}

async function checkApplicationConsentColumns(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_schema = 'public'
        AND table_name = 'applications'
        AND column_name IN ('consent_text_version')
    `);
    const presentColumns = new Set(
      result.rows.map((row) => String((row as Record<string, unknown>)["column_name"])),
    );
    const requiredColumns = ["consent_text_version"];
    const missingColumns = requiredColumns.filter((column) => !presentColumns.has(column));
    if (missingColumns.length > 0) {
      logger.error(
        { missingColumns, migration: "015_application_consent_text_version.sql" },
        "Required application consent columns are missing; apply 015_application_consent_text_version.sql",
      );
    }
  } catch (err) {
    logger.error(
      { err, migration: "015_application_consent_text_version.sql" },
      "Could not verify application consent columns for 015_application_consent_text_version.sql",
    );
  }
}

async function checkUserTitleColumn(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_schema = 'public'
        AND table_name = 'users'
        AND column_name IN ('title')
    `);
    const presentColumns = new Set(
      result.rows.map((row) => String((row as Record<string, unknown>)["column_name"])),
    );
    if (!presentColumns.has("title")) {
      logger.error(
        { missingColumns: ["title"], migration: "016_user_titles.sql" },
        "Required user title column is missing; apply 016_user_titles.sql",
      );
    }
  } catch (err) {
    logger.error(
      { err, migration: "016_user_titles.sql" },
      "Could not verify user title column for 016_user_titles.sql",
    );
  }
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  void checkApplicationSignatureColumns();
  void checkApplicationOptionalColumns();
  void checkApplicationConsentColumns();
  void checkUserTitleColumn();

  // Seed default workflow rules (no-op if already seeded)
  seedDefaultWorkflowRules().catch((err) => logger.warn({ err }, "Workflow rules seed error"));

  // Drip email background job — runs every 10 minutes
  const DRIP_INTERVAL_MS = 10 * 60 * 1000;
  runDripJob().catch((err) => logger.error({ err }, "Drip job startup error"));
  const dripInterval = setInterval(() => {
    runDripJob().catch((err) => logger.error({ err }, "Drip job error"));
  }, DRIP_INTERVAL_MS);
  intervals.push(dripInterval);

  // Task reminder push notifications — checks every hour, fires at 9 AM
  const REMINDER_INTERVAL_MS = 60 * 60 * 1000;
  runTaskReminderJob().catch((err) => logger.error({ err }, "Task reminder startup error"));
  const reminderInterval = setInterval(() => {
    runTaskReminderJob().catch((err) => logger.error({ err }, "Task reminder job error"));
  }, REMINDER_INTERVAL_MS);
  intervals.push(reminderInterval);

  // Renewal radar — flags funded leads ready to re-fund; runs at startup then once daily
  const RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000;
  runRenewalJob().catch((err) => logger.error({ err }, "Renewal job startup error"));
  const renewalInterval = setInterval(() => {
    runRenewalJob().catch((err) => logger.error({ err }, "Renewal job error"));
  }, RENEWAL_INTERVAL_MS);
  intervals.push(renewalInterval);

  // Nightly off-site backup to Backblaze B2 — waits 60s after boot then runs if no backup
  // exists for today, then repeats every 24 hours
  const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const backupBootDelay = setTimeout(() => {
    runBackupJob().catch((err) => logger.error({ err }, "Backup job startup error"));
  }, 60_000);
  const backupInterval = setInterval(() => {
    runBackupJob().catch((err) => logger.error({ err }, "Backup job error"));
  }, BACKUP_INTERVAL_MS);
  intervals.push(backupInterval);
  // also clear the boot-delay timer on shutdown
  (intervals as any).__backupBootDelay = backupBootDelay;
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down gracefully");
  intervals.forEach(clearInterval);
  clearTimeout((intervals as any).__backupBootDelay);
  await closeBrowser().catch((err) => logger.warn({ err }, "Error closing browser during shutdown"));
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn("Forced exit after 15s");
    process.exit(1);
  }, 15_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
