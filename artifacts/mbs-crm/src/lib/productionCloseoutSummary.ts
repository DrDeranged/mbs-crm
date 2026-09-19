export type ProductionCloseoutSummaryResult = {
  operation: "ownership" | "slugs" | "templates" | "lenders";
  status: "succeeded" | "failed" | "skipped";
  details?: unknown;
};

export type ProductionCloseoutSummaryLine = ProductionCloseoutSummaryResult & {
  label: string;
  summary: string;
};

const OPERATION_ORDER: ProductionCloseoutSummaryResult["operation"][] = [
  "ownership",
  "slugs",
  "templates",
  "lenders",
];

function numberValue(details: Record<string, unknown>, key: string) {
  return typeof details[key] === "number" ? details[key] : 0;
}

function detailsRecord(details: unknown): Record<string, unknown> {
  return details && typeof details === "object" ? details as Record<string, unknown> : {};
}

function namesValue(details: Record<string, unknown>, key: string): string {
  return Array.isArray(details[key]) && details[key].length > 0
    ? details[key].map(String).join(", ")
    : "none";
}

/**
 * Keep the manual lender fallback and the ordered closeout on the same
 * status/count/name wording. Missing Section B targets are deliberately
 * reported separately rather than being counted as unchanged.
 */
export function formatLenderSeedSummary(details: unknown): string {
  const record = detailsRecord(details);
  const missingNames = Array.isArray(record.missingUpdateNames)
    ? record.missingUpdateNames
    : Array.isArray(record.missingNames)
      ? record.missingNames
      : record.missingExistingNames;
  const missing = Array.isArray(missingNames) && missingNames.length > 0
    ? ` · missing: ${missingNames.map(String).join(", ")}`
    : "";
  return [
    `created ${numberValue(record, "created")}`,
    `updated ${numberValue(record, "updated")}`,
    `unchanged ${numberValue(record, "unchanged")}`,
  ].join(" / ") + [
    ` · created: ${namesValue(record, "createdNames")}`,
    ` · updated: ${namesValue(record, "updatedNames")}`,
    ` · unchanged: ${namesValue(record, "unchangedNames")}`,
    missing,
  ].join("");
}

export function formatLenderSeedError(error: unknown): string {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message
    : "Unable to seed or update lenders.";
}

export function formatProductionCloseoutResults(
  results: readonly ProductionCloseoutSummaryResult[],
): ProductionCloseoutSummaryLine[] {
  const byOperation = new Map(results.map((result) => [result.operation, result]));
  return OPERATION_ORDER.flatMap((operation) => {
    const result = byOperation.get(operation);
    if (!result) return [];
    const details = detailsRecord(result.details);
    let summary = "";
    if (result.status === "failed") {
      summary = `Error: ${typeof details.error === "string" ? details.error : "Operation failed"}`;
    } else if (result.status === "skipped") {
      summary = `Skipped: ${typeof details.reason === "string" ? details.reason : "Operation was not run"}`;
    } else if (operation === "ownership") {
      summary = [
        typeof details.seededRowsSummary === "string" ? details.seededRowsSummary : null,
        `${numberValue(details, "changed")} changed`,
        `${numberValue(details, "ordinaryChanged")} ordinary changed`,
        `${numberValue(details, "ordinaryAtNate")} at Nate Ford`,
        `${numberValue(details, "calvinCleared")} Calvin cleared`,
        `${numberValue(details, "calvinReservedUnassigned")} Calvin unassigned`,
        `${numberValue(details, "arslanTotalDeals")} Arslan deals`,
      ].filter(Boolean).join(" · ");
    } else if (operation === "slugs") {
      const users = Array.isArray(details.users) ? details.users : [];
      const targets = users
        .filter((user): user is Record<string, unknown> => Boolean(user && typeof user === "object"))
        .map((user) => `${String(user.userId)} → ${String(user.slug)}`)
        .join(", ");
      summary = `${numberValue(details, "changed")} changed · ${numberValue(details, "unchanged")} unchanged · targets: ${targets || "none"}`;
    } else if (operation === "templates") {
      summary = `${numberValue(details, "templatesCreated")} created · ${numberValue(details, "skippedTemplates")} skipped · nurture sequence ${details.sequenceCreated === true ? "created" : "already present"}`;
    } else {
      summary = formatLenderSeedSummary(details);
    }
    return [{ ...result, label: operation, summary }];
  });
}