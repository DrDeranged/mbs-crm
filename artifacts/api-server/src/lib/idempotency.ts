import { createHash } from "crypto";
import { db } from "@workspace/db";
import { idempotencyKeysTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export function deriveKey(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function checkIdempotency(
  key: string,
  endpoint: string,
): Promise<Record<string, unknown> | null> {
  const existing = await db.query.idempotencyKeysTable.findFirst({
    where: and(
      eq(idempotencyKeysTable.key, key),
      eq(idempotencyKeysTable.endpoint, endpoint),
    ),
  });
  if (existing?.resultPayload) {
    return existing.resultPayload as Record<string, unknown>;
  }
  return null;
}

export async function storeIdempotency(
  key: string,
  endpoint: string,
  resultRef: string,
  resultPayload: Record<string, unknown>,
): Promise<void> {
  try {
    await db
      .insert(idempotencyKeysTable)
      .values({ key, endpoint, resultRef, resultPayload });
  } catch {
    // Unique constraint violation = another concurrent request already stored it; ignore.
  }
}
