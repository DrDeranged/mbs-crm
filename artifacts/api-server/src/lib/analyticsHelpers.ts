import { and, eq, exists, or } from "drizzle-orm";
import { db, dealsTable, leadsTable, usersTable } from "@workspace/db";

export function normalizeFundingTimeDays(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return Math.max(0, Math.round(value));
}

/**
 * Keep analytics rep listings limited to active users who are reps or have
 * historical CRM ownership. These are core-query subqueries rather than a
 * relational `where` callback so the users-table reference remains correlated
 * correctly and is not rewritten as a relation alias.
 */
export function activeRepListingCondition(database: Pick<typeof db, "select"> = db) {
  return and(
    eq(usersTable.isActive, true),
    or(
      eq(usersTable.role, "rep"),
      exists(
        database
          .select({ id: leadsTable.id })
          .from(leadsTable)
          .where(eq(leadsTable.assignedRepId, usersTable.id)),
      ),
      exists(
        database
          .select({ id: dealsTable.id })
          .from(dealsTable)
          .where(eq(dealsTable.assignedTo, usersTable.id)),
      ),
    ),
  );
}