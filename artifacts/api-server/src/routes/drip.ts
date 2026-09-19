import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  dripSequencesTable,
  dripSequenceStepsTable,
  dripEnrollmentsTable,
  leadsTable,
  emailTemplatesTable,
  LEAD_STATUSES,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import {
  canManageMarketingResource,
  canReadMarketingResource,
  requireUser,
} from "../lib/authHelpers";
import { isEmailSuppressed } from "../lib/emailSafety";
import { isUsfaMarketingBlocked } from "../lib/intake/usfaCompliance";

const sequenceCreateBody = z.object({
  name: z.string().trim().min(1),
  triggerStatus: z.enum(LEAD_STATUSES),
  senderMode: z.enum(["template", "default", "assigned_rep"]).optional(),
  isActive: z.boolean().optional(),
}).strict();

const sequenceUpdateBody = sequenceCreateBody.partial().refine(
  (body) => Object.keys(body).length > 0,
  { message: "At least one sequence field is required" },
);

const sequenceStepsBody = z.object({
  steps: z.array(z.object({
    templateId: z.number().int().positive(),
    delayHours: z.number().finite().min(0).max(8760).optional(),
  }).strict()),
}).strict();

export type DripRouterDependencies = {
  database?: typeof db;
  authenticate?: typeof requireUser;
  isEmailSuppressed?: typeof isEmailSuppressed;
};

export function createDripRouter(dependencies: DripRouterDependencies = {}) {
const database = dependencies.database ?? db;
const authenticate = dependencies.authenticate ?? requireUser;
const emailIsSuppressed = dependencies.isEmailSuppressed ?? isEmailSuppressed;
const router = Router();

function sequenceToApi(seq: any) {
  return {
    id: seq.id,
    name: seq.name,
    triggerStatus: seq.triggerStatus,
    senderMode: seq.senderMode ?? "template",
    isActive: seq.isActive,
    stepCount: seq.steps?.length ?? 0,
    createdBy: seq.createdBy ?? null,
    ownerId: seq.ownerId ?? null,
    creator: seq.creator ? { id: seq.creator.id, name: seq.creator.name, email: seq.creator.email } : null,
    createdAt: seq.createdAt.toISOString(),
    updatedAt: seq.updatedAt.toISOString(),
  };
}

function stepToApi(s: any) {
  return {
    id: s.id,
    sequenceId: s.sequenceId,
    stepOrder: s.stepOrder,
    templateId: s.templateId,
    template: s.template ? { id: s.template.id, name: s.template.name, subject: s.template.subject } : null,
    delayHours: s.delayHours,
    createdAt: s.createdAt.toISOString(),
  };
}

function enrollmentToApi(e: any) {
  // Compute next send date from the current step's delay + last send time
  let nextSendAt: string | null = null;
  if (e.status === "active" && e.sequence?.steps) {
    const sortedSteps = [...e.sequence.steps].sort((a: any, b: any) => a.stepOrder - b.stepOrder);
    const nextStep = sortedSteps[e.currentStep];
    if (nextStep) {
      const base: Date = e.lastStepSentAt ?? e.enrolledAt;
      const ms = nextStep.delayHours * 60 * 60 * 1000;
      nextSendAt = new Date(base.getTime() + ms).toISOString();
    }
  }

  return {
    id: e.id,
    leadId: e.leadId,
    sequenceId: e.sequenceId,
    sequence: e.sequence ? { id: e.sequence.id, name: e.sequence.name, steps: e.sequence.steps?.length ?? 0 } : null,
    currentStep: e.currentStep,
    status: e.status,
    nextSendAt,
    enrolledAt: e.enrolledAt.toISOString(),
    lastStepSentAt: e.lastStepSentAt?.toISOString() ?? null,
    completedAt: e.completedAt?.toISOString() ?? null,
    unenrolledAt: e.unenrolledAt?.toISOString() ?? null,
  };
}

// GET /api/drip/sequences
router.get("/drip/sequences", async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;

  const sequences = await database.query.dripSequencesTable.findMany({
    with: { steps: true, creator: true, owner: true },
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  res.json(sequences
    .filter((sequence) => canReadMarketingResource(user, sequence.owner))
    .map(sequenceToApi));
});

// POST /api/drip/sequences
router.post("/drip/sequences", async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;

  const body = sequenceCreateBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid body", details: body.error.issues });
  const { name, triggerStatus, senderMode, isActive } = body.data;

  const [seq] = await database.insert(dripSequencesTable).values({
    name,
    triggerStatus,
    senderMode: senderMode ?? "template",
    isActive: isActive ?? false,
    createdBy: user.id,
    ownerId: user.id,
  }).returning();

  res.status(201).json({
    ...seq,
    stepCount: 0,
    createdBy: seq.createdBy ?? null,
    ownerId: seq.ownerId ?? null,
    creator: { id: user.id, name: user.name, email: user.email },
    createdAt: seq.createdAt.toISOString(),
    updatedAt: seq.updatedAt.toISOString(),
  });
});

// GET /api/drip/sequences/:id
router.get("/drip/sequences/:id", async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  const seq = await database.query.dripSequencesTable.findFirst({
    where: eq(dripSequencesTable.id, id),
    with: {
      creator: true,
      owner: true,
      steps: {
        with: { template: { with: { owner: true } } },
        orderBy: (s, { asc }) => [asc(s.stepOrder)],
      },
    },
  });
  if (!seq) return void res.status(404).json({ error: "Not found" });
  if (!canReadMarketingResource(user, seq.owner)) {
    return void res.status(403).json({ error: "Forbidden" });
  }
  if (
    user.role === "rep" &&
    seq.steps.some((step) => step.template && !canReadMarketingResource(user, step.template.owner))
  ) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  res.json({
    ...sequenceToApi(seq),
    steps: seq.steps.map(stepToApi),
  });
});

