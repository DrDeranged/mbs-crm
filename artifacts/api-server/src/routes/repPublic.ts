import { getAuth } from "@clerk/express";
import { Router, type Request, type Response } from "express";
import { db, usersTable, activityLogTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import QRCode from "qrcode";
import { getPublicBaseUrl } from "../lib/brand";
import { getUserDisplayName } from "../lib/authHelpers";

const router = Router();

type PublicRepUser = Pick<typeof usersTable.$inferSelect, "name" | "email" | "mobileNumber" | "slug">;

/**
 * Resolve a rep exactly as the public resolver does, without recording a visit.
 * Keeping this separate from the public route lets administrative health checks
 * verify resolver semantics without turning the check itself into public traffic.
 */
export async function resolvePublicRep(slug: string): Promise<PublicRepUser | null> {
  const normalizedSlug = slug.toLowerCase();
  return normalizedSlug
    ? await db.query.usersTable.findFirst({
      where: and(eq(usersTable.slug, normalizedSlug), eq(usersTable.isActive, true)),
    }) ?? null
    : null;
}

export function getRepPublicUrl(slug: string): string {
  return `${getPublicBaseUrl()}/r/${encodeURIComponent(slug)}`;
}

export function getRepQrUrl(slug: string): string {
  return `${getPublicBaseUrl()}/api/public/reps/${encodeURIComponent(slug)}/qr.png`;
}

/** Generate the production QR payload without writing any database rows. */
export async function getRepQrPng(slug: string): Promise<Buffer | null> {
  const user = await resolvePublicRep(slug);
  if (!user?.slug) return null;

  return QRCode.toBuffer(getRepPublicUrl(user.slug), {
    type: "png",
    width: 1000,
    margin: 4,
    color: { dark: "#0E2A47", light: "#FFFFFF" },
  });
}

// Deliberately returns the same generic payload for unknown and inactive slugs.
router.get("/public/reps/:slug", async (req: Request, res: Response) => {
  const slug = String(req.params.slug || "").toLowerCase();
  const user = await resolvePublicRep(slug);
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

router.get("/public/reps/:slug/qr.png", async (req: Request, res: Response) => {
  const slug = String(req.params.slug || "").toLowerCase();
  const png = await getRepQrPng(slug);
  if (!png) {
    res.status(404).json({ error: "Representative not found" });
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=300");
  res.type("png").send(png);
});

router.get("/admin/qr-verify", async (req: Request, res: Response) => {
  // Do not use requireUser here: it may reconcile reserved deals as a side
  // effect. This health check must only read users and render QR bytes.
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const requestingUser = await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkId, clerkId),
  });
  if (!requestingUser || !requestingUser.isActive || requestingUser.role === "pending") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (requestingUser.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const reps = await db.query.usersTable.findMany({
    where: and(eq(usersTable.isActive, true), isNotNull(usersTable.slug)),
    orderBy: (users, { asc }) => asc(users.id),
  });

  const results = await Promise.all(reps.map(async (rep) => {
    const slug = rep.slug!;
    const resolved = await resolvePublicRep(slug);
    let routeStatus = 500;
    try {
      // Use the configured public origin rather than request headers. The
      // public /r route is served by the web app, so this also verifies that
      // the production-facing route is reachable from the API service.
      const routeResponse = await fetch(getRepPublicUrl(slug), { redirect: "manual" });
      routeStatus = routeResponse.status;
    } catch (error) {
      req.log.warn({ err: error, slug }, "Public rep route verification failed");
    }
    const personalized = routeStatus === 200 && resolved?.slug === slug;

    let qrHttpStatus = 500;
    let servesPng = false;
    try {
      // Fetch the public endpoint, rather than only calling the generator,
      // so status, content type, and bytes all exercise the production route.
      const qrResponse = await fetch(getRepQrUrl(slug), { redirect: "manual" });
      qrHttpStatus = qrResponse.status;
      const contentType = qrResponse.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      const body = await qrResponse.arrayBuffer();
      const bytes = Buffer.from(body);
      servesPng = qrResponse.ok
        && contentType === "image/png"
        && bytes.length >= 8
        && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    } catch (error) {
      req.log.warn({ err: error, slug }, "QR verification failed");
    }

    return {
      slug,
      userDisplay: getUserDisplayName(rep),
      routeHttpStatus: routeStatus,
      personalized,
      qrHttpStatus,
      servesPng,
    };
  }));

  res.json({ results });
});

export default router;
