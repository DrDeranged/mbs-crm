import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import {
  activityLogTable,
  db,
  dealsTable,
  dripSequenceStepsTable,
  dripSequencesTable,
  emailTemplatesTable,
  lendersTable,
  usersTable,
} from "@workspace/db";
import {
  ALL_SEED_DEAL_NAMES as SEEDED_DEAL_NAMES,
  CALVIN_SEED_DEAL_NAMES as SEEDED_CALVIN_NAMES,
  ORDINARY_SEED_DEAL_NAMES as SEEDED_ORDINARY_NAMES,
  selectMatchingSeededDealRows,
  validateSeededDealRows,
} from "./seededDealMaintenance";
import {
  EXISTING_LENDER_UPDATES,
  NEW_LENDER_SEEDS,
  applyExistingLenderUpdate,
  newLenderSeedToInsertValues,
  planNewLenderSeeds,
} from "./newLenderSeeds";
export { runProductionCloseout } from "./productionCloseout";

// These are intentionally kept in one place so admin routes can expose the
// same safety error without coupling maintenance to an HTTP request.
export class ProductionMaintenanceError extends Error {
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.details = details;
    this.name = "ProductionMaintenanceError";
  }
}

const SEEDED_ASSIGNMENT_SOURCE_ID = 7;
const SEEDED_ASSIGNMENT_TARGET_ID = 16;

type SeededOwnershipDeal = Pick<
  typeof dealsTable.$inferSelect,
  "id" | "dealName" | "assignedTo" | "intendedRepSlug"
>;

export function planSeededOwnershipCorrections(
  deals: readonly SeededOwnershipDeal[],
  assignedUsers: readonly Pick<typeof usersTable.$inferSelect, "id" | "slug">[],
) {
  const ordinaryNames = new Set<string>(SEEDED_ORDINARY_NAMES);
  const calvinNames = new Set<string>(SEEDED_CALVIN_NAMES);
  const assignedUsersById = new Map(assignedUsers.map((assignedUser) => [assignedUser.id, assignedUser]));
  const ordinaryDeals = deals.filter((deal) => ordinaryNames.has(deal.dealName));
  const calvinDeals = deals.filter((deal) => calvinNames.has(deal.dealName));

  return {
    ordinaryToNate: ordinaryDeals.filter((deal) => deal.assignedTo === SEEDED_ASSIGNMENT_SOURCE_ID),
    calvinToClear: calvinDeals.filter((deal) =>
      deal.assignedTo != null && assignedUsersById.get(deal.assignedTo)?.slug !== "calvin",
    ),
    calvinMarkerOnly: calvinDeals.filter((deal) =>
      (deal.assignedTo == null || assignedUsersById.get(deal.assignedTo)?.slug === "calvin")
      && deal.intendedRepSlug !== "calvin",
    ),
  };
}

