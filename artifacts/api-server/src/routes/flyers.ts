import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  flyerTemplatesTable, generatedFlyersTable, documentsTable,
  leadsTable, usersTable, activityLogTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { renderPdf, renderTemplate } from "../lib/renderPdf";
import { objectStorageClient } from "../lib/objectStorage";
import sgMail from "@sendgrid/mail";

const SENDGRID_API_KEY = process.env["SENDGRID_API_KEY"];
const FROM_EMAIL = process.env["SENDGRID_FROM_EMAIL"] || "noreply@mybusinesssolutions.com";
const FROM_NAME = process.env["SENDGRID_FROM_NAME"] || "MBS CRM";
if (SENDGRID_API_KEY) sgMail.setApiKey(SENDGRID_API_KEY);

const router = Router();

/** Returns false and sends 403 if the user cannot access this flyer. */
async function assertFlyerAccess(
  flyer: { id: number; leadId: number | null; createdBy: number | null },
  user: { id: number; role: string },
  res: Response,
): Promise<boolean> {
  // Admins and managers can access any flyer
  if (user.role === "admin" || user.role === "manager") return true;
  // Reps: must be the creator, or the assigned rep on the associated lead
  if (flyer.createdBy === user.id) return true;
  if (flyer.leadId) {
    const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, flyer.leadId) });
    if (lead?.assignedRepId === user.id) return true;
  }
  res.status(403).json({ error: "Forbidden" });
  return false;
}

// POST /flyers/generate
router.post("/flyers/generate", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { templateId, fieldValues, leadId } = req.body;
  if (!templateId || typeof fieldValues !== "object") {
    res.status(400).json({ error: "templateId and fieldValues required" });
    return;
  }

  const tmpl = await db.query.flyerTemplatesTable.findFirst({
    where: eq(flyerTemplatesTable.id, Number(templateId)),
  });
  if (!tmpl || !tmpl.isActive) {
    res.status(404).json({ error: "Template not found or inactive" });
    return;
  }

  // Validate lead access if leadId provided
  let lead: typeof leadsTable.$inferSelect | undefined;
  if (leadId) {
    const found = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, Number(leadId)) });
    if (!found) { res.status(404).json({ error: "Lead not found" }); return; }
    if (user.role === "rep" && found.assignedRepId !== user.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    lead = found;
  }

  try {
    // Render HTML and generate PDF
    const renderedHtml = renderTemplate(tmpl.htmlTemplate, fieldValues as Record<string, string>);
    const pdfBuffer = await renderPdf(renderedHtml);

    // Upload PDF to GCS
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] ?? "";
    const fileKey = `flyers/${Date.now()}-${tmpl.id}.pdf`;
    const bucket = objectStorageClient.bucket(bucketId);
    const gcsFile = bucket.file(fileKey);
    await gcsFile.save(pdfBuffer, { contentType: "application/pdf" });

    // Create generated_flyers record
    const [flyer] = await db.insert(generatedFlyersTable).values({
      leadId: lead?.id ?? null,
      templateId: tmpl.id,
      fieldValues: fieldValues,
      pdfStorageKey: fileKey,
      createdBy: user.id,
    }).returning();

    // Save to lead's document store if leadId provided
    if (lead) {
      await db.insert(documentsTable).values({
        leadId: lead.id,
        userId: user.id,
        filename: `${tmpl.name} - Flyer.pdf`,
        fileKey,
        fileType: "application/pdf",
        fileSize: pdfBuffer.length,
      });

      await logActivity({
        userId: user.id,
        leadId: lead.id,
        action: "flyer_generated",
        entityType: "flyer",
        entityId: flyer.id,
        details: { templateName: tmpl.name, flyerId: flyer.id },
      });
    }

    res.json({
      flyerId: flyer.id,
      downloadUrl: `/api/flyers/${flyer.id}/download`,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate flyer");
    res.status(500).json({ error: "PDF generation failed" });
  }
});

// GET /flyers/:id/download
router.get("/flyers/:id/download", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const flyer = await db.query.generatedFlyersTable.findFirst({
    where: eq(generatedFlyersTable.id, id),
  });
  if (!flyer || !flyer.pdfStorageKey) { res.status(404).json({ error: "Flyer not found" }); return; }

  if (!(await assertFlyerAccess(flyer, user, res))) return;

  try {
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] ?? "";
    const bucket = objectStorageClient.bucket(bucketId);
    const gcsFile = bucket.file(flyer.pdfStorageKey);
    const [exists] = await gcsFile.exists();
    if (!exists) { res.status(404).json({ error: "PDF not found in storage" }); return; }

    const tmpl = flyer.templateId
      ? await db.query.flyerTemplatesTable.findFirst({ where: eq(flyerTemplatesTable.id, flyer.templateId) })
      : null;
    const filename = tmpl ? `${tmpl.name} - Flyer.pdf` : "flyer.pdf";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    gcsFile.createReadStream().pipe(res);
  } catch (err) {
    req.log.error({ err }, "Failed to download flyer");
    res.status(500).json({ error: "Download failed" });
  }
});

