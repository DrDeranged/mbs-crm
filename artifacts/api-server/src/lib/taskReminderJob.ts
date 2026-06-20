import { and, eq, gte, isNotNull, lte, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { tasksTable, usersTable } from "@workspace/db";
import { sendPushNotification } from "./pushNotifications";
import { logger } from "./logger";

export async function runTaskReminderJob(): Promise<void> {
  const now = new Date();
  if (now.getHours() !== 9) return;

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStartStr = todayStart.toISOString().slice(0, 10);
  const todayEndStr = todayStartStr;

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

    logger.info({ usersNotified: byUser.size }, "Task reminder job completed");
  } catch (err) {
    logger.error({ err }, "Task reminder job failed");
  }
}
