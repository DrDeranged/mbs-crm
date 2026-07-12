import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { jobRunsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router: IRouter = Router();

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

  // 2. Integration presence (booleans only, no secret values)
  const integrations = {
    twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    sendgrid: !!process.env.SENDGRID_API_KEY,
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
    status: dbOk ? "ok" : "degraded",
    db: dbOk ? "ok" : "fail",
    integrations,
    jobs: jobSummary,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export default router;
