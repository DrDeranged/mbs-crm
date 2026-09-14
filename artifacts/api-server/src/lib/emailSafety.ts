import { db } from "@workspace/db";
import {
  dripEnrollmentsTable,
  emailSendsTable,
  leadsTable,
} from "@workspace/db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { normalizeEmail } from "./emailSafetyPredicates";

export { normalizeEmail };

const normalizedEmailWhere = (email: string) =>
  sql`lower(trim(${leadsTable.email})) = ${normalizeEmail(email)}`;

/** A single opt-out suppresses every duplicate lead record for that address. */
export async function isEmailSuppressed(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized) return true;
  const rows = await db.select({ isUnsubscribed: leadsTable.isUnsubscribed })
    .from(leadsTable)
    .where(and(isNotNull(leadsTable.email), normalizedEmailWhere(normalized)));
  return rows.some((row) => row.isUnsubscribed);
}

/**
 * Apply a provider/customer suppression to the complete duplicate set and
 * cancel both active drip enrollments and queued future sends.
 */
export async function suppressEmail(email: string): Promise<number[]> {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  const matches = await db.select({ id: leadsTable.id })
    .from(leadsTable)
    .where(and(isNotNull(leadsTable.email), normalizedEmailWhere(normalized)));
  const leadIds = matches.map((row) => row.id);
  if (!leadIds.length) return [];

  await db.update(leadsTable)
    .set({ isUnsubscribed: true, updatedAt: new Date() })
    .where(inArray(leadsTable.id, leadIds));
  await db.update(dripEnrollmentsTable)
    .set({ status: "unenrolled", unenrolledAt: new Date() })
    .where(and(inArray(dripEnrollmentsTable.leadId, leadIds), eq(dripEnrollmentsTable.status, "active")));
  // A queued row is not a delivery and must never be delivered after opt-out.
  await db.update(emailSendsTable)
    .set({ status: "unsubscribed", updatedAt: new Date() })
    .where(and(inArray(emailSendsTable.leadId, leadIds), eq(emailSendsTable.status, "queued")));
  return leadIds;
}