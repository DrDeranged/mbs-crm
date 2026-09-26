import { Router, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, companySettingsTable, usfaIntakeLogTable } from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { runUsfaSheetPoll, testUsfaSheetConnection } from "../lib/intake/usfaPoller";

const router = Router();

async function admin(req: Request, res: Response) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return user;
}

router.get("/admin/usfa-intake", async (req, res): Promise<void> => {
  if (!(await admin(req, res))) return;
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
  const [settings] = await db.select().from(companySettingsTable).limit(1);
  const logs = await db.select().from(usfaIntakeLogTable)
    .orderBy(desc(usfaIntakeLogTable.ingestedAt))
    .limit(limit).offset((page - 1) * limit);
  const [counts] = await db.select({
    total: sql<number>`count(*)`,
    ok: sql<number>`count(*) filter (where ${usfaIntakeLogTable.status} = 'ok')`,
    dup: sql<number>`count(*) filter (where ${usfaIntakeLogTable.status} = 'dup')`,
    error: sql<number>`count(*) filter (where ${usfaIntakeLogTable.status} = 'error')`,
    lastRun: sql<Date | null>`max(${usfaIntakeLogTable.ingestedAt})`,
  }).from(usfaIntakeLogTable);
  res.json({
    settings: {
      usfaSheetId: settings?.usfaSheetId ?? null,
      usfaSheetTab: settings?.usfaSheetTab ?? "Sheet1",
      usfaConsentConfirmed: settings?.usfaConsentConfirmed ?? false,
      usfaWebhookEnabled: settings?.usfaWebhookEnabled ?? false,
    },
    serviceAccountConfigured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()),
    counts: {
      total: Number(counts?.total ?? 0), ok: Number(counts?.ok ?? 0),
      dup: Number(counts?.dup ?? 0), error: Number(counts?.error ?? 0),
      lastRun: counts?.lastRun ?? null,
    },
    logs,
    page,
    limit,
  });
});

router.post("/admin/usfa-intake/test-connection", async (req, res): Promise<void> => {
  if (!(await admin(req, res))) return;
  const [settings] = await db.select({
    usfaSheetId: companySettingsTable.usfaSheetId,
    usfaSheetTab: companySettingsTable.usfaSheetTab,
  }).from(companySettingsTable).limit(1);
  const result = await testUsfaSheetConnection(settings?.usfaSheetId ?? null, settings?.usfaSheetTab ?? "Sheet1");
  res.status(result.ok ? 200 : 400).json(result);
});

router.post("/admin/usfa-intake/run", async (req, res): Promise<void> => {
  if (!(await admin(req, res))) return;
  const result = await runUsfaSheetPoll();
  res.json(result);
});

router.post("/admin/usfa-intake/:id/reprocess", async (req, res): Promise<void> => {
  if (!(await admin(req, res))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid intake log ID" });
    return;
  }
  const [entry] = await db.select().from(usfaIntakeLogTable).where(eq(usfaIntakeLogTable.id, id)).limit(1);
  if (!entry) {
    res.status(404).json({ error: "Intake log not found" });
    return;
  }
  await db.delete(usfaIntakeLogTable).where(and(eq(usfaIntakeLogTable.id, id), eq(usfaIntakeLogTable.status, "error")));
  const result = await runUsfaSheetPoll();
  res.json({ ...result, reprocessedExternalId: entry.externalId });
});

export default router;