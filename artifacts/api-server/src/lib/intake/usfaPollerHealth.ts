export type UsfaPollerRunStatus = "never" | "running" | "ok" | "skipped" | "degraded" | "error";

export interface UsfaPollerRunSnapshot {
  lastRanAt: string | null;
  status: UsfaPollerRunStatus;
  itemsProcessed: number;
}

export interface UsfaPollerHealthSnapshot extends UsfaPollerRunSnapshot {
  armed: boolean;
  reason: string | null;
}

export function usfaPollerJobSummary(
  sheet: UsfaPollerHealthSnapshot,
  application: UsfaPollerHealthSnapshot,
): Record<string, UsfaPollerHealthSnapshot> {
  return {
    "usfa-sheet": sheet,
    "usfa-application": application,
  };
}

export function hasUnhealthyArmedUsfaPoller(
  ...pollers: UsfaPollerHealthSnapshot[]
): boolean {
  return pollers.some((poller) => poller.armed && poller.status === "error");
}

export function createUsfaPollerRunTracker(now: () => Date = () => new Date()) {
  let run: UsfaPollerRunSnapshot = {
    lastRanAt: null,
    status: "never",
    itemsProcessed: 0,
  };

  return {
    start() {
      run = { ...run, lastRanAt: now().toISOString(), status: "running" };
    },
    finish(status: Exclude<UsfaPollerRunStatus, "never" | "running" | "error">, itemsProcessed: number) {
      run = {
        ...run,
        status,
        itemsProcessed: Math.max(0, Math.trunc(itemsProcessed)),
      };
    },
    fail() {
      run = { ...run, status: "error" };
    },
    snapshot(armed: boolean, reason: string | null): UsfaPollerHealthSnapshot {
      return { ...run, armed, reason: armed ? null : reason };
    },
  };
}

export function usfaPollerDisarmedReason(
  backgroundJobsDisabled: boolean,
  configurationReason: string | null,
): string | null {
  if (backgroundJobsDisabled) return "Background jobs are disabled by DISABLE_BACKGROUND_JOBS";
  return configurationReason;
}