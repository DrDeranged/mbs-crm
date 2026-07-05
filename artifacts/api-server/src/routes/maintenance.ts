import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, leadsTable } from "@workspace/db";
import { eq, or, isNull, inArray } from "drizzle-orm";

const router: IRouter = Router();

const OWNER_CLERK_ID = "user_3G5nqFNmuEbSPu0wZ91SLhCiOZE";

router.post("/maintenance/one-time-cleanup", async (req: Request, res: Response) => {
  const { userId: clerkId } = getAuth(req);

  if (clerkId !== OWNER_CLERK_ID) {
    res.status(404).end();
    return;
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({ role: "admin" })
        .where(eq(usersTable.email, "arslandin11@gmail.com"));

      await tx
        .delete(leadsTable)
        .where(or(eq(leadsTable.assignedRepId, 1), isNull(leadsTable.assignedRepId)));

      await tx
        .delete(usersTable)
        .where(inArray(usersTable.email, ["admin@mbsfinancing.com", "revenue.tester@example.com"]));
    });

    const [promotedUser, leadsRemaining, users] = await Promise.all([
      db.query.usersTable.findFirst({ where: eq(usersTable.email, "arslandin11@gmail.com") }),
      db.select().from(leadsTable),
      db.query.usersTable.findMany({ orderBy: (t, { asc }) => [asc(t.id)] }),
    ]);

    res.json({
      promoted: promotedUser?.role === "admin",
      leadsRemaining: leadsRemaining.length,
      users: users.map((u) => ({ id: u.id, email: u.email, role: u.role })),
    });
  } catch (e) {
    res.json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
