import Anthropic from "@anthropic-ai/sdk";
import { db } from "@workspace/db";
import {
  activityLogTable,
  companiesTable,
  lenderMatchesTable,
  leadsTable,
} from "@workspace/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";

const anthropic = new Anthropic({
  baseURL: process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"],
  apiKey: process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] ?? "dummy",
});

export interface LeadBriefing {
  snapshot: string;
  financialPicture: string;
  engagementHistory: string;
  risks: string[];
  nextBestActions: string[];
}

export interface AiDraft {
  subject?: string;
  body: string;
}

/**
 * Redacts sensitive patterns from free-text (rep-authored notes, SMS bodies)
 * before it is ever included in an AI prompt. This is a defense-in-depth
 * measure on top of only selecting non-sensitive structured fields: notes
 * and message bodies are free text that a rep could paste an SSN, DOB,
 * account number, or street address into.
 */
function redactSensitiveText(text: string): string {
  if (!text) return text;
  let result = text;
  // Email addresses
  result = result.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED-EMAIL]");
  // North American phone numbers, including optional country code and common punctuation
  result = result.replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[REDACTED-PHONE]");
  // SSNs: 123-45-6789, 123 45 6789, or 9 consecutive digits
  result = result.replace(/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, "[REDACTED-SSN]");
  // Dates of birth / general dates in common formats (MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD)
  result = result.replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, "[REDACTED-DATE]");
  result = result.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[REDACTED-DATE]");
  // Long digit runs that look like account/routing numbers (8+ consecutive digits)
  result = result.replace(/\b\d{8,}\b/g, "[REDACTED-NUMBER]");
  // Street addresses: "123 Main St", "456 Oak Avenue Apt 2", etc.
  result = result.replace(
    /\b\d{1,6}\s+([A-Za-z0-9.'-]+\s){1,4}(Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Road|Rd|Way|Court|Ct|Circle|Cir|Place|Pl|Terrace|Ter|Highway|Hwy|Parkway|Pkwy)\.?\b[^,.\n]*/gi,
    "[REDACTED-ADDRESS]",
  );
  // PO boxes and ZIP codes
  result = result.replace(/\bP\.?\s*O\.?\s+Box\s+\d+\b/gi, "[REDACTED-ADDRESS]");
  result = result.replace(/\b\d{5}(?:-\d{4})?\b/g, "[REDACTED-ZIP]");
  return result;
}

/**
 * Builds a plain-text, privacy-safe summary of a lead for use in AI prompts.
 * By construction this NEVER includes SSNs, dates of birth, home/business addresses,
 * raw or encrypted payloads, or full account numbers — only masked/aggregate
 * financial data and non-sensitive lead info.
 */
export async function buildLeadContext(leadId: number): Promise<string> {
  const lead = await db.query.leadsTable.findFirst({
    where: eq(leadsTable.id, leadId),
    with: {
      assignedRep: true,
      company: true,
      notes: { with: { author: true }, orderBy: (t, { desc }) => [desc(t.createdAt)], limit: 5 },
      tasks: { orderBy: (t, { asc }) => [asc(t.isCompleted), asc(t.dueDate)], limit: 10 },
      communications: { orderBy: (t, { desc }) => [desc(t.createdAt)], limit: 8 },
      emailSends: { orderBy: (t, { desc }) => [desc(t.createdAt)], limit: 5 },
      lenderMatches: { with: { lender: true }, orderBy: (t, { desc }) => [desc(t.matchScore)], limit: 5 },
    },
  });

  if (!lead) {
    throw new Error("Lead not found");
  }

  const lines: string[] = [];

  lines.push(`# Lead Overview`);
  lines.push(`Name: ${[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown"}`);
  lines.push(`Company: ${lead.companyName || "Unknown"}`);
  lines.push(`Financing type requested: ${lead.applicationType}`);
  lines.push(`Requested amount: ${lead.requestedAmount != null ? `$${lead.requestedAmount.toLocaleString()}` : "Unknown"}`);
  lines.push(`Current status: ${lead.status.replace(/_/g, " ")}`);
  lines.push(`Lead source: ${lead.leadSource}`);
  lines.push(`Assigned rep: ${lead.assignedRep?.name || "Unassigned"}`);
  if (lead.leadScore != null) lines.push(`Lead score: ${lead.leadScore}/100`);
  if (lead.creditScore != null) lines.push(`Most recent credit score: ${lead.creditScore}`);
  if (lead.existingPositions != null) lines.push(`Number of existing financing positions: ${lead.existingPositions}`);
  lines.push(`Lead created: ${lead.createdAt.toISOString().slice(0, 10)}`);
  if (lead.lastActivityAt) lines.push(`Last activity: ${lead.lastActivityAt.toISOString().slice(0, 10)}`);

  if (lead.company) {
    lines.push(``, `# Company Info`);
    if (lead.company.industry) lines.push(`Industry: ${lead.company.industry}`);
    if (lead.company.timeInBusinessMonths != null) lines.push(`Time in business: ${lead.company.timeInBusinessMonths} months`);
    if (lead.company.annualRevenue != null) lines.push(`Annual revenue: $${Number(lead.company.annualRevenue).toLocaleString()}`);
    if (lead.company.state) lines.push(`State: ${lead.company.state}`);
  }

  const extractions = await db.query.bankStatementExtractionsTable.findMany({
    where: (t, { eq }) => eq(t.leadId, leadId),
    orderBy: (t, { desc }) => [desc(t.extractedAt)],
    limit: 3,
  });
  if (extractions.length > 0) {
    lines.push(``, `# Aggregate Bank Statement Financials (most recent ${extractions.length} statement(s))`);
    for (const ext of extractions) {
      const period = ext.statementMonth && ext.statementYear ? `${ext.statementMonth}/${ext.statementYear}` : "Unknown period";
      lines.push(
        `- ${period}: total deposits ${ext.totalDeposits != null ? `$${Number(ext.totalDeposits).toLocaleString()}` : "unknown"}, ` +
        `avg daily balance ${ext.averageDailyBalance != null ? `$${Number(ext.averageDailyBalance).toLocaleString()}` : "unknown"}, ` +
        `NSF count ${ext.nsfCount}, negative balance days ${ext.negativeBalanceDays}`,
      );
    }
  }

  const creditPull = await db.query.creditPullsTable.findFirst({
    where: (t, { eq }) => eq(t.leadId, leadId),
    orderBy: (t, { desc: d }) => [d(t.createdAt)],
  });
  if (creditPull?.creditScore != null) {
    lines.push(``, `# Credit`, `Most recent credit score on file: ${creditPull.creditScore}`);
  }

  if (lead.notes.length > 0) {
    lines.push(``, `# Recent Notes`);
    for (const n of lead.notes) {
      lines.push(`- (${n.createdAt.toISOString().slice(0, 10)}, ${n.author?.name || "rep"}): ${redactSensitiveText(n.body)}`);
    }
  }

  if (lead.communications.length > 0) {
    lines.push(``, `# Recent Communications`);
    for (const c of lead.communications) {
      const date = c.createdAt.toISOString().slice(0, 10);
      if (c.type === "call") {
        lines.push(`- ${date}: ${c.direction} call, outcome: ${c.callOutcome || c.status}${c.durationSeconds ? `, ${c.durationSeconds}s` : ""}`);
      } else {
        lines.push(`- ${date}: ${c.direction} SMS: "${redactSensitiveText((c.body || "").slice(0, 200))}"`);
      }
    }
  }

  if (lead.emailSends.length > 0) {
    lines.push(``, `# Recent Emails`);
    for (const e of lead.emailSends) {
      lines.push(`- ${e.createdAt.toISOString().slice(0, 10)}: "${redactSensitiveText(e.subject || "")}" — status: ${e.status}`);
    }
  }

  lines.push(``, `# Current Lender-Match State`);
  if (lead.lenderMatches.length > 0) {
    for (const m of lead.lenderMatches) {
      lines.push(`- ${m.lender.name} (match score ${m.matchScore}/100)`);
    }
  } else {
    lines.push(`No lender matches have been calculated yet.`);
  }

  const openTasks = lead.tasks.filter((t) => !t.isCompleted);
  if (openTasks.length > 0) {
    lines.push(``, `# Open Tasks`);
    for (const t of openTasks) {
      lines.push(`- ${redactSensitiveText(t.title)}${t.dueDate ? ` (due ${t.dueDate})` : ""}`);
    }
  }

  return lines.join("\n");
}

const BRIEFING_PROMPT = `You are a sales operations assistant for a commercial lending CRM. Given the lead context below, produce a concise sales briefing for the rep about to work this deal.

Return ONLY valid JSON with this exact structure:
{
  "snapshot": "<1-2 sentence overview of who this lead is and where the deal stands>",
  "financialPicture": "<summary of the financial data available, or note if insufficient data>",
  "engagementHistory": "<summary of past communications/notes/interactions>",
  "risks": ["<risk 1>", "<risk 2>", ...],
  "nextBestActions": ["<action 1>", "<action 2>", ...]
}

Rules:
- Base everything strictly on the provided context. Do not invent facts, figures, or history not present in the context.
- If data is missing for a section, say so plainly rather than guessing.
- Keep risks and nextBestActions to 2-4 items each, short and actionable.
- Do not include any text outside the JSON object.

Lead context:
`;

export async function generateLeadBriefing(leadId: number): Promise<LeadBriefing> {
  const context = await buildLeadContext(leadId);

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{ role: "user", content: BRIEFING_PROMPT + context }],
  });

  const rawText = message.content[0]?.type === "text" ? message.content[0].text : "{}";

  let parsed: Record<string, unknown> = {};
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    parsed = {};
  }

  const briefing: LeadBriefing = {
    snapshot: typeof parsed["snapshot"] === "string" ? parsed["snapshot"] : "",
    financialPicture: typeof parsed["financialPicture"] === "string" ? parsed["financialPicture"] : "",
    engagementHistory: typeof parsed["engagementHistory"] === "string" ? parsed["engagementHistory"] : "",
    risks: Array.isArray(parsed["risks"]) ? (parsed["risks"] as string[]).filter((r) => typeof r === "string") : [],
    nextBestActions: Array.isArray(parsed["nextBestActions"])
      ? (parsed["nextBestActions"] as string[]).filter((a) => typeof a === "string")
      : [],
  };

  await db
    .update(leadsTable)
    .set({ aiSummary: briefing as any, aiSummaryGeneratedAt: new Date() })
    .where(eq(leadsTable.id, leadId));

  return briefing;
}

