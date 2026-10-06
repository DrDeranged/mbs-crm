import { getUserDisplayName } from "./utils.ts";

export function assignmentOptions<T extends {
  id: number; role: string; isActive?: boolean; mergedInto?: number | null;
  name?: string | null; email?: string | null;
}>(users: readonly T[] = []): T[] {
  return users.filter(user => user.isActive && user.mergedInto == null &&
    ["admin", "manager", "rep"].includes(user.role))
    .sort((a, b) => getUserDisplayName(a).localeCompare(getUserDisplayName(b)) || a.id - b.id);
}