// PUT /api/drip/sequences/:id
router.put("/drip/sequences/:id", async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  const existing = await database.query.dripSequencesTable.findFirst({
    where: eq(dripSequencesTable.id, id),
    with: { creator: true, owner: true },
  });
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (!canManageMarketingResource(user, existing.ownerId)) {
    return void res.status(403).json({ error: "You can only edit sequences you created" });
  }

  const body = sequenceUpdateBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid body", details: body.error.issues });
  const { name, triggerStatus, senderMode, isActive } = body.data;
  const [updated] = await database.update(dripSequencesTable)
    .set({
      name: name ?? existing.name,
      triggerStatus: triggerStatus ?? existing.triggerStatus,
      senderMode: senderMode ?? existing.senderMode,
      isActive: isActive ?? existing.isActive,
      updatedAt: new Date(),
    })
    .where(eq(dripSequencesTable.id, id))
    .returning();

  res.json({
    ...updated,
    stepCount: 0,
    createdBy: updated.createdBy ?? null,
    ownerId: updated.ownerId ?? null,
    creator: existing.creator
      ? { id: existing.creator.id, name: existing.creator.name, email: existing.creator.email }
      : null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

// DELETE /api/drip/sequences/:id — reps may delete only their own sequences.
router.delete("/drip/sequences/:id", async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) return void res.status(400).json({ error: "Invalid ID" });
  const existing = await database.query.dripSequencesTable.findFirst({ where: eq(dripSequencesTable.id, id) });
  if (!existing) return void res.status(404).json({ error: "Not found" });
  if (!canManageMarketingResource(user, existing.ownerId)) {
    return void res.status(403).json({ error: "You can only delete sequences you created" });
  }

  await database.delete(dripSequencesTable).where(eq(dripSequencesTable.id, id));
  res.status(204).send();
});

// PUT /api/drip/sequences/:id/steps — replace all steps
router.put("/drip/sequences/:id/steps", async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  const seq = await database.query.dripSequencesTable.findFirst({ where: eq(dripSequencesTable.id, id) });
  if (!seq) return void res.status(404).json({ error: "Sequence not found" });
  if (!canManageMarketingResource(user, seq.ownerId)) {
    return void res.status(403).json({ error: "You can only edit sequences you created" });
  }

  const body = sequenceStepsBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid body", details: body.error.issues });
  const { steps } = body.data;
  if (user.role === "rep" && steps.length > 0) {
    const templateIds = [...new Set(steps.map((step) => step.templateId))];
    const templates = await database.query.emailTemplatesTable.findMany({
      where: inArray(emailTemplatesTable.id, templateIds),
      with: { owner: true },
    });
    if (
      templates.length !== templateIds.length ||
      templates.some((template) => !canReadMarketingResource(user, template.owner))
    ) {
      return void res.status(403).json({ error: "You can only use templates you own or templates owned by an administrator" });
    }
  }

  // Delete existing steps and replace
  await database.delete(dripSequenceStepsTable).where(eq(dripSequenceStepsTable.sequenceId, id));

  let newSteps: any[] = [];
  if (steps.length > 0) {
    newSteps = await database.insert(dripSequenceStepsTable)
      .values(steps.map((s, i) => ({
        sequenceId: id,
        stepOrder: i + 1,
        templateId: s.templateId,
        delayHours: s.delayHours ?? 0,
      })))
      .returning();
  }

  res.json(newSteps.map(stepToApi));
});

