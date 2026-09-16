type ErrorWithDetails = {
  status?: unknown;
  response?: { status?: unknown } | null;
  message?: unknown;
  data?: unknown;
};

function asErrorWithDetails(error: unknown): ErrorWithDetails | null {
  return error !== null && typeof error === "object"
    ? (error as ErrorWithDetails)
    : null;
}

/**
 * Generated API query errors expose the HTTP status directly. The response
 * fallback keeps this useful for fetch-like errors used by other clients.
 */
export function getQueryErrorStatus(error: unknown): number | undefined {
  const details = asErrorWithDetails(error);
  const status = details?.status ?? details?.response?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Prefer the server's reason when available, then fall back to the client
 * error message. This is only rendered to administrators by detail pages.
 */
export function getQueryErrorReason(error: unknown): string | null {
  const details = asErrorWithDetails(error);
  const data = details?.data;

  if (typeof data === "string" && data.trim()) return data.trim();
  if (data !== null && typeof data === "object") {
    for (const key of ["message", "detail", "error", "title"]) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }

  if (typeof details?.message === "string" && details.message.trim()) {
    return details.message.trim();
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return null;
}