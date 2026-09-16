import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { piiAccessLogTable, usersTable } from "@workspace/db";
import { desc, eq, and, gte, lte, count } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";
import { z } from "zod/v4";

const router = Router();
export const piiLogQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  userId: z.coerce.number().int().positive().optional(),
  leadId: z.coerce.number().int().positive().optional(),
  category: z.enum(["ssn", "credit", "application"]).optional(),
}).strict();

function parsePiiLogQuery(req: Request, res: Response) {
  const parsed = piiLogQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid ${parsed.error.issues[0]?.path.join(".") || "query"}` });
    return null;
  }
  return parsed.data;
}

// ─── GET /api/pii-access-log ─────────────────────────────────────────────────

router.get("/pii-access-log", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role !== "admin") {
    return void res.status(403).json({ error: "Admin only" });
  }

  const query = parsePiiLogQuery(req, res);
  if (!query) return;
  const page = query.page ?? 1;
  const limit = query.limit ?? 25;
  const offset = (page - 1) * limit;

  const startDate = query.startDate ? new Date(query.startDate) : null;
  const endDate = query.endDate ? new Date(query.endDate) : null;
  const filterUserId = query.userId ?? null;
  const filterLeadId = query.leadId ?? null;
  const category = query.category;

  const conditions: ReturnType<typeof eq>[] = [];
  if (startDate && !isNaN(startDate.getTime())) conditions.push(gte(piiAccessLogTable.createdAt, startDate) as any);
  if (endDate && !isNaN(endDate.getTime())) {
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1);
    conditions.push(lte(piiAccessLogTable.createdAt, end) as any);
  }
  if (filterUserId && !isNaN(filterUserId)) conditions.push(eq(piiAccessLogTable.userId, filterUserId) as any);
  if (filterLeadId && !isNaN(filterLeadId)) conditions.push(eq(piiAccessLogTable.leadId, filterLeadId) as any);
  if (category) conditions.push(eq(piiAccessLogTable.fieldCategory, category) as any);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ total: count() }).from(piiAccessLogTable).where(where);
  const total = Number(totalRow?.total ?? 0);

  const entries = await db
    .select({
      id: piiAccessLogTable.id,
      userId: piiAccessLogTable.userId,
      leadId: piiAccessLogTable.leadId,
      fieldCategory: piiAccessLogTable.fieldCategory,
      action: piiAccessLogTable.action,
      ip: piiAccessLogTable.ip,
      createdAt: piiAccessLogTable.createdAt,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(piiAccessLogTable)
    .leftJoin(usersTable, eq(piiAccessLogTable.userId, usersTable.id))
    .where(where)
    .orderBy(desc(piiAccessLogTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({
    data: entries,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
});

// ─── GET /api/pii-access-log/export ──────────────────────────────────────────

router.get("/pii-access-log/export", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role !== "admin") {
    return void res.status(403).json({ error: "Admin only" });
  }

  const query = parsePiiLogQuery(req, res);
  if (!query) return;
  const startDate = query.startDate ? new Date(query.startDate) : null;
  const endDate = query.endDate ? new Date(query.endDate) : null;
  const filterUserId = query.userId ?? null;
  const filterLeadId = query.leadId ?? null;

  const conditions: ReturnType<typeof eq>[] = [];
  if (startDate && !isNaN(startDate.getTime())) conditions.push(gte(piiAccessLogTable.createdAt, startDate) as any);
  if (endDate && !isNaN(endDate.getTime())) {
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1);
    conditions.push(lte(piiAccessLogTable.createdAt, end) as any);
  }
  if (filterUserId && !isNaN(filterUserId)) conditions.push(eq(piiAccessLogTable.userId, filterUserId) as any);
  if (filterLeadId && !isNaN(filterLeadId)) conditions.push(eq(piiAccessLogTable.leadId, filterLeadId) as any);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const entries = await db
    .select({
      id: piiAccessLogTable.id,
      userId: piiAccessLogTable.userId,
      leadId: piiAccessLogTable.leadId,
      fieldCategory: piiAccessLogTable.fieldCategory,
      action: piiAccessLogTable.action,
      ip: piiAccessLogTable.ip,
      createdAt: piiAccessLogTable.createdAt,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(piiAccessLogTable)
    .leftJoin(usersTable, eq(piiAccessLogTable.userId, usersTable.id))
    .where(where)
    .orderBy(desc(piiAccessLogTable.createdAt))
    .limit(10000);

  const header = "ID,User ID,User Name,User Email,Lead ID,Field Category,Action,IP,Accessed At\n";
  const rows = entries.map((e) =>
    [
      e.id,
      e.userId ?? "",
      `"${(e.userName ?? "").replace(/"/g, '""')}"`,
      `"${(e.userEmail ?? "").replace(/"/g, '""')}"`,
      e.leadId ?? "",
      e.fieldCategory,
      e.action,
      e.ip ?? "",
      e.createdAt?.toISOString() ?? "",
    ].join(","),
  );

  const filename = `pii-access-log-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(header + rows.join("\n"));
});

export default router;
