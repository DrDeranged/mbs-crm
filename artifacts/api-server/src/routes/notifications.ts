import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";
import { z } from "zod/v4";

export const notificationsQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
}).strict();
const notificationId = z.coerce.number().int().positive();

function parseNotificationsQuery(query: Request["query"]) {
  return notificationsQuery.safeParse({
    page: query.page,
    limit: query.limit,
  });
}

function logRejectedField(req: Request, field: string): void {
  const request = req as Request & {
    log?: { warn: (context: Record<string, unknown>, message: string) => void };
  };
  request.log?.warn({ rejectedField: field }, "Rejected notifications request field");
}

type NotificationRow = typeof notificationsTable.$inferSelect & {
  lead?: {
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
  } | null;
};

export type NotificationStore = {
  unreadCount(userId: number): Promise<number>;
  markAllRead(userId: number): Promise<void>;
  list(userId: number, limit: number, offset: number): Promise<NotificationRow[]>;
  total(userId: number): Promise<number>;
  markRead(userId: number, id: number): Promise<void>;
};

export function createNotificationStore(database: typeof db = db): NotificationStore {
  return {
    async unreadCount(userId) {
      const [row] = await database
        .select({ count: count() })
        .from(notificationsTable)
        .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
      return Number(row?.count ?? 0);
    },
    async markAllRead(userId) {
      await database
        .update(notificationsTable)
        .set({ isRead: true })
        .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
    },
    async list(userId, limit, offset) {
      return database.query.notificationsTable.findMany({
        where: eq(notificationsTable.userId, userId),
        orderBy: [desc(notificationsTable.createdAt)],
        limit,
        offset,
        with: { lead: true },
      }) as Promise<NotificationRow[]>;
    },
    async total(userId) {
      const [row] = await database
        .select({ total: count() })
        .from(notificationsTable)
        .where(eq(notificationsTable.userId, userId));
      return Number(row?.total ?? 0);
    },
    async markRead(userId, id) {
      await database
        .update(notificationsTable)
        .set({ isRead: true })
        .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
    },
  };
}

export function createNotificationsRouter({
  store = createNotificationStore(),
  authenticate = requireUser,
}: {
  store?: NotificationStore;
  authenticate?: typeof requireUser;
} = {}): IRouter {
  const router: IRouter = Router();

  // GET /notifications/unread-count — must be before /:id routes
  router.get("/notifications/unread-count", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;
    res.json({ count: await store.unreadCount(user.id) });
  });

  // PUT /notifications/read-all — must be before /:id routes
  router.put("/notifications/read-all", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;
    await store.markAllRead(user.id);
    res.json({ success: true });
  });

  // GET /notifications — paginated list for the current user
  router.get("/notifications", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;

    // Consume only the documented pagination fields. Browsers, service workers,
    // and edge proxies may append cache/diagnostic query keys; those must not
    // make an otherwise valid notification list request fail.
    const query = parseNotificationsQuery(req.query);
    if (!query.success) {
      logRejectedField(req, query.error.issues[0]?.path.join(".") || "query");
      return void res.status(400).json({ error: `Invalid ${query.error.issues[0]?.path.join(".") || "query"}` });
    }
    const page = query.data.page ?? 1;
    const limit = query.data.limit ?? 20;
    const offset = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      store.list(user.id, limit, offset),
      store.total(user.id),
    ]);

    res.json({
      data: rows.map((n) => ({
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
      total,
      page,
      limit,
    });
  });

  // PUT /notifications/:id/read
  router.put("/notifications/:id/read", async (req: Request, res: Response) => {
    const user = await authenticate(req, res);
    if (!user) return;

    const id = notificationId.safeParse(req.params.id);
    if (!id.success) {
      logRejectedField(req, "id");
      return void res.status(400).json({ error: "Invalid id" });
    }
    await store.markRead(user.id, id.data);
    res.json({ success: true });
  });

  return router;
}

export default createNotificationsRouter();
