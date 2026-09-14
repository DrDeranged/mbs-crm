import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect, PgSelectBuilder } from "drizzle-orm/pg-core";
import { asc, sql } from "drizzle-orm";
import { leadsTable, dealsTable } from "@workspace/db/schema";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { buildStaleLeadCondition } from "./staleLeadCondition.ts";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { latestDealActivitySort } from "./latestActivitySort.ts";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { activeDealStageCondition, ACTIVE_DEAL_STAGES } from "./activeDealStages.ts";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { buildDealHydrationWhere, buildDealPageIdsQuery, buildLeadHydrationWhere, buildLeadPageIdsQuery } from "./twoPhaseQueries.ts";

const dialect = new PgDialect();
const NOW = Date.parse("2025-01-08T00:00:00.000Z");

function selectWithWhere(table: typeof leadsTable | typeof dealsTable, where: any) {
  const builder = new PgSelectBuilder({
    fields: undefined,
    session: undefined,
    dialect,
    withList: [],
    distinct: false,
  });
  return dialect.sqlToQuery(builder.from(table).where(where).getSQL());
}

function queryDatabase() {
  return {
    select: (fields: unknown) => new PgSelectBuilder({
      fields: fields as any,
      session: undefined,
      dialect,
      withList: [],
      distinct: false,
    }),
  };
}

test("normal leads select compiles stale condition with a stable correlated alias", () => {
  const query = selectWithWhere(leadsTable, buildStaleLeadCondition(7, NOW));
  assert.match(query.sql, /from "activity_log" as "stale_lead_activity"/);
  assert.match(query.sql, /"stale_lead_activity"\."lead_id" = "leads"\."id"/);
  assert.match(query.sql, /"leads"\."created_at"/);
  assert.match(query.sql, /"leads"\."created_at"\s*\) < \$1/);
  assert.equal((query.params[0] as Date).getTime(), NOW - 7 * 24 * 60 * 60 * 1000);

  const countQuery = dialect.sqlToQuery(sql`select count(*) from ${leadsTable} where ${buildStaleLeadCondition(7, NOW)}`);
  assert.match(countQuery.sql, /select count\(\*\) from "leads".*stale_lead_activity/s);
  assert.match(countQuery.sql, /"stale_lead_activity"\."lead_id" = "leads"\."id"/);
});

test("latest activity sort expressions compile with an explicit activity alias", () => {
  const first = selectWithWhere(dealsTable, latestDealActivitySort());
  const second = selectWithWhere(dealsTable, latestDealActivitySort());
  for (const query of [first, second]) {
    assert.match(query.sql, /max\("latest_deal_activity"\."created_at"\)/);
    assert.match(query.sql, /from "activity_log" as "latest_deal_activity"/);
    assert.match(query.sql, /"latest_deal_activity"\."deal_id" = "deals"\."id"/);
  }
});

test("active stages compile as inArray parameters rather than raw SQL", () => {
  const query = selectWithWhere(dealsTable, activeDealStageCondition());
  assert.match(query.sql, /"deals"\."stage" in \(\$1,/);
  assert.equal(query.params.length, ACTIVE_DEAL_STAGES.length);
  assert.deepEqual(query.params, ACTIVE_DEAL_STAGES);
  for (const stage of ACTIVE_DEAL_STAGES) assert.equal(query.sql.includes(stage), false);
});

test("two-phase lead and deal ID queries keep correlated SQL out of relational hydration", () => {
  const database = queryDatabase();
  const staleIds = buildLeadPageIdsQuery(
    database,
    buildStaleLeadCondition(7, NOW),
    [asc(leadsTable.createdAt), asc(leadsTable.id)],
    25,
    50,
  );
  const staleIdSql = dialect.sqlToQuery(staleIds.getSQL());
  assert.match(staleIdSql.sql, /select "id" from "leads" where .*stale_lead_activity/s);
  assert.match(staleIdSql.sql, /order by "leads"\."created_at" asc, "leads"\."id" asc/);

  const leadHydration = selectWithWhere(leadsTable, buildLeadHydrationWhere([11, 12]));
  assert.match(leadHydration.sql, /"leads"\."id" in \(\$1, \$2\)/);
  assert.doesNotMatch(leadHydration.sql, /stale_lead_activity|coalesce/);

  const dealIds = buildDealPageIdsQuery(
    database,
    activeDealStageCondition(),
    [],
    1000,
    0,
  );
  const dealIdSql = dialect.sqlToQuery(dealIds.getSQL());
  assert.match(dealIdSql.sql, /select "id" from "deals" where/);
  const dealHydration = selectWithWhere(dealsTable, buildDealHydrationWhere([21, 22]));
  assert.match(dealHydration.sql, /"deals"\."id" in \(\$1, \$2\)/);
  assert.doesNotMatch(dealHydration.sql, /latest_deal_activity|select max/);
});