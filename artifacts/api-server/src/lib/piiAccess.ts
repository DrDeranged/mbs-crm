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
  void recordPiiAccess(params).catch(() => {});
}

export async function recordPiiAccess(params: Parameters<typeof logPiiAccess>[0]): Promise<void> {
  await db.insert(piiAccessLogTable)
    .values({
      userId: params.userId ?? null,
      leadId: params.leadId ?? null,
      fieldCategory: params.fieldCategory,
      action: params.action,
      ip: params.ip ?? null,
      metadata: params.metadata ?? null,
    })
    ;
}
