export const ORDINARY_SEED_DEAL_NAMES = [
  "Fastgrass Hydroseed LLC",
  "Heartlands Entertainment LLC",
  "University of Illinois",
  "Browns Farm",
  "Emerald Hydroturf",
  "Frisco Station Arcade",
  "Bryce Roder dba SETX Hydroseed",
  "Jim (Moss Deal)",
  "Wyatt (Kincaid Deal)",
  "Integrity Outdoor Services",
  "Jared Yost dba Tribal AG",
  "Cornell University",
  "Talya Friend",
  "Diamond AG",
  "Oregon Hydroseed",
  "AM Global Investments",
  "Slick City Water Park",
  "5 Boys Moving",
  "Erosion Specialist",
  "TP K1 Speed",
  "Jared Yost dba Tribal AG (funded tranche)",
] as const;

export const CALVIN_SEED_DEAL_NAMES = [
  "Mitchell & Vereen Transportation LLC",
  "Four Pillars",
  "Antleys",
  "R2Muse Trucking",
] as const;

export const ALL_SEED_DEAL_NAMES = [
  ...ORDINARY_SEED_DEAL_NAMES,
  ...CALVIN_SEED_DEAL_NAMES,
] as const;

export type SeededDealRow = {
  dealName: string;
  assignedTo: number | null;
  intendedRepSlug: string | null;
};

export type SeededAssignedUser = {
  id: number;
  slug: string | null;
};

/**
 * Pure precondition check for the maintenance transaction. Keeping this
 * separate makes it difficult for a future seed edit to silently broaden the
 * correction scope.
 */
export function validateSeededDealRows(
  rows: readonly SeededDealRow[],
  users: readonly SeededAssignedUser[],
): string | null {
  if (rows.length !== ALL_SEED_DEAL_NAMES.length) {
    return `Expected exactly ${ALL_SEED_DEAL_NAMES.length} seeded rows, found ${rows.length}`;
  }
  const expectedNames = new Set<string>(ALL_SEED_DEAL_NAMES);
  const ordinaryNames = new Set<string>(ORDINARY_SEED_DEAL_NAMES);
  const calvinNames = new Set<string>(CALVIN_SEED_DEAL_NAMES);
  const rowsByName = new Map<string, SeededDealRow>();
  for (const row of rows) {
    if (!expectedNames.has(row.dealName) || rowsByName.has(row.dealName)) {
      return "Seeded deal names must contain exactly one row for each expected name";
    }
    rowsByName.set(row.dealName, row);
  }
  if (rowsByName.size !== expectedNames.size) {
    return "Seeded deal names are missing an expected row";
  }

  const usersById = new Map(users.map((assignedUser) => [assignedUser.id, assignedUser]));
  for (const row of rows) {
    if (ordinaryNames.has(row.dealName)) {
      if (row.intendedRepSlug !== null || (row.assignedTo !== 7 && row.assignedTo !== 16)) {
        return `Ordinary seeded deal ${row.dealName} failed its ownership precondition`;
      }
      continue;
    }
    if (!calvinNames.has(row.dealName) || (row.intendedRepSlug !== null && row.intendedRepSlug !== "calvin")) {
      return `Reserved seeded deal ${row.dealName} failed its Calvin marker precondition`;
    }
    if (row.assignedTo !== null && row.assignedTo !== 7 && usersById.get(row.assignedTo)?.slug !== "calvin") {
      return `Reserved seeded deal ${row.dealName} has an invalid assignee`;
    }
  }
  return null;
}