// POST /flyers/:id/email
router.post("/flyers/:id/email", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { leadId } = req.body;
  if (!leadId) { res.status(400).json({ error: "leadId required" }); return; }

  const [flyer, leadRow] = await Promise.all([
    db.query.generatedFlyersTable.findFirst({ where: eq(generatedFlyersTable.id, id) }),
    db.query.leadsTable.findFirst({ where: eq(leadsTable.id, Number(leadId)) }),
  ]);

  if (!flyer || !flyer.pdfStorageKey) { res.status(404).json({ error: "Flyer not found" }); return; }

  // Verify the provided leadId is consistent with the flyer's stored leadId
  if (flyer.leadId !== null && flyer.leadId !== Number(leadId)) {
    res.status(403).json({ error: "leadId does not match flyer context" }); return;
  }

  // Always verify flyer access (creator / lead-assigned-rep / admin-manager)
  if (!(await assertFlyerAccess(flyer, user, res))) return;

  // For reps: also enforce they're assigned to the TARGET lead regardless of flyer.leadId.
  // This closes the null-leadId escalation: a rep with an unscoped flyer cannot email
  // it to a lead they're not assigned to.
  if (user.role !== "admin" && user.role !== "manager") {
    if (!leadRow || leadRow.assignedRepId !== user.id) {
      res.status(403).json({ error: "Forbidden: not assigned to target lead" }); return;
    }
  }

  if (!leadRow?.email) { res.status(400).json({ error: "Lead has no email address" }); return; }

  const tmpl = flyer.templateId
    ? await db.query.flyerTemplatesTable.findFirst({ where: eq(flyerTemplatesTable.id, flyer.templateId) })
    : null;
  const flyerName = tmpl?.name ?? "MBS Flyer";

  try {
    // Download PDF buffer from GCS
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] ?? "";
    const bucket = objectStorageClient.bucket(bucketId);
    const gcsFile = bucket.file(flyer.pdfStorageKey);
    const [pdfBuffer] = await gcsFile.download();

    const repUser = await db.query.usersTable.findFirst({ where: eq(usersTable.id, user.id) });
    const repName = repUser?.name || FROM_NAME;

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1F4E79;padding:24px 32px">
          <h2 style="color:#fff;margin:0;font-size:20px">My Business Solutions</h2>
        </div>
        <div style="padding:24px 32px;background:#fff">
          <p style="color:#333">Hi ${leadRow.firstName || leadRow.companyName || "there"},</p>
          <p style="color:#555;line-height:1.6;margin-top:12px">
            Please find attached your customized <strong>${flyerName}</strong> with information about our financing programs tailored for your business.
          </p>
          <p style="color:#555;line-height:1.6;margin-top:12px">
            We would love to discuss how we can help your business grow. Please don't hesitate to reach out.
          </p>
          <p style="color:#555;margin-top:20px">Best regards,<br/><strong>${repName}</strong><br/>My Business Solutions</p>
        </div>
        <div style="background:#f8f8f8;padding:12px 32px;font-size:11px;color:#999;text-align:center">
          This is not a commitment to lend. All financing is subject to underwriting approval.
        </div>
      </div>
    `;

    if (SENDGRID_API_KEY) {
      await sgMail.send({
        to: leadRow.email,
        from: { email: FROM_EMAIL, name: repName },
        subject: `${flyerName} from My Business Solutions`,
        html: emailHtml,
        attachments: [
          {
            filename: `${flyerName}.pdf`,
            content: pdfBuffer.toString("base64"),
            type: "application/pdf",
            disposition: "attachment",
          },
        ],
      });
    }

    // Log activity
    await logActivity({
      userId: user.id,
      leadId: Number(leadId),
      action: "flyer_emailed",
      entityType: "flyer",
      entityId: flyer.id,
      details: {
        flyerName,
        recipientEmail: leadRow.email,
        devMode: !SENDGRID_API_KEY,
      },
    });

    res.json({ success: true, devMode: !SENDGRID_API_KEY });
  } catch (err) {
    req.log.error({ err }, "Failed to email flyer");
    res.status(500).json({ error: "Email failed" });
  }
});

// GET /flyers/:id
router.get("/flyers/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const flyer = await db.query.generatedFlyersTable.findFirst({
    where: eq(generatedFlyersTable.id, id),
    with: { template: true },
  });
  if (!flyer) { res.status(404).json({ error: "Not found" }); return; }

  if (!(await assertFlyerAccess(flyer, user, res))) return;

  res.json(flyer);
});

export default router;
