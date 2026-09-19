import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { errorLogTable, jobRunsTable } from "@workspace/db";
import { desc, gte, eq } from "drizzle-orm";
import { count } from "drizzle-orm";
import { z } from "zod/v4";
import { requireUser } from "../lib/authHelpers";

const router: IRouter = Router();
export const errorsQuery = z.object({ page: z.coerce.number().int().positive().optional() }).strict();

router.get("/admin/errors", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const query = errorsQuery.safeParse(req.query);
  if (!query.success) {
    return void res.status(400).json({ error: `Invalid ${query.error.issues[0]?.path.join(".") || "query"}` });
  }
  const page = query.data.page ?? 1;
  const limit = 25;
  const offset = (page - 1) * limit;

  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [errors, [count24h], [count7d]] = await Promise.all([
    db
      .select()
      .from(errorLogTable)
      .orderBy(desc(errorLogTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(errorLogTable)
      .where(gte(errorLogTable.createdAt, last24h)),
    db
      .select({ value: count() })
      .from(errorLogTable)
      .where(gte(errorLogTable.createdAt, last7d)),
  ]);

  // Last run per job
  const jobNames = ["drip", "task-reminder", "renewal"];
  const jobRows = await Promise.all(
    jobNames.map((name) =>
      db
        .select()
        .from(jobRunsTable)
        .where(eq(jobRunsTable.jobName, name))
        .orderBy(desc(jobRunsTable.startedAt))
        .limit(1),
    ),
  );

  const jobs = jobNames.reduce(
    (acc, name, i) => {
      const run = jobRows[i][0];
      acc[name] = run
        ? {
            jobName: run.jobName,
            startedAt: run.startedAt.toISOString(),
            finishedAt: run.finishedAt?.toISOString() ?? null,
            status: run.status,
            itemsProcessed: run.itemsProcessed ?? 0,
            errorMessage: run.errorMessage ?? null,
          }
        : null;
      return acc;
    },
    {} as Record<string, object | null>,
  );

  res.json({
    errors: errors.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })),
    pagination: { page, limit },
    summary: {
      last24h: Number(count24h.value),
      last7d: Number(count7d.value),
    },
    jobs,
  });
});

export default router;