// GET /api/leads/:id/drip — current enrollment
router.get("/leads/:id/drip", async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid ID" });

  const lead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  if (user.role === "rep" && lead.assignedRepId !== user.id) return void res.status(403).json({ error: "Forbidden" });
  if (await isUsfaMarketingBlocked(database, lead.leadSource)) {
    return void res.status(409).json({ error: "USFA consent must be confirmed before drip enrollment" });
  }
  if (!lead.email || lead.isUnsubscribed || await emailIsSuppressed(lead.email)) {
    return void res.status(409).json({ error: "Recipient is suppressed and cannot be enrolled" });
  }

  const enrollment = await database.query.dripEnrollmentsTable.findFirst({
    where: and(
      eq(dripEnrollmentsTable.leadId, leadId),
      eq(dripEnrollmentsTable.status, "active")
    ),
    with: {
      sequence: { with: { steps: true, owner: true } },
    },
  });

  if (enrollment && !canReadMarketingResource(user, enrollment.sequence?.owner)) {
    return void res.status(403).json({ error: "Forbidden" });
  }
  res.json(enrollment ? enrollmentToApi(enrollment) : null);
});

// POST /api/leads/:id/drip/enroll
router.post("/leads/:id/drip/enroll", async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid ID" });

  const lead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  if (user.role === "rep" && lead.assignedRepId !== user.id) return void res.status(403).json({ error: "Forbidden" });
  if (await isUsfaMarketingBlocked(database, lead.leadSource)) {
    return void res.status(409).json({ error: "USFA consent must be confirmed before drip enrollment" });
  }
  if (!lead.email || lead.isUnsubscribed || await emailIsSuppressed(lead.email)) {
    return void res.status(409).json({ error: "Recipient is suppressed and cannot be enrolled" });
  }

  const { sequenceId } = req.body as { sequenceId: number };
  if (!sequenceId) return void res.status(400).json({ error: "sequenceId required" });

  const seq = await database.query.dripSequencesTable.findFirst({
    where: eq(dripSequencesTable.id, sequenceId),
    with: { steps: { with: { template: { with: { owner: true } } } }, owner: true },
  });
  if (!seq) return void res.status(404).json({ error: "Sequence not found" });
  if (!canReadMarketingResource(user, seq.owner)) {
    return void res.status(403).json({ error: "Forbidden" });
  }
  if (
    user.role === "rep" &&
    seq.steps.some((step) => step.template && !canReadMarketingResource(user, step.template.owner))
  ) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  // Unenroll any active enrollment first
  await database.update(dripEnrollmentsTable)
    .set({ status: "unenrolled", unenrolledAt: new Date() })
    .where(and(eq(dripEnrollmentsTable.leadId, leadId), eq(dripEnrollmentsTable.status, "active")));

  const [enrollment] = await database.insert(dripEnrollmentsTable).values({
    leadId,
    sequenceId,
    currentStep: 0,
    status: "active",
  }).returning();

  res.status(201).json(enrollmentToApi({ ...enrollment, sequence: seq }));
});

// POST /api/leads/:id/drip/unenroll
router.post("/leads/:id/drip/unenroll", async (req: Request, res: Response) => {
  const user = await authenticate(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid ID" });

  const unenrollLead = await database.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!unenrollLead) return void res.status(404).json({ error: "Lead not found" });
  if (user.role === "rep" && unenrollLead.assignedRepId !== user.id) return void res.status(403).json({ error: "Forbidden" });

  const enrollment = await database.query.dripEnrollmentsTable.findFirst({
    where: and(eq(dripEnrollmentsTable.leadId, leadId), eq(dripEnrollmentsTable.status, "active")),
    with: { sequence: { with: { steps: true } } },
  });
  if (!enrollment) return void res.status(404).json({ error: "No active enrollment" });

  const [updated] = await database.update(dripEnrollmentsTable)
    .set({ status: "unenrolled", unenrolledAt: new Date() })
    .where(eq(dripEnrollmentsTable.id, enrollment.id))
    .returning();

  res.json(enrollmentToApi({ ...updated, sequence: enrollment.sequence }));
});

return router;
}

export default createDripRouter();
