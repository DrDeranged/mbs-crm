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

export function selectMatchingSeededDealRows<Row extends SeededDealRow>(
  rows: readonly Row[],
  users: readonly SeededAssignedUser[],
): Row[] {
  const ordinaryNames = new Set<string>(ORDINARY_SEED_DEAL_NAMES);
  const calvinNames = new Set<string>(CALVIN_SEED_DEAL_NAMES);
  const usersById = new Map(users.map((assignedUser) => [assignedUser.id, assignedUser]));

  return rows.filter((row) => {
    if (ordinaryNames.has(row.dealName)) {
      return row.intendedRepSlug === null && (row.assignedTo === 7 || row.assignedTo === 16);
    }
    if (!calvinNames.has(row.dealName) || (row.intendedRepSlug !== null && row.intendedRepSlug !== "calvin")) {
      return false;
    }
    return row.assignedTo === null
      || row.assignedTo === 7
      || usersById.get(row.assignedTo)?.slug === "calvin";
  });
}

/**
 * Pure precondition check for the maintenance transaction. Keeping this
 * separate makes it difficult for a future seed edit to silently broaden the
 * correction scope.
 */
export function validateSeededDealRows(
  rows: readonly SeededDealRow[],
  users: readonly SeededAssignedUser[],
): string | null {
  const matchingRows = selectMatchingSeededDealRows(rows, users);
  if (matchingRows.length === 0) {
    return `No matching seeded rows found (0 of ${ALL_SEED_DEAL_NAMES.length})`;
  }
  const rowsByName = new Map<string, SeededDealRow>();
  for (const row of matchingRows) {
    if (rowsByName.has(row.dealName)) {
      return `Multiple matching seeded rows found for ${row.dealName}`;
    }
    rowsByName.set(row.dealName, row);
  }
  return null;
}
