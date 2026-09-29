export function getQueueBlockReason(
  ownerUserId: string | undefined,
  currentUserId: string,
): "legacy_unowned" | "different_user" | null;

export function buildReplayAuthorization(token: string | null | undefined): string | null;

export function bindQueueMutationToOwner<T>(
  mutation: T,
  ownerUserId: string,
): T & { ownerUserId: string };