export interface PipelineDigestLead {
  leadId: number;
  name: string;
  industry: string;
  why: string;
}

export interface PipelineDigest {
  overview: string;
  recommendations: string[];
  topLeads: PipelineDigestLead[];
  generatedAt: string;
}

interface PipelineDigestScope {
  userId: number;
  role: string;
}

interface PipelineDigestCacheEntry {
  expiresAt: number;
  digest: PipelineDigest;
}

const pipelineDigestCache = new Map<string, PipelineDigestCacheEntry>();
const PIPELINE_DIGEST_CACHE_MS = 60 * 60 * 1000;

const PIPELINE_DIGEST_SYSTEM = `You are a sales operations assistant for a commercial lending CRM.
Create a concise daily pipeline briefing from the supplied aggregates and candidate companies.

HARD RULES:
- Base every statement strictly on the supplied data. Never invent facts, figures, activity, or lender decisions.
- The data contains aggregate buckets and company names only. Do not request or infer contact details or other personal information.
- Recommendations are operational guidance only. Never promise approval, funding, rates, terms, or eligibility.
- Return ONLY valid JSON with this exact structure:
{
  "overview": "<2-3 concise sentences>",
  "recommendations": ["<focus recommendation 1>", "<focus recommendation 2>", "<focus recommendation 3>"],
  "topLeads": [
    {"leadId": 123, "name": "<company name>", "industry": "<industry or Unknown>", "why": "<specific reason grounded in the supplied candidate data>"}
  ]
}
- Return exactly 3 recommendations and no more than 5 topLeads.
- Do not include markdown or any text outside the JSON object.`;

