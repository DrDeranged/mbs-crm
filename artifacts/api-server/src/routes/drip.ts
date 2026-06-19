import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  dripSequencesTable,
  dripSequenceStepsTable,
  dripEnrollmentsTable,
  leadsTable,
  emailTemplatesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";

const router = Router();

function sequenceToApi(seq: any) {
  return {
    id: seq.id,
    name: seq.name,
    triggerStatus: seq.triggerStatus,
    isActive: seq.isActive,
    stepCount: seq.steps?.length ?? 0,
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
  return {
    id: e.id,
    leadId: e.leadId,
    sequenceId: e.sequenceId,
    sequence: e.sequence ? { id: e.sequence.id, name: e.sequence.name, steps: e.sequence.steps?.length ?? 0 } : null,
    currentStep: e.currentStep,
    status: e.status,
    enrolledAt: e.enrolledAt.toISOString(),
    lastStepSentAt: e.lastStepSentAt?.toISOString() ?? null,
    completedAt: e.completedAt?.toISOString() ?? null,
    unenrolledAt: e.unenrolledAt?.toISOString() ?? null,
  };
}

// GET /api/drip/sequences
router.get("/drip/sequences", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const sequences = await db.query.dripSequencesTable.findMany({
    with: { steps: true },
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  res.json(sequences.map(sequenceToApi));
});

// POST /api/drip/sequences
router.post("/drip/sequences", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") return void res.status(403).json({ error: "Forbidden" });

  const { name, triggerStatus, isActive } = req.body as any;
  if (!name || !triggerStatus) return void res.status(400).json({ error: "name and triggerStatus required" });

  const [seq] = await db.insert(dripSequencesTable).values({
    name,
    triggerStatus,
    isActive: isActive ?? true,
  }).returning();

  res.status(201).json({ ...seq, stepCount: 0, createdAt: seq.createdAt.toISOString(), updatedAt: seq.updatedAt.toISOString() });
});

// GET /api/drip/sequences/:id
router.get("/drip/sequences/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  const seq = await db.query.dripSequencesTable.findFirst({
    where: eq(dripSequencesTable.id, id),
    with: {
      steps: {
        with: { template: true },
        orderBy: (s, { asc }) => [asc(s.stepOrder)],
      },
    },
  });
  if (!seq) return void res.status(404).json({ error: "Not found" });

  res.json({
    ...sequenceToApi(seq),
    steps: seq.steps.map(stepToApi),
  });
});

// PUT /api/drip/sequences/:id
router.put("/drip/sequences/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") return void res.status(403).json({ error: "Forbidden" });

  const id = parseInt(req.params["id"] as string, 10);
  const existing = await db.query.dripSequencesTable.findFirst({ where: eq(dripSequencesTable.id, id) });
  if (!existing) return void res.status(404).json({ error: "Not found" });

  const { name, triggerStatus, isActive } = req.body as any;
  const [updated] = await db.update(dripSequencesTable)
    .set({
      name: name ?? existing.name,
      triggerStatus: triggerStatus ?? existing.triggerStatus,
      isActive: isActive ?? existing.isActive,
      updatedAt: new Date(),
    })
    .where(eq(dripSequencesTable.id, id))
    .returning();

  res.json({ ...updated, stepCount: 0, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
});

// PUT /api/drip/sequences/:id/steps — replace all steps
router.put("/drip/sequences/:id/steps", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") return void res.status(403).json({ error: "Forbidden" });

  const id = parseInt(req.params["id"] as string, 10);
  const seq = await db.query.dripSequencesTable.findFirst({ where: eq(dripSequencesTable.id, id) });
  if (!seq) return void res.status(404).json({ error: "Sequence not found" });

  const { steps } = req.body as { steps: Array<{ templateId: number; delayHours: number }> };
  if (!Array.isArray(steps)) return void res.status(400).json({ error: "steps array required" });

  // Delete existing steps and replace
  await db.delete(dripSequenceStepsTable).where(eq(dripSequenceStepsTable.sequenceId, id));

  let newSteps: any[] = [];
  if (steps.length > 0) {
    newSteps = await db.insert(dripSequenceStepsTable)
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
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });

  const enrollment = await db.query.dripEnrollmentsTable.findFirst({
    where: and(
      eq(dripEnrollmentsTable.leadId, leadId),
      eq(dripEnrollmentsTable.status, "active")
    ),
    with: {
      sequence: { with: { steps: true } },
    },
  });

  res.json(enrollment ? enrollmentToApi(enrollment) : null);
});

// POST /api/leads/:id/drip/enroll
router.post("/leads/:id/drip/enroll", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });

  const { sequenceId } = req.body as { sequenceId: number };
  if (!sequenceId) return void res.status(400).json({ error: "sequenceId required" });

  const seq = await db.query.dripSequencesTable.findFirst({
    where: eq(dripSequencesTable.id, sequenceId),
    with: { steps: true },
  });
  if (!seq) return void res.status(404).json({ error: "Sequence not found" });

  // Unenroll any active enrollment first
  await db.update(dripEnrollmentsTable)
    .set({ status: "unenrolled", unenrolledAt: new Date() })
    .where(and(eq(dripEnrollmentsTable.leadId, leadId), eq(dripEnrollmentsTable.status, "active")));

  const [enrollment] = await db.insert(dripEnrollmentsTable).values({
    leadId,
    sequenceId,
    currentStep: 0,
    status: "active",
  }).returning();

  res.status(201).json(enrollmentToApi({ ...enrollment, sequence: seq }));
});

// POST /api/leads/:id/drip/unenroll
router.post("/leads/:id/drip/unenroll", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid ID" });

  const enrollment = await db.query.dripEnrollmentsTable.findFirst({
    where: and(eq(dripEnrollmentsTable.leadId, leadId), eq(dripEnrollmentsTable.status, "active")),
    with: { sequence: { with: { steps: true } } },
  });
  if (!enrollment) return void res.status(404).json({ error: "No active enrollment" });

  const [updated] = await db.update(dripEnrollmentsTable)
    .set({ status: "unenrolled", unenrolledAt: new Date() })
    .where(eq(dripEnrollmentsTable.id, enrollment.id))
    .returning();

  res.json(enrollmentToApi({ ...updated, sequence: enrollment.sequence }));
});

export { enrollmentToApi };
export default router;
