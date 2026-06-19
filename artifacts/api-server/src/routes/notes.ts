import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { notesTable, leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireUser, userToApi } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { ListNotesParams, CreateNoteParams, CreateNoteBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/leads/:id/notes", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const params = ListNotesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, params.data.id) });
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const notes = await db.query.notesTable.findMany({
    where: eq(notesTable.leadId, params.data.id),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: { author: true },
  });

  res.json(notes.map((n) => ({
    id: n.id,
    leadId: n.leadId,
    userId: n.userId,
    author: (n as any).author ? userToApi((n as any).author) : null,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
  })));
});

router.post("/leads/:id/notes", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const params = CreateNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const body = CreateNoteBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, params.data.id) });
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [note] = await db.insert(notesTable).values({
    leadId: params.data.id,
    userId: user.id,
    body: body.data.body,
  }).returning();

  await logActivity({
    userId: user.id,
    leadId: params.data.id,
    action: "note_added",
    entityType: "note",
    entityId: note.id,
  });

  res.status(201).json({
    id: note.id,
    leadId: note.leadId,
    userId: note.userId,
    author: userToApi(user),
    body: note.body,
    createdAt: note.createdAt.toISOString(),
  });
});

export default router;
