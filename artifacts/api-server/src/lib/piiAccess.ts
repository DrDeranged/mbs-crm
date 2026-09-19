import { db } from "@workspace/db";
import { piiAccessLogTable } from "@workspace/db";

type PiiFieldCategory = "ssn" | "credit" | "application";
type PiiAction = "view" | "export";

export function logPiiAccess(params: {
  userId: number | null;
  leadId: number | null;
  fieldCategory: PiiFieldCategory;
  action: PiiAction;
  ip?: string | null;
  /** Safe operational context only; do not put plaintext PII in this object. */
  metadata?: Record<string, unknown> | null;
}): void {
  // Fire-and-forget — never block the response
  db.insert(piiAccessLogTable)
    .values({
      userId: params.userId ?? null,
      leadId: params.leadId ?? null,
      fieldCategory: params.fieldCategory,
      action: params.action,
      ip: params.ip ?? null,
      metadata: params.metadata ?? null,
    })
    .catch((err: unknown) => {
      console.error("[piiAccess] Failed to write PII access log:", err);
    });
}