function parseJsonObject(rawText: string): Record<string, unknown> {
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    return {};
  }
}

function incrementBucket(buckets: Record<string, number>, value: string | null | undefined) {
  const key = value?.trim() || "Unknown";
  buckets[key] = (buckets[key] ?? 0) + 1;
}

function containsProhibitedPromise(text: string): boolean {
  return /\b(guarantee(?:d)?|promise(?:d)?|assur(?:e|ed)|certain(?:ly)?|definite(?:ly)?)\b.{0,40}\b(approval|approved|funding|funded|rate|terms?|eligib(?:le|ility))\b/i.test(text)
    || /\b(approval|funding|rate|terms?|eligib(?:le|ility))\b.{0,40}\b(guarantee(?:d)?|promise(?:d)?|assur(?:e|ed)|certain(?:ly)?|definite(?:ly)?)\b/i.test(text)
    || /\b(auto(?:matically)?[- ]?send|send automatically|will send (?:an? )?(?:email|sms|message))\b/i.test(text);
}

function safeModelStrings(value: unknown, count: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  if (strings.length !== count || strings.some((item) => item.length > 600 || containsProhibitedPromise(item))) {
    return null;
  }
  return strings;
}

export async function generatePipelineDigest(scope: PipelineDigestScope): Promise<PipelineDigest> {
  const repFilter = scope.role === "rep" ? eq(leadsTable.assignedRepId, scope.userId) : undefined;
  const leads = await db
    .select({
      leadId: leadsTable.id,
      companyName: leadsTable.companyName,
      applicationType: leadsTable.applicationType,
      leadSource: leadsTable.leadSource,
      status: leadsTable.status,
      requestedAmount: leadsTable.requestedAmount,
      creditScore: leadsTable.creditScore,
      lastActivityAt: leadsTable.lastActivityAt,
      industry: companiesTable.industry,
      state: companiesTable.state,
      matchCount: sql<number>`cast(count(${lenderMatchesTable.id}) as int)`,
    })
    .from(leadsTable)
    .leftJoin(companiesTable, eq(companiesTable.leadId, leadsTable.id))
    .leftJoin(lenderMatchesTable, eq(lenderMatchesTable.leadId, leadsTable.id))
    .where(repFilter)
    .groupBy(
      leadsTable.id,
      leadsTable.companyName,
      leadsTable.applicationType,
      leadsTable.leadSource,
      leadsTable.status,
      leadsTable.requestedAmount,
      leadsTable.creditScore,
      leadsTable.lastActivityAt,
      companiesTable.industry,
      companiesTable.state,
    );

  const recentActivitySince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentActivity = await db
    .select({
      action: activityLogTable.action,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(activityLogTable)
    .innerJoin(leadsTable, eq(activityLogTable.leadId, leadsTable.id))
    .where(and(gte(activityLogTable.createdAt, recentActivitySince), repFilter))
    .groupBy(activityLogTable.action);

  const bySource: Record<string, number> = {};
  const byIndustry: Record<string, number> = {};
  const byState: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let missingAmount = 0;
  let missingCredit = 0;

  for (const lead of leads) {
    incrementBucket(bySource, lead.leadSource);
    incrementBucket(byIndustry, lead.industry);
    incrementBucket(byState, lead.state);
    incrementBucket(byType, lead.applicationType);
    if (lead.requestedAmount == null) missingAmount += 1;
    if (lead.creditScore == null) missingCredit += 1;
  }

  const activeStatuses = new Set(["new_lead", "contacted", "application_received", "follow_up", "submitted_to_underwriting"]);
  const now = Date.now();
  const attentionCandidates = leads
    .map((lead) => {
      const daysSinceActivity = lead.lastActivityAt
        ? Math.max(0, (now - lead.lastActivityAt.getTime()) / (24 * 60 * 60 * 1000))
        : Number.POSITIVE_INFINITY;
      const score =
        (activeStatuses.has(lead.status) ? 2 : 0) +
        (lead.matchCount === 0 ? 2 : 0) +
        (lead.requestedAmount == null ? 2 : 0) +
        (lead.creditScore == null ? 2 : 0) +
        (daysSinceActivity > 7 ? 2 : 0);
      return { ...lead, attentionScore: score, daysSinceActivity };
    })
    .sort((a, b) => b.attentionScore - a.attentionScore || a.leadId - b.leadId)
    .slice(0, 5);

  const aggregateContext = JSON.stringify({
    totalLeads: leads.length,
    countsBySource: bySource,
    countsByIndustry: byIndustry,
    countsByState: byState,
    countsByFinancingType: byType,
    leadsWithLenderMatches: leads.filter((lead) => lead.matchCount > 0).length,
    missingRequestedAmount: missingAmount,
    missingCreditScore: missingCredit,
    recentActivityLast7Days: {
      total: recentActivity.reduce((sum, row) => sum + row.count, 0),
      byAction: Object.fromEntries(recentActivity.map((row) => [row.action, row.count])),
    },
    attentionCandidates: attentionCandidates.map((lead) => ({
      leadId: lead.leadId,
      companyName: lead.companyName || `Lead ${lead.leadId}`,
      industry: lead.industry || "Unknown",
      financingType: lead.applicationType,
      status: lead.status,
      hasLenderMatches: lead.matchCount > 0,
      missingRequestedAmount: lead.requestedAmount == null,
      missingCreditScore: lead.creditScore == null,
      daysSinceActivity: Number.isFinite(lead.daysSinceActivity) ? Math.round(lead.daysSinceActivity) : null,
    })),
  });

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: PIPELINE_DIGEST_SYSTEM,
    messages: [{ role: "user", content: aggregateContext }],
  });

  const rawText = message.content[0]?.type === "text" ? message.content[0].text : "{}";
  const parsed = parseJsonObject(rawText);
  const candidateMap = new Map(attentionCandidates.map((lead) => [lead.leadId, lead]));
  const parsedLeads = Array.isArray(parsed["topLeads"])
    ? parsed["topLeads"]
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const value = item as Record<string, unknown>;
          const leadId = typeof value["leadId"] === "number" ? value["leadId"] : Number(value["leadId"]);
          const candidate = candidateMap.get(leadId);
          if (
            !candidate
            || typeof value["why"] !== "string"
            || value["why"].length > 500
            || containsProhibitedPromise(value["why"])
          ) return null;
          return {
            leadId,
            name: candidate.companyName || `Lead ${leadId}`,
            industry: candidate.industry || "Unknown",
            why: value["why"].slice(0, 500),
          };
        })
        .filter((lead): lead is PipelineDigestLead => lead !== null)
        .slice(0, 5)
    : [];

  const fallbackLeads: PipelineDigestLead[] = attentionCandidates.map((lead) => ({
    leadId: lead.leadId,
    name: lead.companyName || `Lead ${lead.leadId}`,
    industry: lead.industry || "Unknown",
    why: [
      lead.matchCount === 0 ? "No lender match is currently recorded." : null,
      lead.requestedAmount == null ? "Requested amount is missing." : null,
      lead.creditScore == null ? "Credit score is missing." : null,
      !Number.isFinite(lead.daysSinceActivity) || lead.daysSinceActivity > 7 ? "No recent activity is recorded." : null,
    ].filter(Boolean).join(" ") || "Active pipeline lead worth a timely review.",
  }));

  const fallbackRecommendations = [
    `Qualify missing requested amounts on ${missingAmount} lead${missingAmount === 1 ? "" : "s"} and missing credit scores on ${missingCredit} lead${missingCredit === 1 ? "" : "s"} before advancing lender review.`,
    attentionCandidates.length > 0
      ? `Review the ${attentionCandidates.length} highest-attention active lead${attentionCandidates.length === 1 ? "" : "s"}, prioritizing records with stale activity and no current lender match.`
      : "Review active pipeline records for the next timely follow-up.",
    `Enrich industry and state data where unknown to improve pipeline segmentation and lender-match readiness.`,
  ];
  const recommendations = safeModelStrings(parsed["recommendations"], 3) ?? fallbackRecommendations;
  const parsedOverview = typeof parsed["overview"] === "string" ? parsed["overview"].trim() : "";

  return {
    overview: parsedOverview && parsedOverview.length <= 1000 && !containsProhibitedPromise(parsedOverview)
      ? parsedOverview
      : `The visible pipeline contains ${leads.length} leads. ${leads.filter((lead) => lead.matchCount > 0).length} currently have lender matches; ${missingAmount} are missing requested amounts and ${missingCredit} are missing credit scores.`,
    recommendations,
    topLeads: parsedLeads.length > 0 ? parsedLeads : fallbackLeads,
    generatedAt: new Date().toISOString(),
  };
}

