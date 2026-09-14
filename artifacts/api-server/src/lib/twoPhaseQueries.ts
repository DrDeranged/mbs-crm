import { inArray } from "drizzle-orm";
import { dealsTable, leadsTable } from "@workspace/db/schema";

type QueryDatabase = {
  select: (fields: unknown) => any;
};

/**
 * Build the ID-only phase with the core select builder. Keeping this out of a
 * relational findMany is important: correlated SQL fragments must be rendered
 * against the physical outer table, not a relation alias.
 */
export function buildLeadPageIdsQuery(
  database: QueryDatabase,
  where: unknown,
  orderBy: unknown[],
  limit: number,
  offset: number,
) {
  return database
    .select({ id: leadsTable.id })
    .from(leadsTable)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);
}

export function buildDealPageIdsQuery(
  database: QueryDatabase,
  where: unknown,
  orderBy: unknown[],
  limit: number,
  offset: number,
) {
  return database
    .select({ id: dealsTable.id })
    .from(dealsTable)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);
}

export function buildLeadHydrationWhere(ids: readonly number[]) {
  return inArray(leadsTable.id, [...ids]);
}

export function buildDealHydrationWhere(ids: readonly number[]) {
  return inArray(dealsTable.id, [...ids]);
}

export function reorderByIds<T extends { id: number }>(rows: T[], ids: readonly number[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}