import { and, eq, inArray, isNull } from "drizzle-orm";
import { usersTable } from "@workspace/db";

export function eligibleAssignmentCondition(id?: number) {
  return and(
    id === undefined ? undefined : eq(usersTable.id, id),
    eq(usersTable.isActive, true),
    isNull(usersTable.mergedInto),
    inArray(usersTable.role, ["admin", "manager", "rep"]),
  );
}

export function assignmentDisplayName(user: { name?: string | null; email?: string | null }) {
  return user.name?.trim() || user.email?.trim().split("@")[0] || "User";
}