export async function getPipelineDigest(scope: PipelineDigestScope): Promise<PipelineDigest> {
  const cacheKey = `${scope.role}:${scope.userId}`;
  const cached = pipelineDigestCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.digest;
  }

  const digest = await generatePipelineDigest(scope);
  pipelineDigestCache.set(cacheKey, {
    expiresAt: Date.now() + PIPELINE_DIGEST_CACHE_MS,
    digest,
  });
  return digest;
}

export interface NextBestAction {
  actions: string[];
  generatedAt: string;
}

const NEXT_ACTION_SYSTEM = `You are a sales operations assistant for a commercial lending CRM.
Recommend the next best actions for a rep working one lead, using only the supplied lead fields, activity summary, and current lender-match state.

HARD RULES:
- Recommendations only: never execute, schedule, send, or draft anything.
- Never promise approval, funding, rates, terms, eligibility, or a lender decision.
- Never invent missing facts, lender criteria, activity, or financial figures.
- If important data is missing, recommend qualifying that data.
- Include 2 or 3 concrete actions. When lender matches exist, explain which recorded match is worth reviewing and why based only on its recorded score. When no match exists, recommend reviewing or running the existing matching workflow rather than claiming a fit.
- Return ONLY valid JSON with this exact structure:
{"actions":["<action 1>","<action 2>","<action 3>"]}
- Do not include markdown or any text outside the JSON object.`;

