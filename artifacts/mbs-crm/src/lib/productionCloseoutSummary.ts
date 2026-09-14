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
        `${numberValue(details, "changed")} changed`,
        `${numberValue(details, "ordinaryChanged")} ordinary changed`,
        `${numberValue(details, "ordinaryAtNate")} at Nate Ford`,
        `${numberValue(details, "calvinCleared")} Calvin cleared`,
        `${numberValue(details, "calvinReservedUnassigned")} Calvin unassigned`,
        `${numberValue(details, "arslanTotalDeals")} Arslan deals`,
      ].join(" · ");
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
      const createdNames = Array.isArray(details.createdNames) ? details.createdNames.map(String).join(", ") : "none";
      const unchangedNames = Array.isArray(details.unchangedNames) ? details.unchangedNames.map(String).join(", ") : "none";
      summary = `${numberValue(details, "created")} created (${createdNames}) · ${numberValue(details, "unchanged")} unchanged (${unchangedNames})`;
    }
    return [{ ...result, label: operation, summary }];
  });
}