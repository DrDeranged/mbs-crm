/** Only administrators see safe server reason codes, never raw response errors. */
export function lenderPackageFailureTitle(role: string | undefined, reason: unknown): string {
  const generic = "Lender package failed";
  if (role !== "admin" || typeof reason !== "string") return generic;
  switch (reason) {
    case "renderer_unavailable": return `${generic} — renderer unavailable`;
    case "no_application": return `${generic} — no submitted application`;
    case "package_failed": return generic;
    default: {
      if (reason.startsWith("merge_failed:")) {
        const filename = reason.slice("merge_failed:".length).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 100);
        return `${generic} — could not merge ${filename || "document"}`;
      }
      return generic;
    }
  }
}