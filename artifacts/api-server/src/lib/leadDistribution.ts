import { and, eq, inArray, sql } from "drizzle-orm";
import { db, companySettingsTable, usersTable } from "@workspace/db";
import {
  DEFAULT_ROUTING_SETTINGS,
  shouldRoundRobinAssign,
  type RoutingSettings,
} from "./leadRouting";

const ROUND_ROBIN_LOCK_KEY = 840163;

type EligibleRole = "rep" | "manager" | "admin";

export async function getRoutingSettings(): Promise<RoutingSettings> {
  const [settings] = await db.select().from(companySettingsTable).limit(1);
  return {
    mode: settings?.routingMode ?? DEFAULT_ROUTING_SETTINGS.mode,
    staleDays: settings?.routingStaleDays ?? settings?.staleThresholdDays ?? DEFAULT_ROUTING_SETTINGS.staleDays,
    autoReassignStale: settings?.routingAutoReassignStale ?? DEFAULT_ROUTING_SETTINGS.autoReassignStale,
  };
}

async function eligibleRoles(): Promise<EligibleRole[]> {
  const [settings] = await db.select().from(companySettingsTable).limit(1);
  return settings?.includeAdminsInRoundRobin
    ? ["rep", "manager", "admin"]
    : ["rep", "manager"];
}

/**
 * Selects the next inbound assignee from one ordered pool. The PostgreSQL
 * transaction advisory lock serializes cursor reads/updates across API
 * processes, while the cursor is persisted in company_settings.
 */
export async function pickNextInboundAssignee(): Promise<number | null> {
  return db.transaction(async (tx) => (await selectNextInboundAssigneeInTransaction(tx))?.repId ?? null);
}

/**
 * The caller's transaction holds the cursor update and its lead mutation as
 * one unit. The advisory lock serializes every process that advances the
 * shared cursor, preventing concurrent jobs from issuing duplicate picks.
 */
export type InboundAssigneeSelection = {
  repId: number;
  staleDays: number;
};

export async function selectNextInboundAssigneeInTransaction(
  tx: any,
  options: { requireAutoReassignStale?: boolean } = {},
): Promise<InboundAssigneeSelection | null> {
    await tx.execute(sql`select pg_advisory_xact_lock(${ROUND_ROBIN_LOCK_KEY})`);

    const [settings] = await tx.select().from(companySettingsTable).limit(1);
    if (
      (settings?.routingMode ?? DEFAULT_ROUTING_SETTINGS.mode) !== "round_robin" ||
      (options.requireAutoReassignStale && settings?.routingAutoReassignStale !== true)
    ) {
      return null;
    }
    const roles = settings?.includeAdminsInRoundRobin
      ? (["rep", "manager", "admin"] as const)
      : (["rep", "manager"] as const);
    const candidates = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.isActive, true), inArray(usersTable.role, roles)))
      .orderBy(usersTable.id);

    if (candidates.length === 0) return null;

    const cursor = Math.max(0, settings?.roundRobinCursor ?? 0) % candidates.length;
    const selected = candidates[cursor]?.id ?? null;
    const nextCursor = (cursor + 1) % candidates.length;

    if (settings) {
      await tx
        .update(companySettingsTable)
        .set({ roundRobinCursor: nextCursor, updatedAt: new Date() })
        .where(eq(companySettingsTable.id, settings.id));
    } else {
      await tx.insert(companySettingsTable).values({
        includeAdminsInRoundRobin: false,
        roundRobinCursor: nextCursor,
        routingMode: "manual",
        routingStaleDays: DEFAULT_ROUTING_SETTINGS.staleDays,
        routingAutoReassignStale: DEFAULT_ROUTING_SETTINGS.autoReassignStale,
      });
    }
    return selected === null
      ? null
      : {
        repId: selected,
        staleDays: settings?.routingStaleDays ?? settings?.staleThresholdDays ?? DEFAULT_ROUTING_SETTINGS.staleDays,
      };
}

/**
 * Resolve a QR/rep-link attribution only for an active representative.
 * Invalid, pending, inactive, manager, and admin slugs fall through to the
 * normal inbound distribution resolver.
 */
export async function resolveInboundAssignee(
  repSlug?: string | null,
  source = "website",
): Promise<number | null> {
  const attributedRep = await findActiveRepBySlug(repSlug);
  if (attributedRep) return attributedRep.id;
  const settings = await getRoutingSettings();
  return shouldRoundRobinAssign(source, settings) ? pickNextInboundAssignee() : null;
}

/** Returns a valid active QR representative, never a retired or arbitrary slug. */
export async function findActiveRepBySlug(repSlug?: string | null) {
  if (!repSlug) return null;
  const [attributedRep] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.slug, repSlug.toLowerCase()),
      eq(usersTable.role, "rep"),
      eq(usersTable.isActive, true),
    ))
    .limit(1);
  return attributedRep ?? null;
}

/** Validate manual assignment destinations against the same eligible pool. */
export async function isEligibleInboundAssignee(userId: number): Promise<boolean> {
  const roles = await eligibleRoles();
  const [candidate] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.id, userId),
      eq(usersTable.isActive, true),
      inArray(usersTable.role, roles),
    ))
    .limit(1);
  return !!candidate;
}

/** Candidate membership report for diagnostics/admin verification. */
export async function getInboundRoundRobinCandidates() {
  const roles = await eligibleRoles();
  return db.query.usersTable.findMany({
    where: and(eq(usersTable.isActive, true), inArray(usersTable.role, roles)),
    orderBy: (users, { asc }) => asc(users.id),
  });
}