import { and, eq, exists, not } from "drizzle-orm";
import { db, dealsTable, leadsTable } from "@workspace/db";
import { activeDealStageCondition } from "./activeDealStages";

export type CampaignDealsRule = "all" | "open" | "exclude_open";

/** A correlated EXISTS includes each lead once; archived deals never count as open. */
export function campaignDealAudienceCondition(rule: CampaignDealsRule = "all") {
  if (rule === "all") return undefined;
  const openDeal = exists(db.select({ id: dealsTable.id }).from(dealsTable).where(and(
    eq(dealsTable.leadId, leadsTable.id),
    eq(dealsTable.isArchived, false),
    activeDealStageCondition(),
  )));
  return rule === "open" ? openDeal : not(openDeal);
}