export async function correctSeededDealOwnership(actorId: number) {
  return db.transaction(async (tx) => {
    const sourceAndTarget = await tx
      .select()
      .from(usersTable)
      .where(inArray(usersTable.id, [SEEDED_ASSIGNMENT_SOURCE_ID, SEEDED_ASSIGNMENT_TARGET_ID]))
      .for("update");
    const source = sourceAndTarget.find((candidate) => candidate.id === SEEDED_ASSIGNMENT_SOURCE_ID);
    const target = sourceAndTarget.find((candidate) => candidate.id === SEEDED_ASSIGNMENT_TARGET_ID);
    if (!source || !target) {
      throw new ProductionMaintenanceError("Seeded assignment users 7 and 16 must both exist");
    }
    if (!target.isActive || target.name?.trim().toLowerCase() !== "nate ford") {
      throw new ProductionMaintenanceError("User 16 must be the active user Nate Ford");
    }

    const lockedDeals = await tx
      .select()
      .from(dealsTable)
      .where(inArray(dealsTable.dealName, [...SEEDED_DEAL_NAMES]))
      .orderBy(asc(dealsTable.id))
      .for("update");
    const assignedUserIds = lockedDeals
      .map((deal) => deal.assignedTo)
      .filter((assignedTo): assignedTo is number => assignedTo != null);
    const assignedUsers = assignedUserIds.length > 0
      ? await tx
        .select({ id: usersTable.id, slug: usersTable.slug })
        .from(usersTable)
        .where(inArray(usersTable.id, assignedUserIds))
        .for("update")
      : [];
    const validationError = validateSeededDealRows(lockedDeals, assignedUsers);
    if (validationError) throw new ProductionMaintenanceError(validationError);
    const matchingDeals = selectMatchingSeededDealRows(lockedDeals, assignedUsers);
    const matchingDealIds = matchingDeals.map((deal) => deal.id);
    const ordinaryNames = new Set<string>(SEEDED_ORDINARY_NAMES);
    const calvinNames = new Set<string>(SEEDED_CALVIN_NAMES);
    const ordinaryFoundIds = matchingDeals.filter((deal) => ordinaryNames.has(deal.dealName)).map((deal) => deal.id);
    const calvinFoundIds = matchingDeals.filter((deal) => calvinNames.has(deal.dealName)).map((deal) => deal.id);
    const seededRowsFound = matchingDeals.length;
    const seededRowsExpected = SEEDED_DEAL_NAMES.length;
    const convertedOrDeleted = seededRowsExpected - seededRowsFound;
    const seededRowsSummary =
      `${seededRowsFound} of ${seededRowsExpected} seeded rows found (${convertedOrDeleted} converted or deleted)`;

    const { ordinaryToNate, calvinToClear, calvinMarkerOnly } =
      planSeededOwnershipCorrections(matchingDeals, assignedUsers);
    const updatedAt = new Date();
    let ordinaryChanged: Array<{ id: number; leadId: number | null }> = [];
    if (ordinaryToNate.length > 0) {
      ordinaryChanged = await tx
        .update(dealsTable)
        .set({ assignedTo: SEEDED_ASSIGNMENT_TARGET_ID, updatedAt })
        .where(and(
          inArray(dealsTable.id, ordinaryToNate.map((deal) => deal.id)),
          eq(dealsTable.assignedTo, SEEDED_ASSIGNMENT_SOURCE_ID),
        ))
        .returning({ id: dealsTable.id, leadId: dealsTable.leadId });
      await tx.insert(activityLogTable).values(ordinaryChanged.map((deal) => ({
        userId: actorId,
        dealId: deal.id,
        leadId: deal.leadId,
        action: "assignment_reassigned",
        entityType: "deal",
        entityId: String(deal.id),
        details: {
          message: "Ownership corrected to Nate Ford",
          oldAssignedTo: SEEDED_ASSIGNMENT_SOURCE_ID,
          newAssignedTo: SEEDED_ASSIGNMENT_TARGET_ID,
          oldAssignedToId: SEEDED_ASSIGNMENT_SOURCE_ID,
          newAssignedToId: SEEDED_ASSIGNMENT_TARGET_ID,
          reason: "Correct ordinary seeded deal ownership",
        },
      })));
    }
    let calvinCleared: Array<{ id: number; leadId: number | null }> = [];
    if (calvinToClear.length > 0) {
      calvinCleared = await tx
        .update(dealsTable)
        .set({ assignedTo: null, intendedRepSlug: "calvin", updatedAt })
        .where(and(
          inArray(dealsTable.id, calvinToClear.map((deal) => deal.id)),
          isNotNull(dealsTable.assignedTo),
        ))
        .returning({ id: dealsTable.id, leadId: dealsTable.leadId });
      const originalById = new Map(calvinToClear.map((deal) => [deal.id, deal]));
      await tx.insert(activityLogTable).values(calvinCleared.map((deal) => ({
        userId: actorId,
        dealId: deal.id,
        leadId: deal.leadId,
        action: "assignment_reassigned",
        entityType: "deal",
        entityId: String(deal.id),
        details: {
          message: "Reserved for Calvin; temporary admin ownership cleared",
          oldAssignedTo: originalById.get(deal.id)?.assignedTo ?? null,
          newAssignedTo: null,
          oldIntendedRepSlug: originalById.get(deal.id)?.intendedRepSlug ?? null,
          newIntendedRepSlug: "calvin",
          reason: "Preserve Calvin reservation and repair its marker without temporary admin ownership",
        },
      })));
    }
    if (calvinMarkerOnly.length > 0) {
      await tx
        .update(dealsTable)
        .set({ intendedRepSlug: "calvin", updatedAt })
        .where(inArray(dealsTable.id, calvinMarkerOnly.map((deal) => deal.id)));
    }
    const [ordinaryAtNateRow] = ordinaryFoundIds.length === 0 ? [{ count: 0 }] : await tx
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(dealsTable)
      .where(and(
        eq(dealsTable.assignedTo, SEEDED_ASSIGNMENT_TARGET_ID),
        isNull(dealsTable.intendedRepSlug),
        inArray(dealsTable.id, ordinaryFoundIds),
      ));
    const [calvinReservedUnassignedRow] = calvinFoundIds.length === 0 ? [{ count: 0 }] : await tx
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(dealsTable)
      .where(and(
        isNull(dealsTable.assignedTo),
        eq(dealsTable.intendedRepSlug, "calvin"),
        inArray(dealsTable.id, calvinFoundIds),
      ));
    const [calvinOwnershipValidRow] = calvinFoundIds.length === 0 ? [{ count: 0 }] : await tx
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(dealsTable)
      .leftJoin(usersTable, eq(usersTable.id, dealsTable.assignedTo))
      .where(and(
        eq(dealsTable.intendedRepSlug, "calvin"),
        or(isNull(dealsTable.assignedTo), eq(usersTable.slug, "calvin")),
        inArray(dealsTable.id, calvinFoundIds),
      ));
    const [arslanTotalDealsRow] = await tx
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(dealsTable)
      .where(and(
        eq(dealsTable.assignedTo, SEEDED_ASSIGNMENT_SOURCE_ID),
        inArray(dealsTable.id, matchingDealIds),
      ));
    const ordinaryAtNate = ordinaryAtNateRow?.count ?? 0;
    const calvinReservedUnassigned = calvinReservedUnassignedRow?.count ?? 0;
    const calvinOwnershipValid = calvinOwnershipValidRow?.count ?? 0;
    const arslanTotalDeals = arslanTotalDealsRow?.count ?? 0;
    if (ordinaryAtNate !== ordinaryFoundIds.length
      || calvinOwnershipValid !== calvinFoundIds.length
      || arslanTotalDeals !== 0) {
      throw new ProductionMaintenanceError("Seeded deal ownership postconditions were not satisfied");
    }
    const changedDealIds = [...ordinaryChanged, ...calvinCleared, ...calvinMarkerOnly].map((deal) => deal.id);
    return {
      changed: changedDealIds.length,
      ordinaryChanged: ordinaryChanged.length,
      ordinaryAtNate,
      calvinCleared: calvinCleared.length,
      calvinReservedUnassigned,
      arslanTotalDeals,
      seededRowsFound,
      seededRowsExpected,
      convertedOrDeleted,
      seededRowsSummary,
      changedDealIds,
    };
  });
}

