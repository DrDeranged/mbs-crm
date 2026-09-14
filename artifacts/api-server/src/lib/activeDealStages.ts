import { inArray } from "drizzle-orm";
import { dealsTable, DEAL_STAGES } from "@workspace/db/schema";

export const ACTIVE_DEAL_STAGES = DEAL_STAGES.filter(
  (stage) => !["funded", "declined", "dead", "hold_on"].includes(stage),
);

export function activeDealStageCondition() {
  return inArray(dealsTable.stage, ACTIVE_DEAL_STAGES);
}