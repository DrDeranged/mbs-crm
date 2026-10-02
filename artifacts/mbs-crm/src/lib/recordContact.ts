export type PhoneAction = "softphone" | "tel";

export function isMobileWeb(signals: { userAgent?: string; viewportWidth?: number; pointerCoarse?: boolean } = {}): boolean {
  const { userAgent = "", viewportWidth = 1024, pointerCoarse = false } = signals;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || viewportWidth <= 767 || pointerCoarse;
}

export function softphoneReadyForAction(deviceRegistered: boolean, callState: string): boolean {
  return deviceRegistered && callState === "idle";
}

export function phoneActionForDevice(isMobileWeb: boolean, softphoneAvailable: boolean): PhoneAction {
  return !isMobileWeb && softphoneAvailable ? "softphone" : "tel";
}

export function emailActionTarget(email: string, leadId?: number | null, composerAvailable = true): { kind: "composer"; href: string } | { kind: "mailto"; href: string } {
  if (composerAvailable && leadId && leadId > 0) {
    return { kind: "composer", href: `/leads/${leadId}?compose=email` };
  }
  return { kind: "mailto", href: `mailto:${email}` };
}