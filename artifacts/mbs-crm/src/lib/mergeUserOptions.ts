export type MergeUserOption = {
  id: number;
  role: "admin" | "manager" | "rep" | "pending";
  isActive?: boolean;
};

export function getEligibleMergeSources<T extends MergeUserOption>(
  users: readonly T[] | undefined,
): T[] {
  return (users ?? []).filter((user) => user.role === "pending" && user.isActive === true);
}

export function getEligibleMergeTargets<T extends MergeUserOption>(
  users: readonly T[] | undefined,
): T[] {
  return (users ?? []).filter((user) => user.role !== "pending" && user.isActive === true);
}

export type MergeSourceState = "loading" | "error" | "empty" | "ready";

export function getMergeSourceState({
  isLoading,
  isError,
  sourceCount,
}: {
  isLoading: boolean;
  isError: boolean;
  sourceCount: number;
}): MergeSourceState {
  if (isLoading) return "loading";
  if (isError) return "error";
  return sourceCount > 0 ? "ready" : "empty";
}

export function canSubmitUserMerge(
  sourceId: string,
  targetId: string,
  users: readonly MergeUserOption[] | undefined,
): boolean {
  const source = getEligibleMergeSources(users).find((user) => String(user.id) === sourceId);
  const target = getEligibleMergeTargets(users).find((user) => String(user.id) === targetId);
  return Boolean(source && target && source.id !== target.id);
}