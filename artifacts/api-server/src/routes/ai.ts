import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { generateLeadBriefing, generateDraft } from "../lib/aiAssistant";
import rateLimit from "express-rate-limit";

const router: IRouter = Router();

const aiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI requests. Please try again later." },
});

const GenerateDraftBody = z.object({
  channel: z.enum(["email", "sms"]),
  instruction: z.string().max(1000).optional(),
});

async function loadAccessibleLead(leadId: number, user: { id: number; role: string }, res: Response) {
  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return null;
  }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return lead;
}

router.get("/leads/:id/ai/briefing", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const lead = await loadAccessibleLead(leadId, user, res);
  if (!lead) return;

  res.json({
    leadId,
    briefing: lead.aiSummary ?? null,
    generatedAt: lead.aiSummaryGeneratedAt ? lead.aiSummaryGeneratedAt.toISOString() : null,
  });
});

router.post("/leads/:id/ai/briefing", aiRateLimiter, async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const lead = await loadAccessibleLead(leadId, user, res);
  if (!lead) return;

  try {
    const briefing = await generateLeadBriefing(leadId);
    await logActivity({
      userId: user.id,
      leadId,
      action: "ai_briefing_generated",
      entityType: "lead",
      entityId: leadId,
    });
    res.json({ leadId, briefing, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[ai] Briefing generation failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Failed to generate AI briefing" });
  }
});

router.post("/leads/:id/ai/draft", aiRateLimiter, async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const body = GenerateDraftBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const lead = await loadAccessibleLead(leadId, user, res);
  if (!lead) return;

  try {
    const draft = await generateDraft(leadId, body.data.channel, body.data.instruction);
    await logActivity({
      userId: user.id,
      leadId,
      action: "ai_draft_generated",
      entityType: "lead",
      entityId: leadId,
      details: { channel: body.data.channel },
    });
    res.json(draft);
  } catch (err) {
    console.error("[ai] Draft generation failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Failed to generate AI draft" });
  }
});

export default router;
