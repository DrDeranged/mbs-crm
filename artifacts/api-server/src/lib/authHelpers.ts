import { getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { activityLogTable, dealsTable, usersTable } from "@workspace/db";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { logger } from "./logger";

type RequireUserOptions = {
  allowPending?: boolean;
};

const RESERVED_REP_SLUGS: Readonly<Record<string, string>> = {
  "calvintuon@gmail.com": "calvin",
  "calvin@my-business-solutions.com": "calvin",
  "rahmaredavis@gmail.com": "ray",
  "ray@my-business-solutions.com": "ray",
  "manny@my-business-solutions.com": "manny",
};

const RESERVED_REP_SLUG_SET = new Set(Object.values(RESERVED_REP_SLUGS));

export function reservedSlugForEmail(email: string): string | undefined {
  return RESERVED_REP_SLUGS[email.trim().toLowerCase()];
}

/**
 * Creator-owned resources (email templates and drip sequences) are private to
 * reps. Managers and admins retain their existing team-wide access.
 */
export function canAccessCreatorOwnedRecord(
  user: Pick<typeof usersTable.$inferSelect, "id" | "role">,
  createdBy: number | null,
): boolean {
  return user.role !== "rep" || createdBy === user.id;
}

type MarketingOwner = Pick<typeof usersTable.$inferSelect, "id" | "role"> | null | undefined;

/**
 * Marketing resources have an explicit owner. Representatives can modify only
 * their own resources, but can read administrator-owned resources so approved
 * company campaigns remain available to their assigned leads.
 */
export function canReadMarketingResource(
  user: Pick<typeof usersTable.$inferSelect, "id" | "role">,
  owner: MarketingOwner,
): boolean {
  return user.role !== "rep" || owner?.id === user.id || owner?.role === "admin";
}

export function canManageMarketingResource(
  user: Pick<typeof usersTable.$inferSelect, "id" | "role">,
  ownerId: number | null,
): boolean {
  return user.role !== "rep" || ownerId === user.id;
}

/**
 * Move deals carrying an intended-rep marker to the matching signed-in user.
 *
 * The conditional update is important for idempotency and concurrent sign-ins:
 * PostgreSQL rechecks the predicate after waiting on a row lock, so only the
 * request that actually changes an assignment writes the activity entry.
 */
export async function reconcileReservedRepDeals(user: typeof usersTable.$inferSelect): Promise<number> {
  const intendedRepSlug = user.slug;
  if (
    !user.isActive ||
    user.role === "pending" ||
    !intendedRepSlug ||
    !RESERVED_REP_SLUG_SET.has(intendedRepSlug)
  ) return 0;

  const displayName = user.name?.trim() || user.email;
  return db.transaction(async (tx) => {
    const markedDeals = await tx
      .select({
        id: dealsTable.id,
        leadId: dealsTable.leadId,
      })
      .from(dealsTable)
      .where(eq(dealsTable.intendedRepSlug, intendedRepSlug));

    let reassigned = 0;
    for (const deal of markedDeals) {
      const [updated] = await tx
        .update(dealsTable)
        .set({ assignedTo: user.id, updatedAt: new Date() })
        .where(and(
          eq(dealsTable.id, deal.id),
          eq(dealsTable.intendedRepSlug, intendedRepSlug),
          or(isNull(dealsTable.assignedTo), ne(dealsTable.assignedTo, user.id)),
        ))
        .returning({ id: dealsTable.id });

      if (!updated) continue;

      await tx.insert(activityLogTable).values({
        userId: user.id,
        leadId: deal.leadId,
        dealId: deal.id,
        action: "assignment_reconciled",
        entityType: "deal",
        entityId: String(deal.id),
        details: {
          note: `Reserved rep ${intendedRepSlug} signed in; deal #${deal.id} was reassigned to ${displayName}.`,
          intendedRepSlug,
        },
      });
      reassigned++;
    }
    return reassigned;
  });
}

export async function requireUser(
  req: Request,
  res: Response,
  options: RequireUserOptions = {},
): Promise<typeof usersTable.$inferSelect | null> {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  let user = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, clerkId) });

  if (!user) {
    try {
      const clerkUser = await clerkClient.users.getUser(clerkId);
      const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
      const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
      const reservedSlug = reservedSlugForEmail(email);

      const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
      if (existing) {
        const [linked] = await db.update(usersTable)
          .set({
            clerkId,
            ...(reservedSlug && !existing.slug ? { slug: reservedSlug } : {}),
          })
          .where(eq(usersTable.id, existing.id))
          .returning();
        user = linked;
      } else {
        const [created] = await db.insert(usersTable).values({
          clerkId,
          email,
          name,
          role: "pending",
          slug: reservedSlug,
        }).returning();
        user = created;
      }
    } catch (e) {
      res.status(500).json({ error: "Failed to resolve user" });
      return null;
    }
  }

  if (!user!.isActive) {
    res.status(403).json({ error: "Account is inactive" });
    return null;
  }

  if (user!.role === "pending" && !options.allowPending) {
    res.status(403).json({
      error: "Your account is awaiting approval — contact your administrator",
      code: "ACCOUNT_PENDING",
    });
    return null;
  }

  // This runs on every authenticated request after the user has successfully
  // synced and passed the active/pending gates, making sign-in reconciliation
  // self-healing without a separate migration or admin action.
  try {
    await reconcileReservedRepDeals(user!);
  } catch (e) {
    // Do not turn a successful sign-in into a failed request if reconciliation
    // cannot complete; the next authenticated request will retry it.
    logger.warn({ err: e, userId: user!.id }, "Failed to reconcile reserved rep deals");
  }

  return user!;
}

export function userToApi(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    clerkId: user.clerkId,
    name: user.name,
    title: user.title ?? null,
    email: user.email,
    slug: user.slug ?? null,
    role: user.role,
    isActive: user.isActive,
    mobileNumber: user.mobileNumber ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function getUserDisplayName(
  user: { name?: string | null; email?: string | null; slug?: string | null } | null | undefined,
  fallback = "User",
): string {
  const name = user?.name?.trim();
  if (name) return name;
  const email = user?.email?.trim().toLowerCase() ?? "";
  if (
    user?.slug === "ray"
    || email === "rahmaredavis@gmail.com"
    || email === "ray@my-business-solutions.com"
  ) return "Ray Davis";
  const localPart = email.split("@")[0]?.trim();
  if (!localPart) return fallback;
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ") || fallback;
}
