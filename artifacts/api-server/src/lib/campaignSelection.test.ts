import assert from "node:assert/strict";
import test from "node:test";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { campaignsTable } from "@workspace/db";
import { campaignSelection } from "./campaignSelection.ts";

test("compiled lifecycle/history subqueries correlate to the outer campaign", () => {
  const query = new QueryBuilder().select(campaignSelection).from(campaignsTable).toSQL();
  assert.equal([...query.sql.matchAll(/campaign_id = "campaigns"\."id"/g)].length, 5);
  assert.doesNotMatch(query.sql, /campaign_id = "id"/);
  assert.match(query.sql, /FROM campaign_launches l WHERE l\.campaign_id = "campaigns"\."id"\)/);
});
