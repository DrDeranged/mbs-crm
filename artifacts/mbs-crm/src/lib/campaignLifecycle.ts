// Pure lifecycle helpers for campaigns: tabs, steps, recovery state, compare labels, archive rules.

export const LAUNCHED_STATUSES = ["running", "paused", "completed", "cancelled", "failed"] as const;
export const PRE_LAUNCH_STATUSES = ["draft", "approved", "scheduled"] as const;
export const ARCHIVABLE_STATUSES = ["draft", "completed", "cancelled", "failed"] as const;

export const LAUNCH_STEPS = [
  ["content", "Content"],
  ["audience", "Audience"],
  ["review", "Review"],
  ["launch", "Launch"],
] as const;

export const LAUNCHED_TABS = [
  ["results", "Results"],
  ["content", "Content"],
  ["audience", "Audience"],
] as const;

export function isLaunchedStatus(status: string): boolean {
  return (LAUNCHED_STATUSES as readonly string[]).includes(status);
}

export function allowedTabs(status: string): string[] {
  return isLaunchedStatus(status) ? LAUNCHED_TABS.map(([k]) => k) : LAUNCH_STEPS.map(([k]) => k);
}

export function defaultTab(status: string): string {
  if (isLaunchedStatus(status)) return "results";
  return status === "scheduled" ? "launch" : "content";
}

export function resolveTab(status: string, requested: string | null): string {
  return requested && allowedTabs(status).includes(requested) ? requested : defaultTab(status);
}

export function canArchive(c: { status: string; archivedAt?: string | null }): boolean {
  return !c.archivedAt && (ARCHIVABLE_STATUSES as readonly string[]).includes(c.status);
}

export function canUnarchive(c: { archivedAt?: string | null }): boolean {
  return Boolean(c.archivedAt);
}

export function canDeleteCampaign(role: string | undefined, c: { canDelete?: boolean }): boolean {
  return role === "admin" && c.canDelete === true;
}

export function canManageLifecycle(role: string | undefined): boolean {
  return role === "admin";
}

export function canViewRecovery(role: string | undefined): boolean {
  return role === "admin" || role === "manager";
}

export function isCampaignQueryKey(key: readonly unknown[]): boolean {
  return typeof key[0] === "string" && key[0].startsWith("/api/campaigns");
}

export function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function formatSendDate(value: string | null | undefined): string {
  if (!value) return "Not sent";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Not sent";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function compareLabel(c: { name: string; status?: string | null; sendDate?: string | null }): string {
  return [c.name, c.status ? titleCase(c.status) : null, formatSendDate(c.sendDate)].filter(Boolean).join(" \u00b7 ");
}

export type RecoveryLink = { id: number; name: string; status: string };

export function primaryRecovery(recoveries: RecoveryLink[]): RecoveryLink | null {
  if (recoveries.length === 0) return null;
  const live = recoveries.find((r) => !["cancelled", "failed"].includes(r.status));
  return live ?? recoveries[0];
}

export function recoveryLinkedLabel(r: RecoveryLink): string {
  switch (r.status) {
    case "completed": return `Remaining recipients sent via ${r.name}`;
    case "draft":
    case "approved":
    case "scheduled": return `Remaining recipients awaiting send via ${r.name}`;
    case "running": return `Remaining recipients sending now via ${r.name}`;
    case "paused": return `Remaining recipients partially sent via ${r.name} (paused)`;
    case "cancelled": return `Recovery ${r.name} was cancelled; remaining recipients were not fully sent`;
    case "failed": return `Recovery ${r.name} failed; remaining recipients were not fully sent`;
    default: return `Remaining recipients linked to ${r.name}`;
  }
}

export type RecoveryAction =
  | { kind: "none" }
  | { kind: "linked"; label: string; campaignId: number }
  | { kind: "create" };

export function recoveryAction(
  role: string | undefined,
  recovery: { eligibleRemaining: number; recoveries: RecoveryLink[] } | undefined,
): RecoveryAction {
  if (!canViewRecovery(role) || !recovery) return { kind: "none" };
  const primary = primaryRecovery(recovery.recoveries);
  if (primary) return { kind: "linked", label: recoveryLinkedLabel(primary), campaignId: primary.id };
  if (role === "admin" && recovery.eligibleRemaining > 0) return { kind: "create" };
  return { kind: "none" };
}

export function shouldPollRecovery(recovery: { pendingViaRecovery: number; recoveries: RecoveryLink[] } | undefined): boolean {
  if (!recovery) return false;
  return recovery.pendingViaRecovery > 0 ||
    recovery.recoveries.some((r) => ["draft", "approved", "scheduled", "running", "paused"].includes(r.status));
}

export function cancelledSummary(r: {
  notSentHere: number; sentViaRecovery: number; pendingViaRecovery: number;
  exclusions: { reason: string; count: number }[];
}): { headline: string; pending: string | null } {
  const excluded = r.exclusions.reduce((n, e) => n + e.count, 0);
  const reasons = r.exclusions.map((e) => `${humanReason(e.reason)} (${e.count})`).join(", ");
  const parts = [`${r.sentViaRecovery} sent via linked recovery`, `${excluded} excluded${reasons ? `: ${reasons}` : ""}`];
  return {
    headline: `${r.notSentHere} not sent here \u2014 ${parts.join(", ")}`,
    pending: r.pendingViaRecovery > 0 ? `${r.pendingViaRecovery} still pending in the linked recovery campaign` : null,
  };
}

export function humanReason(reason: string): string {
  if (!reason) return "Other";
  if (/[\s]/.test(reason)) return reason;
  const t = reason.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
