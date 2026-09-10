import { Router, type Request, type Response } from "express";
import { db, usersTable, activityLogTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const router = Router();

// Deliberately returns the same generic payload for unknown and inactive slugs.
router.get("/public/reps/:slug", async (req: Request, res: Response) => {
  const slug = String(req.params.slug || "").toLowerCase();
  const user = slug ? await db.query.usersTable.findFirst({
    where: and(eq(usersTable.slug, slug), eq(usersTable.isActive, true)),
  }) : null;
  if (user?.slug) {
    const existingLock = await db.query.activityLogTable.findFirst({
      where: and(
        eq(activityLogTable.entityType, "rep_slug_visit"),
        eq(activityLogTable.entityId, user.slug),
      ),
    });
    if (!existingLock) {
      await db.insert(activityLogTable).values({
        userId: null,
        leadId: null,
        action: "served",
        entityType: "rep_slug_visit",
        entityId: user.slug,
        details: {},
      });
    }
  }
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(user ? { name: user.name, phone: user.mobileNumber, slug: user.slug } : { name: null, phone: null, slug: null });
});

export default router;