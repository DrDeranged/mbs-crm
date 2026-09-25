export type CampaignChannel = "email" | "sms" | "email_sms";
export type CampaignStatus = "draft" | "approved" | "scheduled" | "running" | "paused" | "completed" | "cancelled" | "failed";

import { createHash } from "node:crypto";
import { EMAIL_BRAND_LOGO_URL } from "./brand";

/** Stable JSON encoding prevents object key ordering from changing an approval hash. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function campaignContentHash(content: unknown): string {
  return createHash("sha256").update(stableJson(content)).digest("hex");
}

export function buildCampaignFlyerAttachment(flyer: {
  bytes: Buffer;
  name: string;
  contentType: string;
} | null) {
  if (!flyer) return undefined;
  const filename = flyer.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "campaign-flyer";
  return [{
    content: flyer.bytes.toString("base64"),
    filename,
    type: flyer.contentType,
    disposition: "attachment" as const,
  }];
}

export function approvedFlyerMatches(
  approved: { digest?: string; generation?: string } | null | undefined,
  current: { digest?: string; generation?: string } | null | undefined,
): boolean {
  return (approved?.digest ?? null) === (current?.digest ?? null) &&
    (approved?.generation ?? null) === (current?.generation ?? null);
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

export function campaignPlainText(bodyHtml: string): string {
  return decodeBasicEntities(bodyHtml
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const CAMPAIGN_LOGO_URL = EMAIL_BRAND_LOGO_URL;

export const DEFAULT_CAMPAIGN_REPLY_TO = "nate@my-business-solutions.com";

export function nextBusinessDayInNewYork(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).reduce<Record<string, string>>((out, part) => {
    out[part.type] = part.value;
    return out;
  }, {});
  const next = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 13));
  do next.setUTCDate(next.getUTCDate() + 1); while ([0, 6].includes(next.getUTCDay()));
  return next;
}

export function deferEligibleRecipients<T extends { status: string; availableAt?: Date | null }>(
  rows: T[], availableAt: Date,
): T[] {
  return rows.map((row) => row.status === "eligible" ? { ...row, status: "deferred", availableAt } : row);
}

export function selectDueResumeCandidates<T extends { status: string; availableAt?: Date | null }>(
  rows: T[], now: Date,
): T[] {
  return rows.filter((row) => row.status === "deferred" && (!row.availableAt || row.availableAt <= now));
}

export function isFutureCampaignSchedule(scheduledAt: Date | null | undefined, now = new Date()): boolean {
  return Boolean(scheduledAt && scheduledAt > now);
}

export function minimalCampaignHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return `<p><img src="${CAMPAIGN_LOGO_URL}" alt="My Business Solutions" width="160" height="40"></p>` +
    escaped.split(/\n{2,}/).map((paragraph) =>
      `<p>${paragraph.replace(/\n/g, "<br>")}</p>`).join("");
}

/** Merge tokens supported by the campaign renderer.  Keep this deliberately
 * strict: silently leaving a token in a live message is worse than blocking
 * approval. */
export const CAMPAIGN_MERGE_TOKENS = [
  "lead_first_name", "lead_last_name", "lead_company", "lead_email",
  "lead_phone", "rep_name", "rep_phone", "rep_email",
] as const;

export function unknownCampaignMergeTokens(value: string): string[] {
  const unknown = new Set<string>();
  for (const match of value.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)) {
    if (!(CAMPAIGN_MERGE_TOKENS as readonly string[]).includes(match[1])) unknown.add(match[1]);
  }
  return [...unknown];
}

export function assignedRepReplyTo(rep: { name?: string | null; email?: string | null } | null | undefined): { name?: string; email?: string } | undefined {
  const email = rep?.email?.trim();
  if (!email) return undefined;
  return { email, ...(rep?.name?.trim() ? { name: rep.name.trim() } : {}) };
}

export function sameKeyResumeDecision(input: {
  sameCampaign: boolean;
  launchStatus: string;
  campaignStatus: string;
}): "resume" | "return_existing" | "reject" {
  if (!input.sameCampaign) return "reject";
  if (["queued", "running"].includes(input.launchStatus) && input.campaignStatus === "running") return "resume";
  return "return_existing";
}

export function eligibleResumeCandidates<T extends { status: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.status === "eligible");
}

export function summarizeRecipientLedger(rows: Array<{ status: string; exclusionReason?: string | null }>) {
  const sent = rows.filter((row) => row.status === "sent").length;
  const eligible = rows.filter((row) => row.status === "eligible").length;
  const uncertain = rows.filter((row) => row.status === "queued").length;
  const failed = rows.filter((row) => row.status === "failed" ||
    (row.status === "excluded" && ["unsubscribed", "email_suppressed"].includes(row.exclusionReason ?? ""))).length;
  return { sent, failed, eligible, uncertain, terminalStatus: uncertain || eligible || (failed > 0 && sent === 0) ? "failed" : "completed" as const };
}

