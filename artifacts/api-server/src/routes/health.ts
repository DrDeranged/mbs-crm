import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { jobRunsTable, emailSendsTable, emailWebhookEventsTable } from "@workspace/db";
import { getMigrationStatus } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getPdfHealth } from "../lib/pdfHealth";
import { getIntegrationHealth } from "../lib/integrationHealth";
import { getBootSchemaFailure } from "../lib/schemaBoot";

const router: IRouter = Router();

router.get("/", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health/deep", async (_req, res) => {
  // 1. DB connectivity
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    // DB unreachable
  }

  let schema: {
    applied: number;
    pending: string[];
    failed: ReturnType<typeof getBootSchemaFailure>;
  } = { applied: 0, pending: [], failed: getBootSchemaFailure() };
  if (dbOk) {
    try {
      const migrationStatus = await getMigrationStatus({ db });
      schema = {
        applied: migrationStatus.migrations.filter((migration) => migration.status === "applied").length,
        pending: [
          ...migrationStatus.pending,
          ...migrationStatus.mismatches.map(({ name }) => `${name} (checksum mismatch)`),
        ],
        failed: migrationStatus.failed ?? getBootSchemaFailure(),
      };
    } catch {
      schema = {
        applied: 0,
        pending: ["unable to inspect migrations"],
        failed: getBootSchemaFailure(),
      };
    }
  } else {
    schema = {
      applied: 0,
      pending: ["database unavailable"],
      failed: getBootSchemaFailure(),
    };
  }

  // 2. Integration presence (booleans only, no secret values)
  const detailedIntegrations = await getIntegrationHealth() as {
    twilio: object;
    sendgrid: object;
  };
  let sendgridDelivery: {
    configured: boolean;
    fromEmail: string;
    lastWebhookAt: string | null;
    lastSendAt: string | null;
    tracking: "custom";
  } = {
    configured: !!process.env["SENDGRID_API_KEY"],
    fromEmail: "funding@my-business-solutions.com",
    lastWebhookAt: null,
    lastSendAt: null,
    tracking: "custom",
  };
  if (dbOk) {
    try {
      const [webhooks, sends] = await Promise.all([
        db.select({ receivedAt: emailWebhookEventsTable.receivedAt })
          .from(emailWebhookEventsTable)
          .orderBy(desc(emailWebhookEventsTable.receivedAt))
          .limit(1),
        db.select({ sentAt: emailSendsTable.sentAt })
          .from(emailSendsTable)
          .where(sql`${emailSendsTable.sentAt} IS NOT NULL`)
          .orderBy(desc(emailSendsTable.sentAt))
          .limit(1),
      ]);
      sendgridDelivery = {
        ...sendgridDelivery,
        lastWebhookAt: webhooks[0]?.receivedAt?.toISOString() ?? null,
        lastSendAt: sends[0]?.sentAt?.toISOString() ?? null,
      };
    } catch {
      // Older schema may not yet have email delivery ledgers; retain safe nulls.
    }
  }
  const integrations = {
    ...detailedIntegrations,
    sendgrid: sendgridDelivery,
    experian: !!(process.env.EXPERIAN_CLIENT_ID || process.env.EXPERIAN_CLIENT_SECRET),
    anthropic: !!(
      process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_API_KEY
    ),
  };

  // 3. Last job run per job
  let jobSummary: Record<string, object> = {};
  try {
    const jobNames = ["drip", "task-reminder", "renewal"];
    const rows = await Promise.all(
      jobNames.map((name) =>
        db
          .select()
          .from(jobRunsTable)
          .where(eq(jobRunsTable.jobName, name))
          .orderBy(desc(jobRunsTable.startedAt))
          .limit(1),
      ),
    );
    jobNames.forEach((name, i) => {
      const run = rows[i][0];
      jobSummary[name] = run
        ? {
            lastRanAt: run.finishedAt?.toISOString() ?? run.startedAt.toISOString(),
            status: run.status,
            itemsProcessed: run.itemsProcessed ?? 0,
          }
        : { lastRanAt: null, status: "never" };
    });
  } catch {
    // job_runs table may not exist yet — safe to skip
  }

  res.json({
    status: dbOk && schema.pending.length === 0 && !schema.failed ? "ok" : "degraded",
    db: dbOk ? "ok" : "fail",
    schema,
    integrations,
    pdf: await getPdfHealth(),
    jobs: jobSummary,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export default router;