export async function generateNextBestAction(leadId: number): Promise<NextBestAction> {
  const context = await buildLeadContext(leadId);
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: NEXT_ACTION_SYSTEM,
    messages: [{ role: "user", content: context }],
  });
  const rawText = message.content[0]?.type === "text" ? message.content[0].text : "{}";
  const parsed = parseJsonObject(rawText);
  const parsedActions = Array.isArray(parsed["actions"])
    ? parsed["actions"]
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const validActions = parsedActions.length >= 2
    && parsedActions.every((item) => item.length <= 600 && !containsProhibitedPromise(item));

  if (validActions) {
    return {
      actions: parsedActions,
      generatedAt: new Date().toISOString(),
    };
  }

  const lead = await db.query.leadsTable.findFirst({
    where: eq(leadsTable.id, leadId),
    with: {
      company: true,
      lenderMatches: {
        with: { lender: true },
        orderBy: (table, { desc: orderDesc }) => [orderDesc(table.matchScore)],
        limit: 1,
      },
    },
  });
  if (!lead) throw new Error("Lead not found");

  const missingFields = [
    lead.requestedAmount == null ? "requested amount" : null,
    lead.creditScore == null ? "credit score" : null,
    !lead.company?.industry ? "industry" : null,
    lead.company?.timeInBusinessMonths == null ? "time in business" : null,
    lead.company?.annualRevenue == null ? "annual revenue" : null,
  ].filter((field): field is string => field !== null);
  const fallbackActions = [
    missingFields.length > 0
      ? `Qualify the missing ${missingFields.join(", ")} and record the verified details before advancing lender review.`
      : "Confirm the existing qualification details are current and identify any remaining underwriting gaps.",
    lead.lenderMatches[0]
      ? `Review the recorded ${lead.lenderMatches[0].lender.name} match and its ${lead.lenderMatches[0].matchScore}/100 score; treat it as a recommendation for manual review, not an approval or rate promise.`
      : "After the lead profile is complete, review or run the existing lender-matching workflow; no current lender match is recorded.",
    `Plan a manual outreach conversation focused on the ${lead.applicationType.replace(/_/g, " ")} need and the missing qualification details; do not auto-send a message.`,
  ];

  return {
    actions: fallbackActions,
    generatedAt: new Date().toISOString(),
  };
}

