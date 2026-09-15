import { sql } from "drizzle-orm";
import { dealsTable } from "@workspace/db";

/** Dashboard funded GM: the stored raw actual GM, never a split allocation. */
export function fundedActualGmAggregate() {
  return sql<number>`cast(coalesce(sum(${dealsTable.actualGm}), 0) as int)`;
}