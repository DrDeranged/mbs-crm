/** Stable public failure codes; never expose an exception/stack in JSON. */
export class LenderPackageError extends Error {
  public readonly reason: string;
  constructor(
    reason: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.reason = reason;
    this.name = "LenderPackageError";
  }
}

export function safeLenderPackageReason(error: unknown): string {
  if (error instanceof LenderPackageError) {
    if (error.reason === "renderer_unavailable" || error.reason === "no_application") return error.reason;
    if (error.reason.startsWith("merge_failed:")) {
      const filename = error.reason.slice("merge_failed:".length)
        .replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 100);
      return `merge_failed:${filename || "document"}`;
    }
  }
  return "package_failed";
}