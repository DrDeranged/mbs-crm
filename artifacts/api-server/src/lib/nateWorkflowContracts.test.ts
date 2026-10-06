import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { eligibleAssignmentCondition, assignmentDisplayName } from "./assignmentEligibility";
import { campaignDealAudienceCondition } from "./campaignDealAudience";
import { ACTIVE_DEAL_STAGES } from "./activeDealStages";

test("assignment destination SQL includes every active non-pending non-merged staff role", () => {
  const query = new PgDialect().sqlToQuery(eligibleAssignmentCondition(7)!);
  assert.match(query.sql, /is_active/);
  assert.match(query.sql, /merged_into_user_id.*is null/);
  assert.deepEqual(query.params, [7, true, "admin", "manager", "rep"]);
  assert.equal(assignmentDisplayName({ name: " ", email: "ada@example.invalid" }), "ada");
  assert.equal(assignmentDisplayName({ name: " Bea ", email: "zzz@example.invalid" }), "Bea");
});

test("campaign deals default is unrestricted; open/exclude use complementary correlated existence", () => {
  assert.equal(campaignDealAudienceCondition(), undefined);
  assert.equal(campaignDealAudienceCondition("all"), undefined);
  const dialect = new PgDialect();
  const open = dialect.sqlToQuery(campaignDealAudienceCondition("open")!);
  const exclude = dialect.sqlToQuery(campaignDealAudienceCondition("exclude_open")!);
  assert.match(open.sql, /exists \(select/);
  assert.match(open.sql, /"deals"\."lead_id" = "leads"\."id"/);
  assert.match(open.sql, /"deals"\."is_archived" =/);
  assert.equal(exclude.sql, `not ${open.sql}`);
  assert.deepEqual(open.params, [false, ...ACTIVE_DEAL_STAGES]);
  assert.deepEqual(exclude.params, open.params);
  for (const closed of ["funded", "declined", "dead", "hold_on"] as const) assert(!open.params.includes(closed));
});

test("lead list accepts exact imported source values without changing their spelling", async () => {
  const { listLeadsQuery } = await import("../routes/leads");
  for (const leadSource of ["US Fund Advisor", "vendor_list", "prospect_list", "Website"]) {
    assert.equal(listLeadsQuery.parse({ leadSource }).leadSource, leadSource);
  }
});
