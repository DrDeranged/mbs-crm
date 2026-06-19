import { getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";

export async function requireUser(req: Request, res: Response): Promise<typeof usersTable.$inferSelect | null> {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  let user = await db.query.usersTable.findFirst({ where: eq(usersTable.clerkId, clerkId) });

  if (!user) {
    try {
      const clerkUser = await clerkClient.users.getUser(clerkId);
      const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
      const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;

      const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
      if (existing) {
        user = existing;
        await db.update(usersTable).set({ clerkId }).where(eq(usersTable.id, existing.id));
      } else {
        const isFirst = (await db.select({ id: usersTable.id }).from(usersTable).limit(1)).length === 0;
        const [created] = await db.insert(usersTable).values({
          clerkId,
          email,
          name,
          role: isFirst ? "admin" : "rep",
        }).returning();
        user = created;
      }
    } catch (e) {
      res.status(500).json({ error: "Failed to resolve user" });
      return null;
    }
  }

  if (!user!.isActive) {
    res.status(403).json({ error: "Account is inactive" });
    return null;
  }

  return user!;
}

export function userToApi(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    clerkId: user.clerkId,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    mobileNumber: user.mobileNumber ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