export const PRODUCTION_SLUG_BACKFILL = [
  { id: 7, slug: "arslan", duplicateForReview: false },
  { id: 12, slug: "arslan-d2", duplicateForReview: true },
  { id: 16, slug: "nate", duplicateForReview: false },
] as const;

export async function backfillProductionSlugs() {
  return db.transaction(async (tx) => {
    const targetIds = PRODUCTION_SLUG_BACKFILL.map((target) => target.id);
    const targetSlugs = PRODUCTION_SLUG_BACKFILL.map((target) => target.slug);
    const targets = await tx
      .select()
      .from(usersTable)
      .where(inArray(usersTable.id, targetIds))
      .for("update");
    const targetsById = new Map(targets.map((target) => [target.id, target]));
    const missingUserIds = targetIds.filter((id) => !targetsById.has(id));
    if (missingUserIds.length > 0) {
      throw new ProductionMaintenanceError(
        "Slug backfill aborted because one or more target users do not exist",
        { missingUserIds },
      );
    }

    const conflictingUsers = await tx
      .select()
      .from(usersTable)
      .where(and(
        inArray(usersTable.slug, targetSlugs),
        notInArray(usersTable.id, targetIds),
      ))
      .for("update");
    if (conflictingUsers.length > 0) {
      throw new ProductionMaintenanceError(
        "Slug backfill aborted because one or more target slugs are already assigned",
        {
          conflicts: conflictingUsers.map((conflict) => ({
            userId: conflict.id,
            slug: conflict.slug,
          })),
        },
      );
    }

    const summary = [];
    for (const target of PRODUCTION_SLUG_BACKFILL) {
      const existing = targetsById.get(target.id)!;
      const changed = existing.slug !== target.slug;
      if (changed) {
        await tx
          .update(usersTable)
          .set({ slug: target.slug, updatedAt: new Date() })
          .where(eq(usersTable.id, target.id));
      }
      summary.push({
        userId: target.id,
        previousSlug: existing.slug,
        slug: target.slug,
        changed,
        duplicateForReview: target.duplicateForReview,
      });
    }
    const changed = summary.filter((result) => result.changed).length;
    return { changed, unchanged: summary.length - changed, users: summary };
  });
}

export type LenderSeedTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type LenderSeedExistingUpdateResult = {
  name: string;
  status: "missing" | "already_applied" | "updated";
  patch: Record<string, unknown> | null;
};

