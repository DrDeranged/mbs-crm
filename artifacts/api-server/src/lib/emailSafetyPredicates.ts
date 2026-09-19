export const EMAIL_STATUS_RANK: Record<string, number> = {
  queued: 0,
  failed: 1,
  sent: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
  bounced: 100,
  unsubscribed: 100,
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function canAdvanceEmailStatus(current: string, next: string): boolean {
  if (current === next) return true;
  if (current === "bounced" || current === "unsubscribed" || current === "failed") return false;
  return (EMAIL_STATUS_RANK[next] ?? 0) > (EMAIL_STATUS_RANK[current] ?? 0);
}

export function classifySendGridEvent(event: string): {
  status: "delivered" | "opened" | "clicked" | "bounced" | "unsubscribed" | null;
  action: string | null;
  suppress: boolean;
} {
  switch (event) {
    case "delivered": return { status: "delivered", action: "email_delivered", suppress: false };
    case "open": return { status: "opened", action: "email_opened", suppress: false };
    case "click": return { status: "clicked", action: "email_clicked", suppress: false };
    case "bounce":
    case "blocked":
    case "dropped": return { status: "bounced", action: "email_bounced", suppress: true };
    case "spamreport": return { status: "unsubscribed", action: "email_spam_reported", suppress: true };
    case "complaint": return { status: "unsubscribed", action: "email_complaint", suppress: true };
    case "group_unsubscribe":
    case "unsubscribe": return { status: "unsubscribed", action: "email_unsubscribed", suppress: true };
    default: return { status: null, action: null, suppress: false };
  }
}