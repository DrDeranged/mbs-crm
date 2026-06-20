import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { eq, and, gte, desc, count, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  leadsTable,
  usersTable,
  applicationsTable,
  creditPullsTable,
  creditComplianceLogTable,
} from "@workspace/db";
import { requireUser } from "../lib/authHelpers";
import { logActivity } from "../lib/activityHelper";
import { encrypt, decrypt } from "../lib/encryption";

const router = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

function parseExperianResponse(raw: Record<string, unknown>): {
  creditScore: number | null;
  reportSummary: Record<string, unknown>;
} {
  const consumers = (raw["consumers"] as Record<string, unknown> | undefined) ?? raw;
  const creditProfiles = (consumers["creditProfile"] as unknown[] | undefined) ?? [];
  const profile = (creditProfiles[0] as Record<string, unknown> | undefined) ?? {};

  const riskModels = (profile["riskModel"] as unknown[] | undefined) ?? [];
  const firstRisk = (riskModels[0] as Record<string, unknown> | undefined) ?? {};
  const scoreRaw = firstRisk["score"] as string | number | undefined;
  const creditScore = scoreRaw != null ? parseInt(String(scoreRaw), 10) : null;

  const tradelines = (profile["tradeline"] as unknown[]) ?? [];
  const tradelineSummary = tradelines.map((t) => {
    const tl = t as Record<string, unknown>;
    return {
      creditor: String(tl["subscriberName"] ?? tl["creditorName"] ?? ""),
      balance: tl["currentBalance"] ?? tl["balance"] ?? 0,
      status: String(tl["accountStatus"] ?? tl["status"] ?? ""),
      paymentHistory: String(tl["paymentHistory"] ?? ""),
    };
  });

  const inquiries = (profile["inquiry"] as unknown[]) ?? [];
  const publicRecords = (profile["publicRecord"] as unknown[]) ?? [];
  const derogatory = tradelines.filter((t) => {
    const tl = t as Record<string, unknown>;
    const status = String(tl["accountStatus"] ?? "");
    return /derogatory|charge.?off|collection|bankruptcy/i.test(status);
  });

  const reportSummary = {
    tradelineSummary,
    inquiryCount: inquiries.length,
    derogatoryCount: derogatory.length,
    publicRecordsCount: publicRecords.length,
    tradelineCount: tradelines.length,
  };

  return { creditScore, reportSummary };
}

