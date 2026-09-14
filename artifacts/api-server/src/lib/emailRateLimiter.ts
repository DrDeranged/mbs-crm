import { db } from "@workspace/db";
import { emailRateSlotsTable } from "@workspace/db";
import { gt, lt, sql } from "drizzle-orm";
import { canReserveEmailRateSlot } from "./emailRateLimiterPolicy";

/**
 * Atomically reserve one provider attempt for the shared rolling 60-second
 * window. PostgreSQL advisory locking makes this safe across API processes
 * without holding a row lock while SendGrid is called.
 */
export async function reserveEmailRateSlot(limit: number, now = new Date()): Promise<boolean> {
  const cap = Math.max(1, Math.min(1000, Math.floor(limit)));
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('mbs-email-rate-slots'))`);
    await tx.delete(emailRateSlotsTable).where(lt(emailRateSlotsTable.expiresAt, now));
    const active = await tx.select({ count: sql<number>`count(*)` })
      .from(emailRateSlotsTable)
      .where(gt(emailRateSlotsTable.expiresAt, now));
    if (!canReserveEmailRateSlot(Number(active[0]?.count ?? 0), cap)) return false;
    await tx.insert(emailRateSlotsTable).values({
      reservedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    return true;
  });
}

export const EMAIL_RATE_RETRY_MS = 250;