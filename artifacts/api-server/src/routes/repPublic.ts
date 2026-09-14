import { getAuth } from "@clerk/express";
import { Router, type Request, type Response } from "express";
import { db, usersTable, activityLogTable, retiredRepSlugsTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import QRCode from "qrcode";
import { getPublicBaseUrl } from "../lib/brand";
import { getUserDisplayName } from "../lib/authHelpers";

const router = Router();

type PublicRepUser = Pick<typeof usersTable.$inferSelect, "name" | "email" | "mobileNumber" | "slug">;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type RetireSlugInput = {
  userId: number;
  newSlug: string;
  displayName?: string | null;
};

export type RepQrDependencies = {
  resolve?: (slug: string) => Promise<{ user: PublicRepUser | null; replacementSlug: string | null }>;
  qr?: {
    toBuffer: (payload: string, options: Record<string, unknown>) => Promise<Buffer>;
    toString: (payload: string, options: Record<string, unknown>) => Promise<string>;
  };
};

type RetireSlugDatabase = {
  transaction: <T>(callback: (tx: any) => Promise<T>) => Promise<T>;
};

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

async function resolvePublicSlug(slug: string): Promise<{
  user: PublicRepUser | null;
  replacementSlug: string | null;
}> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) return { user: null, replacementSlug: null };

  const user = await resolvePublicRep(normalizedSlug);
  if (user) return { user, replacementSlug: null };

  const retired = await db.query.retiredRepSlugsTable.findFirst({
    where: eq(retiredRepSlugsTable.slug, normalizedSlug),
  });
  if (!retired) return { user: null, replacementSlug: null };

  const replacement = await resolvePublicRep(retired.replacementSlug);
  return {
    user: replacement,
    replacementSlug: retired.replacementSlug,
  };
}

export function getRepPublicUrl(slug: string): string {
  return `${getPublicBaseUrl()}/r/${encodeURIComponent(slug)}`;
}

function getRepPublicResolverUrl(slug: string): string {
  return `${getPublicBaseUrl()}/api/public/reps/${encodeURIComponent(slug)}`;
}

export function getRepQrUrl(slug: string): string {
  return `${getPublicBaseUrl()}/api/public/reps/${encodeURIComponent(slug)}/qr.png`;
}

export function getRepQrSvgUrl(slug: string): string {
  return `${getPublicBaseUrl()}/api/public/reps/${encodeURIComponent(slug)}/qr.svg`;
}

/** Generate the production QR payload without writing any database rows. */
export async function getRepQrPng(slug: string, dependencies: RepQrDependencies = {}): Promise<Buffer | null> {
  const { user } = await (dependencies.resolve ?? resolvePublicSlug)(slug);
  if (!user?.slug) return null;

  return (dependencies.qr ?? QRCode).toBuffer(getRepPublicUrl(user.slug), {
    type: "png",
    width: 1000,
    margin: 4,
    color: { dark: "#0E2A47", light: "#FFFFFF" },
  });
}

/** Generate an SVG QR for the canonical URL without writing any rows. */
export async function getRepQrSvg(slug: string, dependencies: RepQrDependencies = {}): Promise<string | null> {
  const { user } = await (dependencies.resolve ?? resolvePublicSlug)(slug);
  if (!user?.slug) return null;

  return (dependencies.qr ?? QRCode).toString(getRepPublicUrl(user.slug), {
    type: "svg",
    width: 1000,
    margin: 4,
    color: { dark: "#0E2A47", light: "#FFFFFF" },
  });
}

export type RepResolverDependencies = {
  resolve?: (slug: string) => Promise<{ user: PublicRepUser | null; replacementSlug: string | null }>;
};

