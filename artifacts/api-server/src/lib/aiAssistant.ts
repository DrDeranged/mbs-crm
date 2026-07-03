import Anthropic from "@anthropic-ai/sdk";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

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
      lines.push(`- (${n.createdAt.toISOString().slice(0, 10)}, ${n.author?.name || "rep"}): ${n.body}`);
    }
  }

  if (lead.communications.length > 0) {
    lines.push(``, `# Recent Communications`);
    for (const c of lead.communications) {
      const date = c.createdAt.toISOString().slice(0, 10);
      if (c.type === "call") {
        lines.push(`- ${date}: ${c.direction} call, outcome: ${c.callOutcome || c.status}${c.durationSeconds ? `, ${c.durationSeconds}s` : ""}`);
      } else {
        lines.push(`- ${date}: ${c.direction} SMS: "${(c.body || "").slice(0, 200)}"`);
      }
    }
  }

  if (lead.emailSends.length > 0) {
    lines.push(``, `# Recent Emails`);
    for (const e of lead.emailSends) {
      lines.push(`- ${e.createdAt.toISOString().slice(0, 10)}: "${e.subject}" — status: ${e.status}`);
    }
  }

  if (lead.lenderMatches.length > 0) {
    lines.push(``, `# Top Lender Matches`);
    for (const m of lead.lenderMatches) {
      lines.push(`- ${m.lender.name} (match score ${m.matchScore}/100)`);
    }
  }

  const openTasks = lead.tasks.filter((t) => !t.isCompleted);
  if (openTasks.length > 0) {
    lines.push(``, `# Open Tasks`);
    for (const t of openTasks) {
      lines.push(`- ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""}`);
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

const DRAFT_PROMPT_BASE = `You are a sales assistant for a commercial lending CRM, drafting an outbound message on behalf of a rep to a lead. Use only the facts present in the lead context — never invent figures, approvals, rates, or promises that are not present in the context. Keep the tone professional and warm, and keep the message reasonably short.
`;

export async function generateDraft(
  leadId: number,
  channel: "email" | "sms",
  instruction?: string,
): Promise<AiDraft> {
  const context = await buildLeadContext(leadId);

  const instructionLine = instruction?.trim()
    ? `\nAdditional instruction from the rep: ${instruction.trim()}\n`
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
