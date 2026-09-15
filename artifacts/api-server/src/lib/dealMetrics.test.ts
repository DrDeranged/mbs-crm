import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { dealsTable } from "@workspace/db";
import { fundedActualGmAggregate } from "./dealMetrics";

test("production funded GM aggregate sums raw actualGm without split multiplication", () => {
  const query = new PgDialect().sqlToQuery(
    fundedActualGmAggregate().getSQL(),
  );
  assert.match(query.sql, /coalesce\(sum\("deals"\."actual_gm"\), 0\)/);
  assert.doesNotMatch(query.sql, /gm_split_pct|actual_gm.*\*|gm_split_pct.*\*/);
  assert.equal(query.params.length, 0);
  assert.equal(dealsTable.gmSplitPct.name, "gm_split_pct");
});