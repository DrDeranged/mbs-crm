import { getQueryErrorReason, getQueryErrorStatus } from "./query-error.ts";

function getStatusText(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const statusText = (error as { statusText?: unknown }).statusText;
  return typeof statusText === "string" && statusText.trim() ? statusText.trim() : null;
}

/**
 * Formats notification list failures without leaking response diagnostics to
 * non-admin users. Administrators may see the server's structured reason.
 */
export function getNotificationLoadError(error: unknown, isAdmin: boolean): string {
  const status = getQueryErrorStatus(error);
  if (status === undefined) return "Unable to load notifications.";

  const rawReason = isAdmin
    ? getQueryErrorReason(error) ?? getStatusText(error) ?? "Request failed"
    : getStatusText(error) ?? "Request failed";
  const reason = rawReason.replace(new RegExp(`^HTTP ${status}\\s*[^:]*:\\s*`, "i"), "").trim() || "Request failed";

  return `HTTP ${status}: ${reason}`;
}