async function callExperianApi(params: {
  firstName: string;
  lastName: string;
  ssn: string;
  dob: string | null | undefined;
  address: string | null | undefined;
  city: string | null | undefined;
  state: string | null | undefined;
  zip: string | null | undefined;
  pullType: "soft" | "hard";
}): Promise<Record<string, unknown>> {
  const apiUrl = process.env["EXPERIAN_API_URL"];
  const apiKey = process.env["EXPERIAN_API_KEY"];
  const apiSecret = process.env["EXPERIAN_API_SECRET"];

  if (!apiUrl || !apiKey || !apiSecret) {
    throw Object.assign(
      new Error("Experian API credentials not configured. Set EXPERIAN_API_KEY, EXPERIAN_API_SECRET, and EXPERIAN_API_URL."),
      { statusCode: 503 },
    );
  }

  const body = {
    consumers: {
      name: [{ firstName: params.firstName, lastName: params.lastName }],
      ssn: [{ primary: params.ssn.replace(/\D/g, "") }],
      dob: params.dob ? [{ dob: params.dob }] : undefined,
      address: params.address ? [{
        addressLine1: params.address,
        city: params.city,
        state: params.state,
        zipCode: params.zip,
      }] : undefined,
    },
    addOns: {
      riskModels: { modelIndicator: [params.pullType === "hard" ? "V4H" : "V4S"], scorePercentile: "N" },
      directCheck: params.pullType === "hard",
    },
  };

  const tokenRes = await fetch(`${apiUrl}/oauth2/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => "");
    throw Object.assign(new Error(`Experian token request failed: ${tokenRes.status} ${errText}`), { statusCode: 502 });
  }

  const tokenData = await tokenRes.json() as { access_token: string };

  const creditRes = await fetch(`${apiUrl}/consumerservices/credit-profile/v2/credit-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tokenData.access_token}`,
      "clientReferenceId": `mbs-crm-${Date.now()}`,
    },
    body: JSON.stringify(body),
  });

  if (!creditRes.ok) {
    const errText = await creditRes.text().catch(() => "");
    throw Object.assign(new Error(`Experian API error: ${creditRes.status} ${errText}`), { statusCode: 502 });
  }

  return creditRes.json() as Promise<Record<string, unknown>>;
}

// ─── POST /api/leads/:id/credit/consent ─────────────────────────────────────

const ConsentBody = z.object({
  consent_type: z.literal("credit_pull"),
  agreed: z.literal(true),
});

router.post("/leads/:id/credit/consent", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });

  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  const body = ConsentBody.safeParse(req.body);
  if (!body.success || !body.data.agreed) {
    return void res.status(400).json({ error: "Explicit consent (agreed: true) required" });
  }

  const consentAt = new Date();
  const consentIp = req.ip ?? null;

  await db.update(leadsTable).set({
    consentCreditPullAt: consentAt,
    consentIp,
  }).where(eq(leadsTable.id, leadId));

  const [entry] = await db.insert(creditComplianceLogTable).values({
    leadId,
    userId: user.id,
    action: "consent_given",
    permissiblePurpose: "credit application evaluation",
    details: { consentType: body.data.consent_type, ip: consentIp },
  }).returning();

  res.status(201).json({ consentId: entry!.id });
});

// ─── POST /api/leads/:id/credit/pull ────────────────────────────────────────

const PullBody = z.object({
  pull_type: z.enum(["soft", "hard"]),
});

router.post("/leads/:id/credit/pull", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });

  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  const body = PullBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "pull_type must be 'soft' or 'hard'" });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (!lead.consentCreditPullAt || lead.consentCreditPullAt < thirtyDaysAgo) {
    return void res.status(422).json({ error: "No valid consent found. Consent must be captured within the last 30 days." });
  }

  const application = await db.query.applicationsTable.findFirst({
    where: eq(applicationsTable.leadId, leadId),
    orderBy: [desc(applicationsTable.submittedAt)],
  });

  if (!application?.ownerSsnEncrypted) {
    return void res.status(422).json({ error: "No application with encrypted SSN found for this lead. The applicant must submit a credit application first." });
  }

  let ssn: string;
  try {
    ssn = decrypt(application.ownerSsnEncrypted);
  } catch {
    return void res.status(500).json({ error: "Failed to decrypt SSN" });
  }

  const [pull] = await db.insert(creditPullsTable).values({
    leadId,
    pulledBy: user.id,
    pullType: body.data.pull_type,
    consentCapturedAt: lead.consentCreditPullAt!,
    consentIp: lead.consentIp,
    status: "pending",
  }).returning();

  const requestPayload = {
    leadId,
    pullType: body.data.pull_type,
    firstName: application.ownerFirstName,
    lastName: application.ownerLastName,
    dob: application.ownerDob,
    address: application.ownerHomeAddress,
    city: application.ownerHomeCity,
    state: application.ownerHomeState,
    zip: application.ownerHomeZip,
    ssn: "[REDACTED_FOR_AUDIT_LOG]",
  };

  let requestPayloadEncrypted: string;
  try {
    const fullRequest = { ...requestPayload, ssn };
    requestPayloadEncrypted = encrypt(JSON.stringify(fullRequest));
  } catch {
    await db.update(creditPullsTable).set({ status: "error", errorMessage: "ENCRYPTION_KEY not configured" }).where(eq(creditPullsTable.id, pull!.id));
    return void res.status(503).json({ error: "Encryption key not configured" });
  }

  await db.update(creditPullsTable).set({ requestPayloadEncrypted }).where(eq(creditPullsTable.id, pull!.id));

  let responseRaw: Record<string, unknown>;
  try {
    responseRaw = await callExperianApi({
      firstName: application.ownerFirstName,
      lastName: application.ownerLastName,
      ssn,
      dob: application.ownerDob,
      address: application.ownerHomeAddress,
      city: application.ownerHomeCity,
      state: application.ownerHomeState,
      zip: application.ownerHomeZip,
      pullType: body.data.pull_type,
    });
  } catch (err: unknown) {
    const e = err as Error & { statusCode?: number };
    await db.update(creditPullsTable).set({ status: "error", errorMessage: e.message }).where(eq(creditPullsTable.id, pull!.id));
    return void res.status(e.statusCode ?? 502).json({ error: e.message });
  }

  let responsePayloadEncrypted: string;
  try {
    responsePayloadEncrypted = encrypt(JSON.stringify(responseRaw));
  } catch {
    await db.update(creditPullsTable).set({ status: "error", errorMessage: "Failed to encrypt response" }).where(eq(creditPullsTable.id, pull!.id));
    return void res.status(503).json({ error: "Encryption key not configured" });
  }

  const { creditScore, reportSummary } = parseExperianResponse(responseRaw);

  await db.update(creditPullsTable).set({
    status: "completed",
    creditScore,
    reportSummary,
    responsePayloadEncrypted,
  }).where(eq(creditPullsTable.id, pull!.id));

  await db.insert(creditComplianceLogTable).values({
    creditPullId: pull!.id,
    leadId,
    userId: user.id,
    action: "credit_pull",
    permissiblePurpose: "credit application evaluation",
    details: { score: creditScore, pullType: body.data.pull_type },
  });

  await logActivity({
    userId: user.id,
    leadId,
    action: "credit_pull",
    entityType: "credit_pull",
    entityId: pull!.id,
    details: { message: `Credit report pulled, score: ${creditScore ?? "N/A"}` },
  });

  res.status(201).json({
    id: pull!.id,
    creditScore,
    pullType: body.data.pull_type,
    status: "completed",
    createdAt: pull!.createdAt,
    reportSummary,
  });
});

// ─── GET /api/leads/:id/credit ───────────────────────────────────────────────

router.get("/leads/:id/credit", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const leadId = parseInt(req.params["id"] as string, 10);
  if (isNaN(leadId)) return void res.status(400).json({ error: "Invalid lead ID" });

  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) return void res.status(404).json({ error: "Lead not found" });

  if (user.role === "rep" && lead.assignedRepId !== user.id) {
    return void res.status(403).json({ error: "Forbidden" });
  }

  const pulls = await db.query.creditPullsTable.findMany({
    where: eq(creditPullsTable.leadId, leadId),
    with: { pulledByUser: true },
    orderBy: [desc(creditPullsTable.createdAt)],
  });

  const results = pulls.map((p) => ({
    id: p.id,
    pullType: p.pullType,
    status: p.status,
    creditScore: p.creditScore,
    reportSummary: p.reportSummary,
    errorMessage: p.status === "error" ? p.errorMessage : undefined,
    pulledBy: p.pulledByUser ? { id: p.pulledByUser.id, name: p.pulledByUser.name } : null,
    consentCapturedAt: p.consentCapturedAt,
    createdAt: p.createdAt,
  }));

  res.json(results);
});

// ─── GET /api/credit/compliance-log ─────────────────────────────────────────

router.get("/credit/compliance-log", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role !== "admin") {
    return void res.status(403).json({ error: "Admin only" });
  }

  const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "25"), 10)));
  const offset = (page - 1) * limit;

  const startDate = req.query["startDate"] ? new Date(String(req.query["startDate"])) : null;
  const endDate = req.query["endDate"] ? new Date(String(req.query["endDate"])) : null;
  const repId = req.query["repId"] ? parseInt(String(req.query["repId"]), 10) : null;
  const filterLeadId = req.query["leadId"] ? parseInt(String(req.query["leadId"]), 10) : null;

  const conditions = [eq(creditComplianceLogTable.action, "credit_pull")];
  if (startDate && !isNaN(startDate.getTime())) conditions.push(gte(creditComplianceLogTable.createdAt, startDate));
  if (endDate && !isNaN(endDate.getTime())) {
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1);
    conditions.push(sql`${creditComplianceLogTable.createdAt} < ${end}`);
  }
  if (repId && !isNaN(repId)) conditions.push(eq(creditComplianceLogTable.userId, repId));
  if (filterLeadId && !isNaN(filterLeadId)) conditions.push(eq(creditComplianceLogTable.leadId, filterLeadId));

  const where = and(...conditions);

  const [totalRow] = await db.select({ total: count() }).from(creditComplianceLogTable).where(where);
  const total = Number(totalRow?.total ?? 0);

  const entries = await db.query.creditComplianceLogTable.findMany({
    where,
    with: {
      lead: true,
      user: true,
      creditPull: true,
    },
    orderBy: [desc(creditComplianceLogTable.createdAt)],
    limit,
    offset,
  });

  const data = entries.map((e) => ({
    id: e.id,
    leadId: e.leadId,
    leadName: e.lead ? [e.lead.firstName, e.lead.lastName].filter(Boolean).join(" ") || e.lead.companyName || `Lead #${e.leadId}` : `Lead #${e.leadId}`,
    pulledBy: e.user ? { id: e.user.id, name: e.user.name } : null,
    date: e.createdAt,
    pullType: e.creditPull?.pullType ?? null,
    score: (e.details as Record<string, unknown> | null)?.["score"] ?? null,
    permissiblePurpose: e.permissiblePurpose,
  }));

  res.json({ data, total, page, limit, pages: Math.ceil(total / limit) });
});

