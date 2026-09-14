export type ProductionCloseoutOperation = "ownership" | "slugs" | "templates" | "lenders";
export type ProductionCloseoutResult = {
  operation: ProductionCloseoutOperation;
  status: "succeeded" | "failed" | "skipped";
  details?: unknown;
};

/**
 * Runs each independently transactional operation in the prescribed order.
 * Deliberately accepts callbacks so this orchestration layer never owns or
 * claims a cross-operation transaction.
 */
export async function runProductionCloseout(
  operations: Record<ProductionCloseoutOperation, () => Promise<unknown>>,
) {
  const results: ProductionCloseoutResult[] = [];
  for (const operation of ["ownership", "slugs", "templates", "lenders"] as const) {
    try {
      const details = await operations[operation]();
      results.push({ operation, status: "succeeded", details });
    } catch (error) {
      const errorDetails = error as { details?: Record<string, unknown> };
      const failureDetails = errorDetails.details
        ? { error: error instanceof Error ? error.message : "Operation failed", ...errorDetails.details }
        : { error: error instanceof Error ? error.message : "Operation failed" };
      results.push({ operation, status: "failed", details: failureDetails });
      for (const skipped of ["ownership", "slugs", "templates", "lenders"] as const) {
        if (results.some((result) => result.operation === skipped)) continue;
        results.push({
          operation: skipped,
          status: "skipped",
          details: { reason: `Skipped after ${operation} failed` },
        });
      }
      return { status: "failed" as const, overallStatus: "failed" as const, results };
    }
  }
  return { status: "succeeded" as const, overallStatus: "succeeded" as const, results };
}