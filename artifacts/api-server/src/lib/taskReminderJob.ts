import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { tasksTable, usersTable, jobRunsTable } from "@workspace/db";
import { sendPushNotification } from "./pushNotifications";
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
        pushToken: usersTable.pushToken,
      })
      .from(tasksTable)
      .innerJoin(usersTable, eq(tasksTable.userId, usersTable.id))
      .where(
        and(
          isNotNull(tasksTable.dueDate),
          eq(tasksTable.dueDate, todayStartStr),
          isNull(tasksTable.completedAt),
          isNotNull(usersTable.pushToken),
        ),
      );

    const byUser = new Map<number, { pushToken: string; count: number }>();
    for (const row of tasksDueToday) {
      if (!row.pushToken) continue;
      const existing = byUser.get(row.userId);
      if (existing) {
        existing.count++;
      } else {
        byUser.set(row.userId, { pushToken: row.pushToken, count: 1 });
      }
    }

    for (const [, { pushToken, count }] of byUser) {
      await sendPushNotification(
        pushToken,
        "Tasks Due Today",
        `You have ${count} task${count !== 1 ? "s" : ""} due today`,
        { type: "task_reminder" },
      );
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
