import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { buildApplicationFormHtml, enrichApplicationPdfRep, renderApplicationFormPdf } from "../lib/applicationPdf";
import { getBrandLogoUrl, getPublicBaseUrl } from "../lib/brand";

type Database = typeof db;
export type ApplicationFormRouteDependencies = {
  database?: Database;
  authenticate?: typeof requireUser;
  renderPdf?: (html: string, options?: { format?: "A4" | "Letter" }) => Promise<Buffer>;
};

export function createApplicationFormRouter(overrides: ApplicationFormRouteDependencies = {}) {
  const database = overrides.database ?? db;
  const authenticate = overrides.authenticate ?? requireUser;
  const router = Router();

  router.get("/users/:id/application-form.pdf", async (req: Request, res: Response) => {
    const actor = await authenticate(req, res);
    if (!actor) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }
    if (actor.role !== "admin" && (actor.role !== "rep" || actor.id !== id)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const target = await database.query.usersTable.findFirst({ where: eq(usersTable.id, id) });
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const baseRep = {
      rep: {
        name: target.name,
        title: target.title,
        email: target.email,
        mobileNumber: target.mobileNumber,
        slug: target.slug,
      },
      logoUrl: getBrandLogoUrl(getPublicBaseUrl()),
    };
    const applicationOptions = overrides.renderPdf
      ? baseRep
      : { ...baseRep, rep: await enrichApplicationPdfRep(database, id, baseRep.rep) };
    // Keep the injected renderer for focused route tests. Production uses the
    // native pdf-lib renderer and therefore never needs a browser executable.
    const pdf = overrides.renderPdf
      ? await overrides.renderPdf(buildApplicationFormHtml(applicationOptions), { format: "Letter" })
      : await renderApplicationFormPdf(applicationOptions);
    const fileSlug = (target.slug || `user-${target.id}`).replace(/[^a-z0-9-]/gi, "-");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="MBS-Finance-Application-${fileSlug}.pdf"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.send(pdf);
  });

  return router;
}

export default createApplicationFormRouter();