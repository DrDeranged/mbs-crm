import { Router, type Request, type Response } from "express";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { gatherBackupPayload } from "../lib/backupExport";

const router = Router();

router.get("/admin/backup/export", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role !== "admin") {
    return void res.status(403).json({ error: "Admin only" });
  }

  try {
    const payload = await gatherBackupPayload();

    await logActivity({
      userId: user.id,
      action: "backup_exported",
      entityType: "system",
      entityId: 0,
      details: { counts: payload.counts },
    });

    const filename = `mbs-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json({ ...payload, exportedBy: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error("Backup export error:", err);
    res.status(500).json({ error: "Export failed" });
  }
});

export default router;