export function canAcquireExecutionLease(existingToken: string | null, expiresAt: Date | null, now: Date): boolean {
  return !existingToken || !expiresAt || expiresAt <= now;
}

export function selectResumeClaimOutcome(rows: Array<{ status: string }>): Array<"claimed" | "already_processed"> {
  return rows.map((row) => row.status === "eligible" ? "claimed" : "already_processed");
}

export function canManageCampaign(user: { role: string }): boolean {
  return user.role === "admin" || user.role === "manager";
}

export function isSmsLaunchUnsupported(channel: CampaignChannel): boolean {
  return channel === "sms" || channel === "email_sms";
}

export function canTransitionCampaign(from: CampaignStatus, to: CampaignStatus): boolean {
  const allowed: Record<CampaignStatus, CampaignStatus[]> = {
    draft: ["approved", "cancelled"],
    approved: ["draft", "scheduled", "running", "paused", "cancelled"],
    scheduled: ["paused", "cancelled", "running"],
    running: ["paused", "cancelled", "completed", "failed"],
    paused: ["approved", "scheduled", "running", "cancelled"],
    completed: [],
    cancelled: [],
    failed: ["draft"],
  };
  return from === to || allowed[from].includes(to);
}

export function hasCurrentApproval(
  approval: { contentVersion: number; invalidatedAt: Date | null; contentHash?: string; claimsAffirmed?: boolean } | null | undefined,
  version: number,
  contentHash?: string,
): boolean {
  return Boolean(approval && approval.contentVersion === version && approval.invalidatedAt == null &&
    (contentHash === undefined || approval.contentHash === contentHash) &&
    approval.claimsAffirmed !== false);
}

export function campaignFailureState(): { campaign: "failed"; launch: "failed" } {
  return { campaign: "failed", launch: "failed" };
}

export function campaignStatusAfterLaunch(
  current: CampaignStatus,
  scheduled: boolean,
): CampaignStatus {
  return scheduled ? "scheduled" : current;
}

export function classifyEmailRecipient(input: {
  email: string | null;
  duplicate: boolean;
  unsubscribed: boolean;
  suppressed: boolean;
  capacityAvailable: boolean;
}): "missing_contact_info" | "duplicate_email" | "email_unsubscribed" | "email_suppressed" | "daily_email_capacity" | "eligible" {
  if (!input.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return "missing_contact_info";
  if (input.duplicate) return "duplicate_email";
  if (input.unsubscribed) return "email_unsubscribed";
  if (input.suppressed) return "email_suppressed";
  if (!input.capacityAvailable) return "daily_email_capacity";
  return "eligible";
}

export type CampaignRecipientOrigin = "filtered" | "picked";

/** Manual selections without explicit filters form a picked-only audience. */
export function includeCampaignFilterMatches(filterCount: number, pickedCount: number): boolean {
  return filterCount > 0 || pickedCount === 0;
}

/** Combines matching and manually picked IDs; a manual pick takes origin precedence. */
export function unionCampaignAudience<T extends { id: number }>(
  filterMatches: T[],
  pickedLeads: T[],
): Array<T & { origin: CampaignRecipientOrigin }> {
  const byId = new Map<number, T & { origin: CampaignRecipientOrigin }>();
  for (const lead of filterMatches) byId.set(lead.id, { ...lead, origin: "filtered" });
  for (const lead of pickedLeads) byId.set(lead.id, { ...lead, origin: "picked" });
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export function campaignExclusionReasonCounts(exclusions: Array<{ reason: string; channel?: string }>) {
  const counts = { noEmail: 0, unsubscribed: 0, suppressed: 0, alreadySent: 0, duplicate: 0, other: 0 };
  for (const { reason, channel } of exclusions) {
    if (reason === "missing_contact_info" && (channel == null || channel === "email")) counts.noEmail++;
    else if (reason === "email_unsubscribed" || reason.includes("unsubscribed")) counts.unsubscribed++;
    else if (reason === "email_suppressed" || reason.includes("suppressed")) counts.suppressed++;
    else if (reason === "already_sent") counts.alreadySent++;
    else if (reason === "duplicate_email" || reason === "duplicate_phone") counts.duplicate++;
    else counts.other++;
  }
  return counts;
}

export function classifySmsRecipient(input: {
  phone: string | null;
  duplicate: boolean;
  eligible: boolean;
  reason?: string;
}): "missing_contact_info" | "duplicate_phone" | "sms_launch_not_supported" | string {
  if (!input.phone?.trim()) return "missing_contact_info";
  if (input.duplicate) return "duplicate_phone";
  if (!input.eligible) return input.reason || "sms_ineligible";
  return "sms_launch_not_supported";
}
