export const RECORD_ACTIONS = ["upload", "edit", "call", "text", "email", "note", "task"] as const;
export type RecordAction = typeof RECORD_ACTIONS[number];
export type LeadDetailTab = "info" | "notes" | "tasks" | "documents" | "communications" | "activity" | "lenders" | "marketing" | "application" | "financials" | "credit" | "consent";

export const RECORD_ACTION_MIN_TOUCH_HEIGHT = 44;
export const MOBILE_ACTION_MIN_WIDTH = 48;

export function leadActionTab(action: RecordAction, currentTab: LeadDetailTab): LeadDetailTab {
  if (action === "upload") return "documents";
  if (action === "edit") return currentTab;
  if (action === "call" || action === "text" || action === "email") return "communications";
  if (action === "note") return "notes";
  return "tasks";
}

export function dealActionAvailable(
  action: RecordAction,
  contact: { leadId?: number | null; phone?: string | null; email?: string | null },
): boolean {
  if (action === "edit") return true;
  if (action === "call") return Boolean(contact.phone?.trim());
  if (action === "text") return Boolean(contact.phone?.trim() && contact.leadId);
  if (action === "email") return Boolean(contact.email?.trim());
  return Boolean(contact.leadId);
}