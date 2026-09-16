import app from "./app";
import { logger } from "./lib/logger";
import { db, pool, formatSchemaBootLine, getMigrationStatus } from "@workspace/db";
import { runSchemaBoot } from "./lib/schemaBoot";
import { runDripJob } from "./lib/dripJob";
import { runStaleLeadAutoReassignment } from "./lib/staleLeadReassignment";
import { runTaskReminderJob } from "./lib/taskReminderJob";
import { runRenewalJob } from "./lib/renewalJob";
import { runBackupJob } from "./lib/backupJob";
import { seedDefaultWorkflowRules } from "./lib/workflowEngine";
import { closeBrowser } from "./lib/renderPdf";
import { installProcessErrorHandlers } from "./lib/processHandlers";

// Install these before validating startup configuration so module-level
// startup failures are logged as fatal errors rather than disappearing as an
// unhandled top-level throw.
installProcessErrorHandlers();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const intervals: ReturnType<typeof setInterval>[] = [];

export async function validateSchemaOnBoot(): Promise<void> {
  try {
    const report = await getMigrationStatus({ db });
    const message = formatSchemaBootLine(report);
    if (message.startsWith("SCHEMA PENDING:")) {
      logger.warn(message);
      return;
    }
    logger.info(message);
  } catch (error) {
    logger.error({ err: error }, "SCHEMA PENDING: unable to inspect migrations");
  }
}

const migrateOnBoot =
  process.env.NODE_ENV === "production" || process.env.MIGRATE_ON_BOOT === "true";

// Schema reconciliation is deliberately completed before opening the HTTP
// listener. The migration coordinator catches migration failures and records
// them, so a bad migration never prevents the server from coming up.
if (migrateOnBoot) {
  await runSchemaBoot({ pool, logger });
} else {
  await validateSchemaOnBoot();
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.fatal({ err }, "FATAL: Error listening on port; exiting");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Seed default workflow rules (no-op if already seeded)
  seedDefaultWorkflowRules().catch((err) =>
    logger.warn({ err }, "Workflow rules seed error"),
  );

  // Drip email background job — runs every 10 minutes
  const DRIP_INTERVAL_MS = 10 * 60 * 1000;
  runDripJob().catch((err) => logger.error({ err }, "Drip job startup error"));
  const dripInterval = setInterval(() => {
    runDripJob().catch((err) => logger.error({ err }, "Drip job error"));
  }, DRIP_INTERVAL_MS);
  intervals.push(dripInterval);

  // This is intentionally a separate guarded job: it is a no-op unless an
  // administrator enables both round-robin and stale automatic reassignment.
  runStaleLeadAutoReassignment().catch((err) => logger.error({ err }, "Stale lead reassignment startup error"));
  const staleReassignmentInterval = setInterval(() => {
    runStaleLeadAutoReassignment().catch((err) => logger.error({ err }, "Stale lead reassignment error"));
  }, DRIP_INTERVAL_MS);
  intervals.push(staleReassignmentInterval);

  // Task reminder push notifications — checks every hour, fires at 9 AM
  const REMINDER_INTERVAL_MS = 60 * 60 * 1000;
  runTaskReminderJob().catch((err) =>
    logger.error({ err }, "Task reminder startup error"),
  );
  const reminderInterval = setInterval(() => {
    runTaskReminderJob().catch((err) =>
      logger.error({ err }, "Task reminder job error"),
    );
  }, REMINDER_INTERVAL_MS);
  intervals.push(reminderInterval);

  // Renewal radar — flags funded leads ready to re-fund; runs at startup then once daily
  const RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000;
  runRenewalJob().catch((err) =>
    logger.error({ err }, "Renewal job startup error"),
  );
  const renewalInterval = setInterval(() => {
    runRenewalJob().catch((err) => logger.error({ err }, "Renewal job error"));
  }, RENEWAL_INTERVAL_MS);
  intervals.push(renewalInterval);

  // Nightly off-site backup to Backblaze B2 — waits 60s after boot then runs if no backup
  // exists for today, then repeats every 24 hours
  const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const backupBootDelay = setTimeout(() => {
    runBackupJob().catch((err) =>
      logger.error({ err }, "Backup job startup error"),
    );
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
  await closeBrowser().catch((err) =>
    logger.warn({ err }, "Error closing browser during shutdown"),
  );
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => {
    logger.fatal("FATAL: Forced exit after 15s");
    process.exit(1);
  }, 15_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
