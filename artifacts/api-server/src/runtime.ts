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
import { startUsfaPoller } from "./lib/intake/usfaPoller";
import { startUsfaApplicationPoller } from "./lib/intake/usfaApplicationPoller";

installProcessErrorHandlers();

const intervals: ReturnType<typeof setInterval>[] = [];
const timeouts: ReturnType<typeof setTimeout>[] = [];

async function validateSchemaOnBoot(): Promise<void> {
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

async function initializeSchema(): Promise<void> {
  const migrateOnBoot =
    process.env.MIGRATE_ON_BOOT === "true"
    || (process.env.NODE_ENV === "production" && process.env.MIGRATE_ON_BOOT !== "false");

  if (migrateOnBoot) {
    await runSchemaBoot({ pool, logger });
  } else {
    await validateSchemaOnBoot();
  }
}

function startBackgroundJobs(): void {
  if (process.env.DISABLE_BACKGROUND_JOBS === "true") {
    logger.info("Background jobs disabled by DISABLE_BACKGROUND_JOBS");
    return;
  }

  seedDefaultWorkflowRules().catch((err) =>
    logger.warn({ err }, "Workflow rules seed error"),
  );

  const dripIntervalMs = 10 * 60 * 1000;
  runDripJob().catch((err) => logger.error({ err }, "Drip job startup error"));
  intervals.push(setInterval(() => {
    runDripJob().catch((err) => logger.error({ err }, "Drip job error"));
  }, dripIntervalMs));

  runStaleLeadAutoReassignment().catch((err) =>
    logger.error({ err }, "Stale lead reassignment startup error"),
  );
  intervals.push(setInterval(() => {
    runStaleLeadAutoReassignment().catch((err) =>
      logger.error({ err }, "Stale lead reassignment error"),
    );
  }, dripIntervalMs));

  const reminderIntervalMs = 60 * 60 * 1000;
  runTaskReminderJob().catch((err) =>
    logger.error({ err }, "Task reminder startup error"),
  );
  intervals.push(setInterval(() => {
    runTaskReminderJob().catch((err) =>
      logger.error({ err }, "Task reminder job error"),
    );
  }, reminderIntervalMs));
  intervals.push(startUsfaPoller());
  intervals.push(startUsfaApplicationPoller());

  const renewalIntervalMs = 24 * 60 * 60 * 1000;
  runRenewalJob().catch((err) =>
    logger.error({ err }, "Renewal job startup error"),
  );
  intervals.push(setInterval(() => {
    runRenewalJob().catch((err) => logger.error({ err }, "Renewal job error"));
  }, renewalIntervalMs));

  const backupIntervalMs = 24 * 60 * 60 * 1000;
  timeouts.push(setTimeout(() => {
    runBackupJob().catch((err) =>
      logger.error({ err }, "Backup job startup error"),
    );
  }, 60_000));
  intervals.push(setInterval(() => {
    runBackupJob().catch((err) => logger.error({ err }, "Backup job error"));
  }, backupIntervalMs));
}

export async function initializeRuntime(): Promise<{
  listener: typeof app;
  stopBackgroundJobs: () => void;
  dispose: () => Promise<void>;
}> {
  await initializeSchema();
  startBackgroundJobs();

  return {
    listener: app,
    stopBackgroundJobs: () => {
      intervals.forEach(clearInterval);
      timeouts.forEach(clearTimeout);
    },
    dispose: async () => {
      await closeBrowser().catch((err) =>
        logger.warn({ err }, "Error closing browser during shutdown"),
      );
    },
  };
}