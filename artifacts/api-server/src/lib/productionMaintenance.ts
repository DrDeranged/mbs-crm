import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
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
  validateSeededDealRows,
} from "./seededDealMaintenance";
import {
  EXISTING_LENDER_UPDATES,
  NEW_LENDER_SEEDS,
  appendExistingLenderUpdateNotes,
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

    const ordinaryNames = new Set<string>(SEEDED_ORDINARY_NAMES);
    const calvinNames = new Set<string>(SEEDED_CALVIN_NAMES);
    const ordinaryDeals = lockedDeals.filter((deal) => ordinaryNames.has(deal.dealName));
    const calvinDeals = lockedDeals.filter((deal) => calvinNames.has(deal.dealName));
    const ordinaryToNate = ordinaryDeals.filter((deal) => deal.assignedTo === SEEDED_ASSIGNMENT_SOURCE_ID);
    const calvinToRepair = calvinDeals.filter((deal) =>
      deal.assignedTo != null || deal.intendedRepSlug !== "calvin",
    );
    const updatedAt = new Date();
    if (ordinaryToNate.length > 0) {
      await tx
        .update(dealsTable)
        .set({ assignedTo: SEEDED_ASSIGNMENT_TARGET_ID, updatedAt })
        .where(inArray(dealsTable.id, ordinaryToNate.map((deal) => deal.id)));
      await tx.insert(activityLogTable).values(ordinaryToNate.map((deal) => ({
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
    if (calvinToRepair.length > 0) {
      await tx
        .update(dealsTable)
        .set({ assignedTo: null, intendedRepSlug: "calvin", updatedAt })
        .where(inArray(dealsTable.id, calvinToRepair.map((deal) => deal.id)));
      await tx.insert(activityLogTable).values(calvinToRepair.map((deal) => ({
        userId: actorId,
        dealId: deal.id,
        leadId: deal.leadId,
        action: "assignment_reassigned",
        entityType: "deal",
        entityId: String(deal.id),
        details: {
          message: "Reserved for Calvin; temporary admin ownership cleared",
          oldAssignedTo: deal.assignedTo,
          newAssignedTo: null,
          oldIntendedRepSlug: deal.intendedRepSlug,
          newIntendedRepSlug: "calvin",
          reason: "Preserve Calvin reservation and repair its marker without temporary admin ownership",
        },
      })));
    }
    const [ordinaryAtNateRow] = await tx
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(dealsTable)
      .where(and(
        eq(dealsTable.assignedTo, SEEDED_ASSIGNMENT_TARGET_ID),
        isNull(dealsTable.intendedRepSlug),
        inArray(dealsTable.dealName, [...SEEDED_ORDINARY_NAMES]),
      ));
    const [calvinReservedUnassignedRow] = await tx
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(dealsTable)
      .where(and(
        isNull(dealsTable.assignedTo),
        eq(dealsTable.intendedRepSlug, "calvin"),
        inArray(dealsTable.dealName, [...SEEDED_CALVIN_NAMES]),
      ));
    const [arslanTotalDealsRow] = await tx
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(dealsTable)
      .where(eq(dealsTable.assignedTo, SEEDED_ASSIGNMENT_SOURCE_ID));
    const ordinaryAtNate = ordinaryAtNateRow?.count ?? 0;
    const calvinReservedUnassigned = calvinReservedUnassignedRow?.count ?? 0;
    const arslanTotalDeals = arslanTotalDealsRow?.count ?? 0;
    if (ordinaryAtNate !== SEEDED_ORDINARY_NAMES.length
      || calvinReservedUnassigned !== SEEDED_CALVIN_NAMES.length
      || arslanTotalDeals !== 0) {
      throw new ProductionMaintenanceError("Seeded deal ownership postconditions were not satisfied");
    }
    const changedDealIds = [...ordinaryToNate, ...calvinToRepair].map((deal) => deal.id);
    return {
      changed: ordinaryToNate.length,
      ordinaryChanged: ordinaryToNate.length,
      ordinaryAtNate,
      calvinCleared: calvinToRepair.length,
      calvinReservedUnassigned,
      arslanTotalDeals,
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

/**
 * Production lender seed/update operation. Keeping this executor separate
 * from the transaction wrapper lets tests exercise the exact operation used
 * in production with a transaction-shaped double.
 */
export async function executeLenderSeedAndUpdates(tx: LenderSeedTransaction) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(874240)`);
  const existing = await tx.select().from(lendersTable).where(
    sql`${lendersTable.name} IN (${sql.join(NEW_LENDER_SEEDS.map((seed) => sql`${seed.name}`), sql`, `)})`,
  );
  const plan = planNewLenderSeeds(existing.map((lender) => lender.name));
  for (const seed of plan.toCreate) {
    await tx.insert(lendersTable).values(newLenderSeedToInsertValues(seed));
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
    if (existing.notes?.includes(update.marker)) {
      existingLenderUpdates.push({
        name: update.name,
        status: "already_applied" as const,
        patch: null,
      });
      continue;
    }

    await tx
      .update(lendersTable)
      .set({
        ...update.structuredPatch,
        notes: appendExistingLenderUpdateNotes(existing.notes, update.notes),
        updatedAt: new Date(),
      })
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
  const updatedExistingNames = existingLenderUpdates
    .filter((update) => update.status === "updated")
    .map((update) => update.name);
  const unchangedExistingNames = existingLenderUpdates
    .filter((update) => update.status === "already_applied")
    .map((update) => update.name);
  const missingExistingNames = existingLenderUpdates
    .filter((update) => update.status === "missing")
    .map((update) => update.name);
  return {
    created: plan.toCreate.length,
    unchanged: plan.unchangedNames.length,
    createdNames: plan.toCreate.map((seed) => seed.name),
    unchangedNames: plan.unchangedNames,
    existingLenderUpdates,
    updatedExistingNames,
    unchangedExistingNames,
    missingExistingNames,
    lenders,
  };
}

export async function seedNewLenders() {
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
