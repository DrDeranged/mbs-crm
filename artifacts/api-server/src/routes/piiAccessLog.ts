import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { piiAccessLogTable, usersTable } from "@workspace/db";
import { desc, eq, and, gte, lte, count } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";

const router = Router();

// ─── GET /api/pii-access-log ─────────────────────────────────────────────────

router.get("/pii-access-log", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role !== "admin") {
    return void res.status(403).json({ error: "Admin only" });
  }

  const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "25"), 10)));
  const offset = (page - 1) * limit;

  const startDate = req.query["startDate"] ? new Date(String(req.query["startDate"])) : null;
  const endDate = req.query["endDate"] ? new Date(String(req.query["endDate"])) : null;
  const filterUserId = req.query["userId"] ? parseInt(String(req.query["userId"]), 10) : null;
  const filterLeadId = req.query["leadId"] ? parseInt(String(req.query["leadId"]), 10) : null;
  const category = req.query["category"] as string | undefined;

  const conditions: ReturnType<typeof eq>[] = [];
  if (startDate && !isNaN(startDate.getTime())) conditions.push(gte(piiAccessLogTable.createdAt, startDate) as any);
  if (endDate && !isNaN(endDate.getTime())) {
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1);
    conditions.push(lte(piiAccessLogTable.createdAt, end) as any);
  }
  if (filterUserId && !isNaN(filterUserId)) conditions.push(eq(piiAccessLogTable.userId, filterUserId) as any);
  if (filterLeadId && !isNaN(filterLeadId)) conditions.push(eq(piiAccessLogTable.leadId, filterLeadId) as any);
  if (category && ["ssn", "credit", "application"].includes(category)) {
    conditions.push(eq(piiAccessLogTable.fieldCategory, category as any) as any);
  }

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

  const startDate = req.query["startDate"] ? new Date(String(req.query["startDate"])) : null;
  const endDate = req.query["endDate"] ? new Date(String(req.query["endDate"])) : null;
  const filterUserId = req.query["userId"] ? parseInt(String(req.query["userId"]), 10) : null;
  const filterLeadId = req.query["leadId"] ? parseInt(String(req.query["leadId"]), 10) : null;

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