export type LenderSeedOperationResult = {
  created: number;
  updated: number;
  unchanged: number;
  createdNames: string[];
  updatedNames: string[];
  unchangedNames: string[];
  missingUpdateNames: string[];
  existingLenderUpdates: LenderSeedExistingUpdateResult[];
  updatedExistingNames: string[];
  unchangedExistingNames: string[];
  missingExistingNames: string[];
  lenders: (typeof lendersTable.$inferSelect)[];
};

/**
 * Production lender seed/update operation. Keeping this executor separate
 * from the transaction wrapper lets tests exercise the exact operation used
 * in production with a transaction-shaped double.
 */
export async function executeLenderSeedAndUpdates(
  tx: LenderSeedTransaction,
): Promise<LenderSeedOperationResult> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(874240)`);
  const existing = await tx.select().from(lendersTable).where(
    sql`${lendersTable.name} IN (${sql.join(NEW_LENDER_SEEDS.map((seed) => sql`${seed.name}`), sql`, `)})`,
  );
  const plan = planNewLenderSeeds(existing.map((lender) => lender.name));
  for (const seed of plan.toCreate) {
    await tx.insert(lendersTable).values(newLenderSeedToInsertValues(seed) as any);
  }

  const existingLenderUpdates = [];
  for (const update of EXISTING_LENDER_UPDATES) {
    // Keep this lookup exact-name and row-locked. The packet updates are
    // intentionally not part of NEW_LENDER_SEEDS and must never recreate a
    // missing lender or touch a same-name variant.
    const [existing] = await tx
      .select({
        id: lendersTable.id,
        name: lendersTable.name,
        notes: lendersTable.notes,
        minCreditScore: lendersTable.minCreditScore,
        minTimeInBusinessMonths: lendersTable.minTimeInBusinessMonths,
        maxAmount: lendersTable.maxAmount,
        restrictedIndustries: lendersTable.restrictedIndustries,
        prohibitedIndustries: lendersTable.prohibitedIndustries,
        minMonthlyRevenue: lendersTable.minMonthlyRevenue,
        restrictedIndustryMinMonthlyRevenue: lendersTable.restrictedIndustryMinMonthlyRevenue,
        programEligibilityRules: lendersTable.programEligibilityRules,
      })
      .from(lendersTable)
      .where(eq(lendersTable.name, update.name))
      .for("update");

    if (!existing) {
      existingLenderUpdates.push({
        name: update.name,
        status: "missing" as const,
        patch: null,
      });
      continue;
    }
    const packetAlreadyApplied = existing.notes?.includes(update.marker) ?? false;
    const gateBackfillMarker = "gateBackfillMarker" in update ? update.gateBackfillMarker : null;
    const structuredFieldsDiffer = Object.entries(update.structuredPatch).some(([key, value]) =>
      !isDeepStrictEqual((existing as Record<string, unknown>)[key] ?? null, value ?? null),
    );
    const gateBackfillNeeded = gateBackfillMarker != null
      && !existing.notes?.includes(gateBackfillMarker)
      && structuredFieldsDiffer;
    if (packetAlreadyApplied && !gateBackfillNeeded) {
      existingLenderUpdates.push({
        name: update.name,
        status: "already_applied" as const,
        patch: null,
      });
      continue;
    }

    const updateNotes = `${gateBackfillMarker}\nSCHEMA MAPPING CLARIFICATION: structured matcher fields were backfilled from the preserved packet source statements.`;
    const baseUpdated = packetAlreadyApplied
      ? {
        ...existing,
        notes: `${existing.notes}\n\n${updateNotes}`,
      }
      : applyExistingLenderUpdate(existing, update);
    const updated = gateBackfillMarker != null && !(baseUpdated.notes ?? "").includes(gateBackfillMarker)
      ? { ...baseUpdated, notes: `${baseUpdated.notes ?? ""}\n\n${updateNotes}` }
      : baseUpdated;
    await tx
      .update(lendersTable)
      .set({
        ...(update.structuredPatch as Record<string, unknown>),
        notes: updated.notes,
        updatedAt: new Date(),
      } as any)
      .where(eq(lendersTable.id, existing.id));
    existingLenderUpdates.push({
      name: update.name,
      status: "updated" as const,
      patch: update.structuredPatch,
    });
  }

  const lenders = await tx.select().from(lendersTable).where(
    sql`${lendersTable.name} IN (${sql.join(NEW_LENDER_SEEDS.map((seed) => sql`${seed.name}`), sql`, `)})`,
  );
  const updatedExistingNames: string[] = existingLenderUpdates
    .filter((update) => update.status === "updated")
    .map((update) => update.name);
  const unchangedExistingNames: string[] = existingLenderUpdates
    .filter((update) => update.status === "already_applied")
    .map((update) => update.name);
  const missingExistingNames: string[] = existingLenderUpdates
    .filter((update) => update.status === "missing")
    .map((update) => update.name);
  const createdNames: string[] = plan.toCreate.map((seed) => seed.name);
  // A newly inserted canonical seed can receive a packet update in the same
  // transaction. It is still reported as created (its final row includes the
  // patch), keeping the public created/updated/unchanged buckets exclusive.
  const updatedNames: string[] = updatedExistingNames.filter((name) => !createdNames.includes(name));
  // "unchanged" covers both configured new seeds that already existed and
  // Section B targets whose packet marker is already present. Missing exact
  // update targets stay separate and are never counted as unchanged.
  // A seed name can also be an already-applied packet-update target. Report
  // each unchanged lender once so the displayed inventory is an actual unique
  // set, while retaining the detailed existingLenderUpdates list for audit.
  const unchangedNames: string[] = [...new Set([
    ...plan.unchangedNames,
    ...unchangedExistingNames,
  ])].filter((name) => !createdNames.includes(name) && !updatedNames.includes(name));
  return {
    created: createdNames.length,
    updated: updatedNames.length,
    unchanged: unchangedNames.length,
    createdNames,
    updatedNames,
    unchangedNames,
    missingUpdateNames: missingExistingNames,
    existingLenderUpdates,
    updatedExistingNames,
    unchangedExistingNames,
    missingExistingNames,
    lenders,
  };
}

export async function seedNewLenders(): Promise<LenderSeedOperationResult> {
  return db.transaction((tx) => executeLenderSeedAndUpdates(tx));
}

export type StarterEmailTemplateSeed = {
  name: string;
  programType: string | null;
  subject: string;
  bodyHtml: string;
};

export async function seedStarterEmailData(
  actorId: number,
  templates: readonly StarterEmailTemplateSeed[],
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(874241)`);
    const existingTemplates = await tx
      .select({ name: emailTemplatesTable.name })
      .from(emailTemplatesTable)
      .for("update");
    const existingNames = new Set(existingTemplates.map((t) => t.name));
    const toInsert = templates.filter((t) => !existingNames.has(t.name));
    const createdTemplates: { name: string; id: number }[] = [];
    for (const template of toInsert) {
      const [inserted] = await tx.insert(emailTemplatesTable).values({
        name: template.name,
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        programType: template.programType as "working_capital" | "equipment" | null,
        senderMode: "default",
        createdBy: actorId,
        ownerId: actorId,
        isActive: true,
      }).returning();
      createdTemplates.push({ name: template.name, id: inserted.id });
    }
    const allTemplates = await tx
      .select({ id: emailTemplatesTable.id, name: emailTemplatesTable.name })
      .from(emailTemplatesTable)
      .where(inArray(emailTemplatesTable.name, ["Application Received", "Initial Follow-Up", "Document Request"]))
      .for("update");
    const templateIdByName: Record<string, number> = {};
    for (const template of allTemplates) templateIdByName[template.name] = template.id;

    let sequenceCreated = false;
    const sequenceName = "New Application Nurture";
    const existing = await tx
      .select({ id: dripSequencesTable.id })
      .from(dripSequencesTable)
      .where(eq(dripSequencesTable.name, sequenceName))
      .for("update");
    if (existing.length === 0) {
      const appReceivedId = templateIdByName["Application Received"];
      const followUpId = templateIdByName["Initial Follow-Up"];
      const docRequestId = templateIdByName["Document Request"];
      if (appReceivedId && followUpId && docRequestId) {
        const [sequence] = await tx.insert(dripSequencesTable).values({
          name: sequenceName,
          triggerStatus: "application_received",
          isActive: false,
          createdBy: actorId,
          ownerId: actorId,
        }).returning();
        await tx.insert(dripSequenceStepsTable).values([
          { sequenceId: sequence.id, stepOrder: 1, templateId: appReceivedId, delayHours: 0 },
          { sequenceId: sequence.id, stepOrder: 2, templateId: followUpId, delayHours: 24 },
          { sequenceId: sequence.id, stepOrder: 3, templateId: docRequestId, delayHours: 72 },
        ]);
        sequenceCreated = true;
      }
    }
    return {
      templatesCreated: createdTemplates.length,
      sequenceCreated,
      skippedTemplates: templates.length - createdTemplates.length,
      message: createdTemplates.length > 0 || sequenceCreated
        ? `Created ${createdTemplates.length} template(s) and ${sequenceCreated ? 1 : 0} drip sequence.`
        : "All starter templates already exist. Nothing was duplicated.",
    };
  });
}
