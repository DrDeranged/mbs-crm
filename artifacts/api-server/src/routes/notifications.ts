import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";

const router: IRouter = Router();

// GET /notifications/unread-count — must be before /:id routes
router.get("/notifications/unread-count", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const [row] = await db
    .select({ count: count() })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, user.id), eq(notificationsTable.isRead, false)));

  res.json({ count: Number(row?.count ?? 0) });
});

// PUT /notifications/read-all — must be before /:id routes
router.put("/notifications/read-all", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.userId, user.id), eq(notificationsTable.isRead, false)));

  res.json({ success: true });
});

// GET /notifications — paginated list for the current user
router.get("/notifications", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const offset = (page - 1) * limit;

  const rows = await db.query.notificationsTable.findMany({
    where: eq(notificationsTable.userId, user.id),
    orderBy: [desc(notificationsTable.createdAt)],
    limit,
    offset,
    with: { lead: true },
  });

  const [totalRow] = await db
    .select({ total: count() })
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, user.id));

  res.json({
    data: rows.map((n: any) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      leadId: n.leadId,
      leadName: n.lead
        ? [n.lead.firstName, n.lead.lastName].filter(Boolean).join(" ") || n.lead.companyName
        : null,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    })),
    total: Number(totalRow?.total ?? 0),
    page,
    limit,
  });
});

// PUT /notifications/:id/read
router.put("/notifications/:id/read", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = parseInt(String(req.params.id), 10);
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, user.id)));

  res.json({ success: true });
});

export default router;