// ─── GET /api/credit/compliance-log/export ──────────────────────────────────

router.get("/credit/compliance-log/export", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.role !== "admin") {
    return void res.status(403).json({ error: "Admin only" });
  }

  const startDate = req.query["startDate"] ? new Date(String(req.query["startDate"])) : null;
  const endDate = req.query["endDate"] ? new Date(String(req.query["endDate"])) : null;
  const repId = req.query["repId"] ? parseInt(String(req.query["repId"]), 10) : null;
  const filterLeadId = req.query["leadId"] ? parseInt(String(req.query["leadId"]), 10) : null;

  const conditions = [eq(creditComplianceLogTable.action, "credit_pull")];
  if (startDate && !isNaN(startDate.getTime())) conditions.push(gte(creditComplianceLogTable.createdAt, startDate));
  if (endDate && !isNaN(endDate.getTime())) {
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1);
    conditions.push(sql`${creditComplianceLogTable.createdAt} < ${end}`);
  }
  if (repId && !isNaN(repId)) conditions.push(eq(creditComplianceLogTable.userId, repId));
  if (filterLeadId && !isNaN(filterLeadId)) conditions.push(eq(creditComplianceLogTable.leadId, filterLeadId));

  const entries = await db.query.creditComplianceLogTable.findMany({
    where: and(...conditions),
    with: { lead: true, user: true, creditPull: true },
    orderBy: [desc(creditComplianceLogTable.createdAt)],
  });

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const header = ["Date", "Lead Name", "Lead ID", "Pulled By", "Pull Type", "Score", "Permissible Purpose"].map(esc).join(",");
  const rows = entries.map((e) => {
    const leadName = e.lead ? [e.lead.firstName, e.lead.lastName].filter(Boolean).join(" ") || e.lead.companyName || `Lead #${e.leadId}` : `Lead #${e.leadId}`;
    const score = (e.details as Record<string, unknown> | null)?.["score"] ?? "";
    return [
      e.createdAt.toISOString(),
      leadName,
      e.leadId,
      e.user?.name ?? "",
      e.creditPull?.pullType ?? "",
      score,
      e.permissiblePurpose,
    ].map(esc).join(",");
  });

  const csv = [header, ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="credit-compliance-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

export default router;
