import { Router, type IRouter, type Request, type Response } from "express";
import { requireUser } from "../lib/authHelpers";
import { db } from "@workspace/db";
import { companySettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/settings/company", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Forbidden" }) as unknown as void;

  const [settings] = await db.select().from(companySettingsTable).limit(1);
  res.json(settings ?? {});
});

router.put("/settings/company", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return res.status(403).json({ error: "Forbidden" }) as unknown as void;

  const { companyName, companyEmail, companyPhone, companyWebsite, companyAddress, companyCity, companyState, companyZip } = req.body as Record<string, string | null | undefined>;

  const [existing] = await db.select().from(companySettingsTable).limit(1);

  let result;
  if (existing) {
    const [updated] = await db
      .update(companySettingsTable)
      .set({ companyName, companyEmail, companyPhone, companyWebsite, companyAddress, companyCity, companyState, companyZip, updatedAt: new Date() })
      .where(eq(companySettingsTable.id, existing.id))
      .returning();
    result = updated;
  } else {
    const [created] = await db
      .insert(companySettingsTable)
      .values({ companyName, companyEmail, companyPhone, companyWebsite, companyAddress, companyCity, companyState, companyZip })
      .returning();
    result = created;
  }

  res.json(result);
});

export default router;
