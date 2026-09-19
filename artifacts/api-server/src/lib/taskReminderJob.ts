import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { tasksTable, jobRunsTable } from "@workspace/db";
import { createNotification } from "./notify";
import { captureException } from "./sentry";
import { logger } from "./logger";

let running: boolean | undefined;

export async function runTaskReminderJob(): Promise<void> {
  const now = new Date();
  if (now.getHours() !== 9) return; // Not the right hour — no-op, no job run logged

  if (running) {
    logger.warn("Task reminder job already running, skipping overlapping run");
    return;
  }
  running = true;

  const startedAt = new Date();
  let status: "success" | "error" = "success";
  let itemsProcessed = 0;
  let errorMessage: string | undefined;

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStartStr = todayStart.toISOString().slice(0, 10);

  try {
    const tasksDueToday = await db
      .select({
        userId: tasksTable.userId,
        count: tasksTable.id,
      })
      .from(tasksTable)
      .where(
        and(
          isNotNull(tasksTable.dueDate),
          eq(tasksTable.dueDate, todayStartStr),
          isNull(tasksTable.completedAt),
        ),
      );

    const byUser = new Map<number, number>();
    for (const row of tasksDueToday) {
      if (row.userId == null) continue;
      byUser.set(row.userId, (byUser.get(row.userId) ?? 0) + 1);
    }

    for (const [userId, count] of byUser) {
      await createNotification({
        userId,
        type: "task_due",
        title: "Tasks Due Today",
        body: `You have ${count} task${count !== 1 ? "s" : ""} due today`,
        event: "task_due",
      });
    }

    itemsProcessed = byUser.size;
    logger.info({ usersNotified: byUser.size }, "Task reminder job completed");
  } catch (err) {
    status = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Task reminder job failed");
    captureException(err, { job: "task-reminder" });
  } finally {
    running = false;
    db.insert(jobRunsTable)
      .values({
        jobName: "task-reminder",
        startedAt,
        finishedAt: new Date(),
        status,
        itemsProcessed,
        errorMessage: errorMessage ?? null,
      })
      .catch((dbErr: unknown) => {
        logger.error({ err: dbErr }, "Failed to write task-reminder job run");
      });
  }
}