export function createPublicRepResolverRouter(dependencies: RepResolverDependencies = {}) {
  const publicRouter = Router();
  publicRouter.get("/public/reps/:slug", async (req: Request, res: Response) => {
    const slug = String(req.params.slug || "").toLowerCase();
    const { user, replacementSlug } = await (dependencies.resolve ?? resolvePublicSlug)(slug);
    if (replacementSlug) {
      // Keep fetch-based chooser resolution JSON-to-JSON. The SPA separately
      // replaces its browser URL with the canonical /r/:slug route.
      res.setHeader("Location", getRepPublicResolverUrl(replacementSlug));
      res.setHeader("X-Canonical-URL", getRepPublicUrl(replacementSlug));
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.status(301).json({
        name: user ? getUserDisplayName(user) : null,
        phone: user?.mobileNumber ?? null,
        slug: user?.slug ?? replacementSlug,
      });
      return;
    }
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
    res.json(user
      ? { name: getUserDisplayName(user), phone: user.mobileNumber, slug: user.slug }
      : { name: null, phone: null, slug: null });
  });
  return publicRouter;
}

/** Small router factory keeps the public binary endpoints easy to exercise
 * without replacing the production database or the qrcode dependency. */
export function createRepQrRouter(dependencies: RepQrDependencies = {}) {
  const qrRouter = Router();
  qrRouter.get("/public/reps/:slug/qr.png", async (req: Request, res: Response) => {
    const slug = String(req.params.slug || "").toLowerCase();
    const png = await getRepQrPng(slug, dependencies);
    if (!png) {
      res.status(404).json({ error: "Representative not found" });
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("png").send(png);
  });

  qrRouter.get("/public/reps/:slug/qr.svg", async (req: Request, res: Response) => {
    const slug = String(req.params.slug || "").toLowerCase();
    const svg = await getRepQrSvg(slug, dependencies);
    if (!svg) {
      res.status(404).json({ error: "Representative not found" });
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("svg").send(svg);
  });
  return qrRouter;
}

/**
 * Retire a slug and assign its replacement while holding the user row lock.
 * The old slug is inserted into the immutable reservation table before the
 * user row is changed, all in one transaction.
 */
export async function retireRepSlug(input: RetireSlugInput, database: RetireSlugDatabase = db) {
  const newSlug = input.newSlug.trim().toLowerCase();
  if (!Number.isInteger(input.userId) || input.userId <= 0) {
    throw Object.assign(new Error("Invalid user ID"), { status: 400 });
  }
  if (!SLUG_PATTERN.test(newSlug) || newSlug.length > 50) {
    throw Object.assign(new Error("Invalid replacement slug"), { status: 400 });
  }
  if (input.displayName !== undefined && input.displayName !== null && input.displayName.trim().length > 200) {
    throw Object.assign(new Error("Display name is too long"), { status: 400 });
  }

  return database.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, input.userId))
      .for("update");
    if (!user) throw Object.assign(new Error("User not found"), { status: 404 });

    // Repeating the exact request is intentionally idempotent. It may still
    // update the optional display name, but it never inserts a second history
    // or reservation row.
    if (user.slug === newSlug) {
      const [updated] = await tx
        .update(usersTable)
        .set({
          ...(input.displayName !== undefined
            ? { name: input.displayName?.trim() || null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, user.id))
        .returning();
      return updated ?? user;
    }

    const [activeTarget] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.slug, newSlug))
      .for("update");
    if (activeTarget) {
      throw Object.assign(new Error("Replacement slug is already active"), { status: 409 });
    }

    const [retiredTarget] = await tx
      .select({ slug: retiredRepSlugsTable.slug })
      .from(retiredRepSlugsTable)
      .where(eq(retiredRepSlugsTable.slug, newSlug))
      .for("update");
    if (retiredTarget) {
      throw Object.assign(new Error("Replacement slug has already been retired"), { status: 409 });
    }
    if (user.slug) {
      await tx.insert(retiredRepSlugsTable).values({
        slug: user.slug,
        replacementSlug: newSlug,
        userId: user.id,
      });
    }
    const [updated] = await tx
      .update(usersTable)
      .set({
        slug: newSlug,
        ...(input.displayName !== undefined
          ? { name: input.displayName?.trim() || null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id))
      .returning();
    if (!updated) throw Object.assign(new Error("User not found"), { status: 404 });
    return updated;
  });
}

// Deliberately returns the same generic payload for unknown and inactive slugs.
router.use(createPublicRepResolverRouter());

router.use(createRepQrRouter());

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
