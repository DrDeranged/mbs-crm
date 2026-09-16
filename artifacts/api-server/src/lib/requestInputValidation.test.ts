import test from "node:test";
import assert from "node:assert/strict";
import { errorsQuery } from "../routes/adminErrors";
import { purgeBody } from "../routes/adminGovernance";
import { analyticsQuery } from "../routes/analytics";
import { complianceLogQuery } from "../routes/credit";
import { dealListQuery } from "../routes/deals";
import { listLeadsQuery } from "../routes/leads";
import { notificationsQuery } from "../routes/notifications";
import { piiLogQuery } from "../routes/piiAccessLog";

const invalidCases = [
  ["admin errors page", errorsQuery, { page: "zero" }, "page"],
  ["governance purge confirmation", purgeBody, { confirm: false }, "confirm"],
  ["analytics rep", analyticsQuery, { rep_id: "none" }, "rep_id"],
  ["credit log date", complianceLogQuery, { startDate: "not-a-date" }, "startDate"],
  ["deal list sort", dealListQuery, { sort_by: "invalid-sort" }, "sort_by"],
  ["lead list status", listLeadsQuery, { status: "invalid-status" }, "status"],
  ["notification page", notificationsQuery, { page: "0" }, "page"],
  ["PII log category", piiLogQuery, { category: "unknown" }, "category"],
] as const;

for (const [name, schema, input, field] of invalidCases) {
  test(`${name} rejects malformed input with its field`, () => {
    const parsed = schema.safeParse(input);
    assert.equal(parsed.success, false);
    if (!parsed.success) assert.equal(parsed.error.issues[0]?.path.join("."), field);
  });
}