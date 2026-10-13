import { sql } from "drizzle-orm";

type Call = { id: number; twilioSid?: string | null; createdAt: Date; status: string; callOutcome: string | null };

/** Lifecycle updates for one provider call must not increment the badge. */
export function inboundCallCounts(calls: Call[]) {
  const groups = new Map<string, Call[]>();
  for (const call of calls) {
    const key = call.twilioSid?.trim() || `communication:${call.id}`;
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  let answered = 0, missed = 0, voicemail = 0, other = 0;
  for (const group of groups.values()) {
    if (group.some(c => c.callOutcome === "voicemail" || c.status === "voicemail")) voicemail++;
    else if (group.some(c => c.callOutcome === "connected" || c.status === "answered" ||
      (c.status === "completed" && !["no_answer", "busy", "wrong_number"].includes(c.callOutcome ?? "")))) answered++;
    else if (group.some(c => ["no_answer", "busy", "wrong_number"].includes(c.callOutcome ?? "") ||
      ["missed", "no-answer", "no_answer", "busy", "failed", "canceled", "cancelled"].includes(c.status))) missed++;
    else other++;
  }
  return { total: groups.size, answered, missed, voicemail, other };
}

/** Fixed trusted identifiers avoid Drizzle rewriting the outer correlation. */
export function pipelineMilestoneWhere(stage: "contacted" | "submitted_to_underwriting") {
  if (stage === "contacted") return sql`(
    "leads"."status" = 'contacted' OR EXISTS (
      SELECT 1 FROM "lead_status_history" h
      WHERE h."lead_id" = "leads"."id" AND h."to_status" = 'contacted'
    )
  )`;
  return sql`(
    "leads"."status" = 'submitted_to_underwriting' OR EXISTS (
      SELECT 1 FROM "lender_submissions" s WHERE s."lead_id" = "leads"."id"
    )
  )`;
}