const DRAFT_PROMPT_BASE = `You are a sales assistant for a commercial lending CRM, drafting an outbound message on behalf of a rep to a lead. Use only the facts present in the lead context — never invent figures, approvals, rates, or promises that are not present in the context. Keep the tone professional and warm, and keep the message reasonably short.
`;

export async function generateDraft(
  leadId: number,
  channel: "email" | "sms",
  instruction?: string,
): Promise<AiDraft> {
  const context = await buildLeadContext(leadId);

  const instructionLine = instruction?.trim()
    ? `\nAdditional instruction from the rep: ${redactSensitiveText(instruction.trim())}\n`
    : "";

  const formatInstructions =
    channel === "email"
      ? `Return ONLY valid JSON with this exact structure:\n{\n  "subject": "<email subject line>",\n  "body": "<email body text>"\n}`
      : `Return ONLY valid JSON with this exact structure:\n{\n  "body": "<SMS message text, under 320 characters>"\n}`;

  const prompt = `${DRAFT_PROMPT_BASE}${instructionLine}\n${formatInstructions}\n\nDo not include any text outside the JSON object.\n\nLead context:\n${context}`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = message.content[0]?.type === "text" ? message.content[0].text : "{}";

  let parsed: Record<string, unknown> = {};
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    parsed = {};
  }

  const body = typeof parsed["body"] === "string" ? parsed["body"] : "";

  if (channel === "email") {
    const subject = typeof parsed["subject"] === "string" ? parsed["subject"] : "";
    return { subject, body };
  }

  return { body };
}
