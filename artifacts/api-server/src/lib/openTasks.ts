import { and, asc, eq, gt, lt } from "drizzle-orm";
import { db, tasksTable } from "@workspace/db";
import { companyDate } from "./companyCalendar";

export type TaskFilter = "all" | "overdue" | "today" | "upcoming";

/** One visibility/date policy for the dashboard and the full task list. */
export async function openTasks(
  database: typeof db,
  actor: { id: number; role: string },
  filter: TaskFilter,
  now = new Date(),
) {
  const today = companyDate(now);
  const dateCondition = filter === "overdue" ? lt(tasksTable.dueDate, today)
    : filter === "today" ? eq(tasksTable.dueDate, today)
    : filter === "upcoming" ? gt(tasksTable.dueDate, today) : undefined;
  const rows = await database.query.tasksTable.findMany({
    where: and(eq(tasksTable.isCompleted, false), dateCondition),
    orderBy: [asc(tasksTable.dueDate), asc(tasksTable.id)],
    with: {
      assignedUser: true,
      lead: {
        columns: { id: true, firstName: true, lastName: true, companyName: true, assignedRepId: true },
        with: { company: { columns: { name: true } } },
      },
    },
  });
  return actor.role === "rep" ? rows.filter(row => row.lead?.assignedRepId === actor.id) : rows;
}
