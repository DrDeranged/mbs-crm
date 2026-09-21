export type MergeUser = {
  id: number;
  role: "admin" | "manager" | "rep" | "pending";
  isActive: boolean;
  slug: string | null;
};

export const MERGE_USER_REFERENCE_COLUMNS = [
  ["leads", "assigned_rep_id"],
  ["deals", "assigned_to"],
  ["notes", "user_id"],
  ["tasks", "user_id"],
  ["documents", "user_id"],
  ["activity_log", "user_id"],
  ["lender_submissions", "sent_by"],
  ["lender_submission_deliveries", "sent_by"],
  ["collateral_renders", "user_id"],
  ["lead_status_history", "changed_by_user_id"],
  ["lead_assignment_history", "changed_by_user_id"],
  ["lead_assignment_history", "from_rep_id"],
  ["lead_assignment_history", "to_rep_id"],
] as const;

export type MergeUserReference = (typeof MERGE_USER_REFERENCE_COLUMNS)[number];

export function resolveIdentityUserId(
  clerkId: string,
  identities: ReadonlyArray<{ userId: number; clerkId: string }>,
  users: ReadonlyArray<{ id: number; clerkId: string }>,
): number | null {
  return identities.find((identity) => identity.clerkId === clerkId)?.userId
    ?? users.find((user) => user.clerkId === clerkId)?.id
    ?? null;
}

export function reservedIdentityOwnerId(
  email: string,
  reservedSlugs: Readonly<Record<string, string>>,
  users: ReadonlyArray<{ id: number; slug: string | null; isActive: boolean }>,
): number | null {
  const slug = reservedSlugs[email.trim().toLowerCase()];
  if (!slug) return null;
  return users.find((user) => user.isActive && user.slug === slug)?.id ?? null;
}

export function validateMergeUsers(source: MergeUser, target: MergeUser): void {
  if (source.id === target.id) throw new Error("Source and target must differ");
  if (source.role !== "pending") throw new Error("Source user must have the pending role");
  if (!source.isActive) throw new Error("Source user is already inactive");
  if (!target.isActive) throw new Error("Target user must be active");
  if (target.role === "pending") throw new Error("Target user must not have the pending role");
}

export function mergeRequiresConfirmation(counts: Readonly<Record<string, number>>): boolean {
  return Object.values(counts).some((count) => count > 0);
}

/**
 * Applies the same source→target column policy used by the SQL merge route to
 * an in-memory fixture. Keeping this policy pure makes the destructive scope
 * reviewable and regression-testable without a production database.
 */
export function mergeUserReferences<T extends Record<string, unknown>>(
  rows: ReadonlyArray<T>,
  table: string,
  column: string,
  sourceId: number,
  targetId: number,
): T[] {
  return rows.map((row) => row[column] === sourceId ? { ...row, [column]: targetId } : { ...row });
}

export function retireMergedSlug(
  sourceSlug: string | null,
  targetSlug: string | null,
): { sourceSlug: null; retiredSlug: string | null; replacementSlug: string | null } {
  if (!sourceSlug) return { sourceSlug: null, retiredSlug: null, replacementSlug: targetSlug };
  if (!targetSlug) throw new Error("Target must have a slug before a slotted user can be merged");
  return { sourceSlug: null, retiredSlug: sourceSlug, replacementSlug: targetSlug };
}