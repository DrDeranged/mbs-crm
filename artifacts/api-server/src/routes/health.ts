import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { jobRunsTable, emailSendsTable, emailWebhookEventsTable, companySettingsTable, usersTable } from "@workspace/db";
import { getMigrationStatus } from "@workspace/db";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getPdfHealth } from "../lib/pdfHealth";
import { getIntegrationHealth, getTwilioTelephonyHealth } from "../lib/integrationHealth";
import { getClerkHealth } from "../lib/clerkHealth";
import { getBootSchemaFailure } from "../lib/schemaBoot";
import { buildRevision } from "../lib/buildRevision";
import { isWithinVoiceHours } from "../lib/inboundVoice";
import { resolveGreetingAudioUrl } from "../lib/telephonyGreeting";
import { isValidE164 } from "../lib/telephonySettings";

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
        failed: getBootSchemaFailure(),
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
  const [detailedIntegrations, clerk, twilioTelephony] = await Promise.all([
    getIntegrationHealth(),
    getClerkHealth(),
    getTwilioTelephonyHealth(),
  ]) as [{
    twilio: object;
    sendgrid: object;
  }, Awaited<ReturnType<typeof getClerkHealth>>, Awaited<ReturnType<typeof getTwilioTelephonyHealth>>];
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
    twilioTelephony,
    clerk,
    sendgrid: sendgridDelivery,
    experian: !!(process.env.EXPERIAN_CLIENT_ID || process.env.EXPERIAN_CLIENT_SECRET),
    anthropic: !!(
      process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_API_KEY
    ),
  };

  let telephony: {
    routingMode: string;
    businessHoursStatus: "open" | "closed";
    greetingSource: "tts" | "audio";
    forwardingNumberCount: number;
  } | null = null;
  if (dbOk) {
    try {
      const [settings, forwarding] = await Promise.all([
        db.select().from(companySettingsTable).limit(1),
        db.select({ number: usersTable.forwardingNumber, role: usersTable.role }).from(usersTable)
          .where(and(eq(usersTable.isActive, true), isNull(usersTable.mergedInto), isNotNull(usersTable.forwardingNumber))),
      ]);
      const current = settings[0];
      const open = current ? isWithinVoiceHours(current) : false;
      const audioPath = open ? current?.voiceGreetingAudioPath : current?.voiceAfterHoursGreetingAudioPath;
      telephony = {
        routingMode: current?.voiceRoutingMode ?? "assigned-rep-first",
        businessHoursStatus: open ? "open" : "closed",
        greetingSource: await resolveGreetingAudioUrl(audioPath) ? "audio" : "tts",
        forwardingNumberCount: forwarding.filter((rep) =>
          ["rep", "manager", "admin"].includes(rep.role) && Boolean(rep.number && isValidE164(rep.number))).length,
      };
    } catch {
      // Health inspection must remain available if telephony tables are pending migration.
    }
  }

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

  const healthy = dbOk &&
    schema.pending.length === 0 &&
    !schema.failed;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    revision: buildRevision,
    db: dbOk ? "ok" : "fail",
    schema,
    integrations,
    telephony,
    pdf: await getPdfHealth(),
    jobs: jobSummary,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export default router;
