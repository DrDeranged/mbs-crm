export function isLeadStale(
  assignedRepId: number | null,
  idleSince: Date,
  staleThresholdDays: number,
  now = Date.now(),
) {
  return assignedRepId != null
    && idleSince.getTime() < now - staleThresholdDays * 24 * 60 * 60 * 1000;
}