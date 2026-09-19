import { getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import {
  activityLogTable,
  dealsTable,
  userIdentitiesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { logger } from "./logger";
import { reservedIdentityOwnerId } from "./userIdentityMerge";

type RequireUserOptions = {
  allowPending?: boolean;
};

export const RESERVED_REP_SLUGS: Readonly<Record<string, string>> = {
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

  const identity = await db.query.userIdentitiesTable.findFirst({
    where: eq(userIdentitiesTable.clerkId, clerkId),
  });
  let user = identity
    ? await db.query.usersTable.findFirst({
        where: eq(usersTable.id, identity.userId),
      })
    : await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, clerkId),
      });

  if (!user) {
    try {
      const clerkUser = await clerkClient.users.getUser(clerkId);
      const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
      const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
      const reservedSlug = reservedSlugForEmail(email);

      // Reserved rep emails are aliases for an existing account, not new
      // accounts. Lock the owner while attaching the identity so a concurrent
      // sign-in cannot race a deactivation or create a second local user.
      if (reservedSlug) {
        const reservedUser = await db.transaction(async (tx) => {
          const [owner] = await tx
            .select()
            .from(usersTable)
            .where(and(
              eq(usersTable.slug, reservedSlug),
              eq(usersTable.isActive, true),
            ))
            .for("update");

          if (!owner) return null;
          if (
            reservedIdentityOwnerId(
              email,
              RESERVED_REP_SLUGS,
              [owner],
            ) !== owner.id
          ) return null;

          const [insertedIdentity] = await tx
            .insert(userIdentitiesTable)
            .values({
              userId: owner.id,
              clerkId,
              email,
              provider: "clerk",
            })
            .onConflictDoNothing({ target: userIdentitiesTable.clerkId })
            .returning();

          if (insertedIdentity) {
            await tx.insert(activityLogTable).values({
              userId: owner.id,
              action: "identity_linked",
              entityType: "user",
              entityId: String(owner.id),
              details: {
                provider: "clerk",
                clerkId,
                email,
                reservedSlug,
                reason: "reserved_rep_email_sign_in",
              },
            });
            return owner;
          }

          // A concurrent request won the unique identity race. Resolve the
          // committed identity rather than creating or relinking a user.
          const identityAfterConflict = await tx.query.userIdentitiesTable.findFirst({
            where: eq(userIdentitiesTable.clerkId, clerkId),
          });
          return identityAfterConflict
            ? await tx.query.usersTable.findFirst({
                where: eq(usersTable.id, identityAfterConflict.userId),
              })
            : null;
        });

        if (reservedUser) {
          user = reservedUser;
        }
      }

      if (!user) {
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
          await db
            .insert(userIdentitiesTable)
            .values({
              userId: existing.id,
              clerkId,
              email: existing.email,
              provider: "clerk",
            })
            .onConflictDoNothing({ target: userIdentitiesTable.clerkId });
        }
      }

      if (!user) {
        const [created] = await db.insert(usersTable).values({
          clerkId,
          email,
          name,
          role: "pending",
          slug: reservedSlug,
        }).returning();
        user = created;
        await db
          .insert(userIdentitiesTable)
          .values({
            userId: created.id,
            clerkId,
            email,
            provider: "clerk",
          })
          .onConflictDoNothing({ target: userIdentitiesTable.clerkId });
      }
    } catch (e) {
      res.status(500).json({ error: "Failed to resolve user" });
      return null;
    }
  } else if (!identity && user.clerkId === clerkId) {
    // Keep legacy users resolvable while lazily filling any identity row that
    // was not present when migration 035 was applied.
    try {
      await db
        .insert(userIdentitiesTable)
        .values({
          userId: user.id,
          clerkId,
          email: user.email,
          provider: "clerk",
        })
        .onConflictDoNothing({ target: userIdentitiesTable.clerkId });
    } catch (e) {
      logger.warn({ err: e, userId: user.id }, "Failed to backfill user identity");
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
