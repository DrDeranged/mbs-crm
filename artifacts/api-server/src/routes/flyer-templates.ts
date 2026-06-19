import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { flyerTemplatesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";

const router = Router();

// Starter templates to auto-seed when no templates exist
const STARTER_TEMPLATES = [
  {
    name: "Working Capital Flyer",
    programType: "working_capital" as const,
    htmlTemplate: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; background: #fff; }
  .header { background: #1F4E79; color: #fff; padding: 36px 48px; }
  .header .logo { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 4px; }
  .header .tagline { font-size: 13px; opacity: 0.8; }
  .hero { background: #f0f6ff; padding: 32px 48px 28px; border-bottom: 3px solid #1F4E79; }
  .hero h1 { font-size: 28px; color: #1F4E79; font-weight: 700; margin-bottom: 8px; }
  .hero p { font-size: 15px; color: #555; line-height: 1.5; }
  .content { padding: 32px 48px; }
  .highlights { display: flex; gap: 16px; margin-bottom: 28px; }
  .highlight { flex: 1; background: #f8faff; border: 1px solid #d0e4f7; border-radius: 8px; padding: 18px; text-align: center; }
  .highlight .value { font-size: 24px; font-weight: 800; color: #1F4E79; }
  .highlight .label { font-size: 11px; color: #666; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .section { margin-bottom: 24px; }
  .section h2 { font-size: 14px; font-weight: 700; color: #1F4E79; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; border-bottom: 2px solid #e8f0fb; padding-bottom: 6px; }
  .section p { font-size: 13px; color: #555; line-height: 1.6; }
  .features { list-style: none; }
  .features li { font-size: 13px; color: #444; padding: 5px 0; display: flex; align-items: flex-start; gap: 8px; }
  .features li::before { content: "✓"; color: #1F4E79; font-weight: 700; flex-shrink: 0; margin-top: 1px; }
  .contact { background: #1F4E79; color: #fff; padding: 24px 48px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center; }
  .contact .name { font-size: 16px; font-weight: 700; }
  .contact .details { font-size: 12px; opacity: 0.85; margin-top: 4px; }
  .contact .cta { background: #fff; color: #1F4E79; padding: 10px 20px; border-radius: 6px; font-weight: 700; font-size: 13px; }
  .disclaimer { padding: 12px 48px; font-size: 10px; color: #999; text-align: center; border-top: 1px solid #eee; }
</style>
</head>
<body>
  <div class="header">
    <div class="logo">My Business Solutions</div>
    <div class="tagline">Business Financing Specialists</div>
  </div>
  <div class="hero">
    <h1>Working Capital Funding</h1>
    <p>Fast, flexible financing to fuel your business growth — without the wait of traditional bank loans.</p>
  </div>
  <div class="content">
    <div class="highlights">
      <div class="highlight"><div class="value">{{funding_amount}}</div><div class="label">Funding Amount</div></div>
      <div class="highlight"><div class="value">{{rate}}</div><div class="label">Factor Rate</div></div>
      <div class="highlight"><div class="value">{{term}}</div><div class="label">Term</div></div>
    </div>
    <div class="section">
      <h2>Use of Funds</h2>
      <p>{{use_of_funds}}</p>
    </div>
    <div class="section">
      <h2>Why Choose MBS?</h2>
      <ul class="features">
        <li>Approvals in as little as 24 hours</li>
        <li>Funding for businesses with 6+ months in operation</li>
        <li>No collateral required for most programs</li>
        <li>Flexible daily or weekly repayment options</li>
        <li>Dedicated rep from application to funding</li>
      </ul>
    </div>
  </div>
  <div class="contact">
    <div>
      <div class="name">{{rep_name}}</div>
      <div class="details">{{rep_phone}} &nbsp;|&nbsp; {{rep_email}}</div>
    </div>
    <div class="cta">Apply Now →</div>
  </div>
  <div class="disclaimer">This is not a commitment to lend. All financing is subject to underwriting approval. My Business Solutions is a commercial finance brokerage.</div>
</body>
</html>`,
    variableFields: [
      { key: "funding_amount", label: "Funding Amount", type: "text", defaultValue: "Up to $500,000" },
      { key: "rate", label: "Factor Rate", type: "text", defaultValue: "1.15–1.49" },
      { key: "term", label: "Term", type: "text", defaultValue: "3–18 Months" },
      { key: "use_of_funds", label: "Use of Funds", type: "text", defaultValue: "Inventory, payroll, marketing, expansion, or any business need." },
      { key: "rep_name", label: "Rep Name", type: "text", defaultValue: "Your Name" },
      { key: "rep_phone", label: "Rep Phone", type: "text", defaultValue: "(555) 000-0000" },
      { key: "rep_email", label: "Rep Email", type: "text", defaultValue: "rep@mybusinesssolutions.com" },
    ],
    isActive: true,
  },
  {
    name: "Equipment Financing Flyer",
    programType: "equipment" as const,
    htmlTemplate: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; background: #fff; }
  .header { background: #1F4E79; color: #fff; padding: 36px 48px; display: flex; justify-content: space-between; align-items: center; }
  .header .logo { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
  .header .tagline { font-size: 12px; opacity: 0.8; margin-top: 2px; }
  .header .badge { background: rgba(255,255,255,0.15); border-radius: 6px; padding: 8px 14px; font-size: 12px; text-align: center; }
  .hero { background: linear-gradient(135deg, #1F4E79 0%, #2d6ca2 100%); color: #fff; padding: 36px 48px; }
  .hero h1 { font-size: 30px; font-weight: 800; margin-bottom: 8px; }
  .hero p { font-size: 14px; opacity: 0.9; line-height: 1.5; }
  .content { padding: 32px 48px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 28px; }
  .card { background: #f8faff; border: 1px solid #d0e4f7; border-radius: 8px; padding: 16px; }
  .card .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .card .value { font-size: 18px; font-weight: 700; color: #1F4E79; }
  .section { margin-bottom: 24px; }
  .section h2 { font-size: 13px; font-weight: 700; color: #1F4E79; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; border-bottom: 2px solid #e8f0fb; padding-bottom: 6px; }
  .features { list-style: none; }
  .features li { font-size: 13px; color: #444; padding: 5px 0; display: flex; gap: 8px; }
  .features li::before { content: "▸"; color: #1F4E79; font-weight: 700; flex-shrink: 0; }
  .contact { background: #1F4E79; color: #fff; padding: 24px 48px; display: flex; justify-content: space-between; align-items: center; }
  .contact .name { font-size: 16px; font-weight: 700; }
  .contact .details { font-size: 12px; opacity: 0.85; margin-top: 4px; }
  .contact .cta { background: #fff; color: #1F4E79; padding: 10px 20px; border-radius: 6px; font-weight: 700; font-size: 13px; }
  .disclaimer { padding: 12px 48px; font-size: 10px; color: #999; text-align: center; border-top: 1px solid #eee; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">My Business Solutions</div>
      <div class="tagline">Equipment Financing Division</div>
    </div>
    <div class="badge">Fast Approvals<br/>100% Financing</div>
  </div>
  <div class="hero">
    <h1>Equipment Financing</h1>
    <p>Finance the equipment your business needs today — preserve cash flow and stay competitive.</p>
  </div>
  <div class="content">
    <div class="grid">
      <div class="card"><div class="label">Equipment Type</div><div class="value">{{equipment_type}}</div></div>
      <div class="card"><div class="label">Vendor / Dealer</div><div class="value">{{vendor}}</div></div>
      <div class="card"><div class="label">Interest Rate</div><div class="value">{{rate}}</div></div>
      <div class="card"><div class="label">Loan Term</div><div class="value">{{term}}</div></div>
      <div class="card"><div class="label">Down Payment</div><div class="value">{{down_payment}}</div></div>
      <div class="card"><div class="label">Program Type</div><div class="value">Equipment Loan / Lease</div></div>
    </div>
    <div class="section">
      <h2>Program Features</h2>
      <ul class="features">
        <li>Finance new and used equipment from any vendor</li>
        <li>Terms from 24–84 months to match your cash flow</li>
        <li>Startups and challenged credit considered</li>
        <li>Section 179 tax deduction eligibility</li>
        <li>Same-day approval decisions available</li>
      </ul>
    </div>
  </div>
  <div class="contact">
    <div>
      <div class="name">{{rep_name}}</div>
      <div class="details">{{rep_phone}} &nbsp;|&nbsp; {{rep_email}}</div>
    </div>
    <div class="cta">Get Pre-Approved →</div>
  </div>
  <div class="disclaimer">This is not a commitment to lend. All financing is subject to underwriting approval. My Business Solutions is a commercial finance brokerage.</div>
</body>
</html>`,
    variableFields: [
      { key: "equipment_type", label: "Equipment Type", type: "text", defaultValue: "Manufacturing Equipment" },
      { key: "vendor", label: "Vendor / Dealer", type: "text", defaultValue: "Any Approved Vendor" },
      { key: "rate", label: "Interest Rate", type: "text", defaultValue: "Starting at 6.9% APR" },
      { key: "term", label: "Loan Term", type: "text", defaultValue: "24–84 Months" },
      { key: "down_payment", label: "Down Payment", type: "text", defaultValue: "$0 Down Available" },
      { key: "rep_name", label: "Rep Name", type: "text", defaultValue: "Your Name" },
      { key: "rep_phone", label: "Rep Phone", type: "text", defaultValue: "(555) 000-0000" },
      { key: "rep_email", label: "Rep Email", type: "text", defaultValue: "rep@mybusinesssolutions.com" },
    ],
    isActive: true,
  },
];

async function seedStarterTemplates() {
  const existing = await db.select({ id: flyerTemplatesTable.id }).from(flyerTemplatesTable).limit(1);
  if (existing.length > 0) return;
  for (const tmpl of STARTER_TEMPLATES) {
    await db.insert(flyerTemplatesTable).values({
      name: tmpl.name,
      programType: tmpl.programType,
      htmlTemplate: tmpl.htmlTemplate,
      variableFields: tmpl.variableFields,
      isActive: tmpl.isActive,
    });
  }
}

// Seed on module load (fire-and-forget, isolated error)
seedStarterTemplates().catch((err) =>
  console.warn("[flyers] Seed failed:", err?.message ?? err)
);

// GET /flyer-templates
router.get("/flyer-templates", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { programType, activeOnly } = req.query;
  const rows = await db.query.flyerTemplatesTable.findMany({
    where: (t, { and, eq }) => {
      const conds: any[] = [];
      if (activeOnly === "true") conds.push(eq(t.isActive, true));
      if (programType && programType !== "all") conds.push(eq(t.programType, programType as any));
      return conds.length > 0 ? and(...conds) : undefined;
    },
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  res.json(rows.map(templateToApi));
});

// GET /flyer-templates/:id
router.get("/flyer-templates/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const tmpl = await db.query.flyerTemplatesTable.findFirst({ where: eq(flyerTemplatesTable.id, id) });
  if (!tmpl) { res.status(404).json({ error: "Not found" }); return; }
  res.json(templateToApi(tmpl));
});

// POST /flyer-templates (admin only)
router.post("/flyer-templates", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const { name, programType, htmlTemplate, variableFields, isActive } = req.body;
  if (!name || !htmlTemplate) { res.status(400).json({ error: "name and htmlTemplate required" }); return; }

  const [tmpl] = await db.insert(flyerTemplatesTable).values({
    name,
    programType: programType ?? "general",
    htmlTemplate,
    variableFields: variableFields ?? [],
    isActive: isActive !== false,
    createdBy: user.id,
  }).returning();

  res.status(201).json(templateToApi(tmpl));
});

// PUT /flyer-templates/:id (admin only)
router.put("/flyer-templates/:id", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const existing = await db.query.flyerTemplatesTable.findFirst({ where: eq(flyerTemplatesTable.id, id) });
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const { name, programType, htmlTemplate, variableFields, isActive } = req.body;
  const [updated] = await db.update(flyerTemplatesTable).set({
    ...(name !== undefined && { name }),
    ...(programType !== undefined && { programType }),
    ...(htmlTemplate !== undefined && { htmlTemplate }),
    ...(variableFields !== undefined && { variableFields }),
    ...(isActive !== undefined && { isActive }),
    updatedAt: new Date(),
  }).where(eq(flyerTemplatesTable.id, id)).returning();

  res.json(templateToApi(updated));
});

function templateToApi(t: typeof flyerTemplatesTable.$inferSelect) {
  return {
    id: t.id,
    name: t.name,
    programType: t.programType,
    htmlTemplate: t.htmlTemplate,
    variableFields: t.variableFields,
    isActive: t.isActive,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export default router;
