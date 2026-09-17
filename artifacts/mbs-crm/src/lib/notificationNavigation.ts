export function notificationTarget(leadId: number | null | undefined): string | null {
  return leadId ? `/leads/${leadId}` : null;
}