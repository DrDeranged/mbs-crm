# MBS CRM — Detailed Optimization Prompts for Replit Agent
# Paste each prompt into Replit Agent one at a time.
# Wait for each to complete and test before moving to the next.
# These reference the EXISTING codebase structure — do not restructure.

================================================================================
PROMPT 1 — PRODUCTION SECURITY HARDENING
================================================================================

Harden the API server for production. Do NOT remove or break any existing functionality. The existing file structure uses Express 5 in artifacts/api-server/src/app.ts with pino logging, Clerk middleware, and CORS already configured.

STEP 1: Install helmet.
Run: pnpm --filter @workspace/api-server add helmet

STEP 2: Edit artifacts/api-server/src/app.ts.
Add this import at the top with the other imports:
import helmet from "helmet";

Add this line IMMEDIATELY after the pino-http middleware block and BEFORE the cors() line:
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
The CSP and COEP are disabled because the React frontend is served from the same origin and needs inline scripts.

STEP 3: Add body size limit. In the same file, modify the existing express.json() call:
Change:
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));
To:
app.use(express.json({
  limit: "10mb",
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));

STEP 4: Add a global error handler. At the VERY END of app.ts, AFTER the line app.use("/api", router); and BEFORE export default app;, add:

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.statusCode || err.status || 500;
  logger.error({ err, status }, "Unhandled error");
  res.status(status).json({
    error: status >= 500 ? "Internal server error" : (err.message || "An error occurred"),
  });
});

STEP 5: Add input sanitization utility. Create a new file artifacts/api-server/src/lib/sanitize.ts:

/**
 * Escapes special characters in strings used with SQL ILIKE/LIKE.
 * Prevents users from injecting wildcard patterns.
 */
export function sanitizeLikeInput(input: string): string {
  return input.replace(/[%_\\]/g, (char) => `\\${char}`);
}

STEP 6: Apply sanitization in leads.ts. Edit artifacts/api-server/src/routes/leads.ts.
Add import at the top:
import { sanitizeLikeInput } from "../lib/sanitize";

Find the search block (around line 87-95) that builds searchCondition using ilike. Wrap each search term:
Change every occurrence of:
  ilike(leadsTable.firstName, `%${q.search}%`)
To:
  ilike(leadsTable.firstName, `%${sanitizeLikeInput(String(q.search))}%`)

Do this for ALL ilike calls in that block (firstName, lastName, companyName, email, phone).

Also apply sanitizeLikeInput to the individual field filters earlier in the function (email, phone, ein around lines 55-57).

STEP 7: Restrict CORS for production. In app.ts, change:
app.use(cors({ credentials: true, origin: true }));
To:
app.use(cors({
  credentials: true,
  origin: process.env.NODE_ENV === "production"
    ? (process.env.ALLOWED_ORIGINS || "https://app.my-business-solutions.com").split(",")
    : true,
}));

STEP 8: Delete orphaned schema files. Remove these two files that are unused scaffolding:
- lib/db/src/schema/conversations.ts
- lib/db/src/schema/messages.ts
These files are NOT exported from lib/db/src/schema/index.ts and are not imported anywhere in the codebase.

STEP 9: Verify. Run pnpm run typecheck and pnpm run build to confirm nothing is broken.


================================================================================
PROMPT 2 — LEAD CSV EXPORT & BULK ACTIONS
================================================================================

Add CSV export for leads and bulk actions (bulk status change, bulk assign, bulk delete) to the existing CRM. Reference existing patterns: the credit compliance CSV export in artifacts/api-server/src/routes/credit.ts (lines 437-490) for CSV format, and the role-based access pattern using requireUser() from artifacts/api-server/src/lib/authHelpers.ts.

BACKEND — Edit artifacts/api-server/src/routes/leads.ts:

Add these new endpoints BEFORE the "export default router" line at the bottom of the file.

1. GET /leads/export — CSV export of leads.

router.get("/leads/export", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  // Build the same filter conditions as the GET /leads endpoint
  const conditions: any[] = [];
  const q = req.query;
  if (user.role === "rep") conditions.push(eq(leadsTable.assignedRepId, user.id));
  if (q.status) conditions.push(eq(leadsTable.status, q.status as any));
  if (q.applicationType) conditions.push(eq(leadsTable.applicationType, q.applicationType as any));
  if (q.repId) conditions.push(eq(leadsTable.assignedRepId, Number(q.repId)));
  if (q.search) {
    const s = sanitizeLikeInput(String(q.search));
    conditions.push(or(
      ilike(leadsTable.firstName, `%${s}%`),
      ilike(leadsTable.lastName, `%${s}%`),
      ilike(leadsTable.companyName, `%${s}%`),
      ilike(leadsTable.email, `%${s}%`),
      ilike(leadsTable.phone, `%${s}%`),
    ));
  }

  const leads = await db.query.leadsTable.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    with: { assignedRep: true, company: true },
    orderBy: [desc(leadsTable.createdAt)],
  });

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["ID", "First Name", "Last Name", "Email", "Phone", "Company", "EIN", "Application Type", "Status", "Assigned Rep", "Lead Source", "Requested Amount", "Credit Score", "Created At"].map(esc).join(",");
  const rows = leads.map((l) => [
    l.id,
    l.firstName,
    l.lastName,
    l.email,
    l.phone,
    l.companyName,
    l.ein,
    l.applicationType,
    l.status,
    l.assignedRep?.name ?? "",
    l.leadSource,
    l.requestedAmount ?? "",
    l.creditScore ?? "",
    l.createdAt.toISOString(),
  ].map(esc).join(","));

  const csv = [header, ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

2. POST /leads/bulk/status — Bulk status change (manager/admin only).

const BulkStatusBody = z.object({
  leadIds: z.array(z.number()).min(1).max(500),
  status: z.enum(LEAD_STATUSES),
});

router.post("/leads/bulk/status", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") return void res.status(403).json({ error: "Manager or admin required" });

  const body = BulkStatusBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid request", details: body.error.issues });

  let updated = 0;
  for (const leadId of body.data.leadIds) {
    const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
    if (!lead) continue;
    const oldStatus = lead.status;
    if (oldStatus === body.data.status) continue;

    await db.update(leadsTable).set({ status: body.data.status, updatedAt: new Date() }).where(eq(leadsTable.id, leadId));
    await db.insert(leadStatusHistoryTable).values({
      leadId, fromStatus: oldStatus, toStatus: body.data.status, changedByUserId: user.id,
    });
    await logActivity({ userId: user.id, leadId, action: "status_change", entityType: "lead", entityId: leadId, details: { from: oldStatus, to: body.data.status, bulk: true } });
    updated++;
  }

  res.json({ updated, total: body.data.leadIds.length });
});

3. POST /leads/bulk/assign — Bulk reassignment (manager/admin only).

const BulkAssignBody = z.object({
  leadIds: z.array(z.number()).min(1).max(500),
  repId: z.number(),
});

router.post("/leads/bulk/assign", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role === "rep") return void res.status(403).json({ error: "Manager or admin required" });

  const body = BulkAssignBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid request" });

  const rep = await db.query.usersTable.findFirst({ where: eq(usersTable.id, body.data.repId) });
  if (!rep) return void res.status(404).json({ error: "Rep not found" });

  let updated = 0;
  for (const leadId of body.data.leadIds) {
    const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
    if (!lead || lead.assignedRepId === body.data.repId) continue;

    await db.update(leadsTable).set({ assignedRepId: body.data.repId, updatedAt: new Date() }).where(eq(leadsTable.id, leadId));
    await db.insert(leadAssignmentHistoryTable).values({
      leadId, fromRepId: lead.assignedRepId, toRepId: body.data.repId, assignedByUserId: user.id,
    });
    await logActivity({ userId: user.id, leadId, action: "reassign", entityType: "lead", entityId: leadId, details: { toRepId: body.data.repId, toRepName: rep.name, bulk: true } });
    updated++;
  }

  if (rep.pushToken) {
    const { sendPushNotification } = await import("../lib/pushNotifications");
    sendPushNotification(rep.pushToken, "Leads Assigned", `${updated} leads have been assigned to you`, {}).catch(() => {});
  }

  res.json({ updated, total: body.data.leadIds.length });
});

4. POST /leads/bulk/delete — Bulk delete (admin only).

const BulkDeleteBody = z.object({
  leadIds: z.array(z.number()).min(1).max(500),
});

router.post("/leads/bulk/delete", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.role !== "admin") return void res.status(403).json({ error: "Admin only" });

  const body = BulkDeleteBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid request" });

  let deleted = 0;
  for (const leadId of body.data.leadIds) {
    await db.delete(leadsTable).where(eq(leadsTable.id, leadId));
    await logActivity({ userId: user.id, action: "delete_lead", entityType: "lead", entityId: leadId, details: { bulk: true } });
    deleted++;
  }

  res.json({ deleted, total: body.data.leadIds.length });
});

Make sure to import the necessary items at the top of leads.ts if not already present: leadStatusHistoryTable, leadAssignmentHistoryTable, z (from "zod/v4"), LEAD_STATUSES, sanitizeLikeInput, logActivity, sendPushNotification.

BACKEND — Add these new endpoints to lib/api-spec/openapi.yaml and re-run codegen: pnpm --filter @workspace/api-spec run codegen

FRONTEND — Edit artifacts/mbs-crm/src/pages/leads.tsx:

Add selection functionality to the leads table:

1. Add state: const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

2. Add a checkbox column as the first column in the table. The header checkbox toggles select-all (for the current page). Each row checkbox toggles that lead's selection.

3. When selectedIds.size > 0, show a floating action bar fixed to the bottom of the page (use a div with position: fixed, bottom: 0, left/right with padding, bg-white border-t shadow-lg z-50). The bar shows:
   - "{N} selected" text
   - "Change Status" button → opens a dropdown with all status options → on select, calls POST /api/leads/bulk/status with the selected IDs and chosen status, then refetches the lead list
   - "Assign To" button → opens a dropdown with all reps → on select, calls POST /api/leads/bulk/assign
   - "Export Selected" button → calls GET /api/leads/export with a query param for specific IDs (or filter client-side from the already-loaded data)
   - "Delete" button (admin only, red) → shows AlertDialog confirmation → calls POST /api/leads/bulk/delete
   - "Clear Selection" button (ghost) → clears selectedIds

4. Add an "Export All" button in the page header (next to "New Lead" and "Import"):
   - Uses an anchor tag: <a href="/api/leads/export?[current filters as query params]" download>Export CSV</a>
   - Passes the current status/type/search/date filters as query params so the export matches what the user sees

Use the existing shadcn/ui Button, DropdownMenu, AlertDialog, and Checkbox components already in the project.


================================================================================
PROMPT 3 — IN-APP NOTIFICATIONS CENTER
================================================================================

Add a notification system so reps see new leads, messages, and status changes without manually refreshing. This is critical for the daily workflow.

SCHEMA — Create a new file lib/db/src/schema/notifications.ts:

import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { leadsTable } from "./leads";

export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["lead_assigned", "task_due", "sms_received", "status_changed", "credit_pulled", "application_received", "call_received"],
    }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "cascade" }),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId),
    index("notifications_user_read_idx").on(t.userId, t.isRead),
  ],
);

Export it from lib/db/src/schema/index.ts by adding: export * from "./notifications";

Add relations in lib/db/src/schema/relations.ts:
import { notificationsTable } from "./notifications";

export const notificationsRelations = relations(notificationsTable, ({ one }) => ({
  user: one(usersTable, { fields: [notificationsTable.userId], references: [usersTable.id] }),
  lead: one(leadsTable, { fields: [notificationsTable.leadId], references: [leadsTable.id] }),
}));

Add notifications to usersRelations (in the existing block): notifications: many(notificationsTable),

Run: pnpm --filter @workspace/db run push

BACKEND — Create artifacts/api-server/src/lib/notify.ts:

import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { sendPushNotification } from "./pushNotifications";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface NotifyParams {
  userId: number;
  type: typeof notificationsTable.$inferInsert["type"];
  title: string;
  body: string;
  leadId?: number;
}

export async function createNotification(params: NotifyParams): Promise<void> {
  await db.insert(notificationsTable).values({
    userId: params.userId,
    type: params.type,
    title: params.title,
    body: params.body,
    leadId: params.leadId ?? null,
  });

  // Also send push notification if the user has a push token
  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, params.userId) });
  if (user?.pushToken) {
    sendPushNotification(user.pushToken, params.title, params.body, { leadId: params.leadId }).catch(() => {});
  }
}

export async function notifyAllManagers(type: typeof notificationsTable.$inferInsert["type"], title: string, body: string, leadId?: number): Promise<void> {
  const managers = await db.query.usersTable.findMany({
    where: (u, { or, eq }) => or(eq(u.role, "admin"), eq(u.role, "manager")),
  });
  for (const m of managers) {
    await createNotification({ userId: m.id, type, title, body, leadId });
  }
}

BACKEND — Create artifacts/api-server/src/routes/notifications.ts:

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { requireUser } from "../lib/authHelpers";

const router = Router();

// GET /notifications — list notifications for the current user
router.get("/notifications", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const offset = (page - 1) * limit;

  const notifications = await db.query.notificationsTable.findMany({
    where: eq(notificationsTable.userId, user.id),
    orderBy: [desc(notificationsTable.createdAt)],
    limit,
    offset,
    with: { lead: true },
  });

  const [totalRow] = await db.select({ total: count() }).from(notificationsTable).where(eq(notificationsTable.userId, user.id));

  res.json({
    data: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      leadId: n.leadId,
      leadName: n.lead ? [n.lead.firstName, n.lead.lastName].filter(Boolean).join(" ") || n.lead.companyName : null,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    })),
    total: Number(totalRow?.total ?? 0),
    page,
    limit,
  });
});

// GET /notifications/unread-count
router.get("/notifications/unread-count", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const [row] = await db.select({ count: count() }).from(notificationsTable)
    .where(and(eq(notificationsTable.userId, user.id), eq(notificationsTable.isRead, false)));

  res.json({ count: Number(row?.count ?? 0) });
});

// PUT /notifications/:id/read
router.put("/notifications/:id/read", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = parseInt(req.params.id as string, 10);
  await db.update(notificationsTable).set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, user.id)));

  res.json({ success: true });
});

// PUT /notifications/read-all
router.put("/notifications/read-all", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;

  await db.update(notificationsTable).set({ isRead: true })
    .where(and(eq(notificationsTable.userId, user.id), eq(notificationsTable.isRead, false)));

  res.json({ success: true });
});

export default router;

Register the route in artifacts/api-server/src/routes/index.ts:
import notificationsRouter from "./notifications";
router.use(notificationsRouter);

BACKEND — Wire notifications into existing flows. Edit these files to call createNotification():

1. artifacts/api-server/src/routes/leads.ts — in the status change handler (PUT /leads/:id/status), after the existing logActivity call, add:
   if (lead.assignedRepId && lead.assignedRepId !== user.id) {
     createNotification({
       userId: lead.assignedRepId,
       type: "status_changed",
       title: "Lead Status Changed",
       body: `${[lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.companyName} changed to ${body.data.status}`,
       leadId: params.data.id,
     });
   }

   In the assign handler (PUT /leads/:id/assign), after the existing push notification, add:
   createNotification({
     userId: body.data.repId,
     type: "lead_assigned",
     title: "Lead Assigned to You",
     body: `${leadName} has been assigned to you`,
     leadId: lead.id,
   });

2. artifacts/api-server/src/routes/twilio.ts — in the inbound SMS handler, after storing the message, add:
   if (lead?.assignedRepId) {
     createNotification({
       userId: lead.assignedRepId,
       type: "sms_received",
       title: "New SMS Received",
       body: `Message from ${lead.firstName || lead.companyName || fromNumber}`,
       leadId: lead.id,
     });
   }

3. artifacts/api-server/src/routes/applications.ts — after a new application is submitted and the lead is created, add:
   notifyAllManagers("application_received", "New Application", `${businessName} submitted a ${type} application`, leadId);
   if (assignedRepId) {
     createNotification({ userId: assignedRepId, type: "application_received", title: "New Application Assigned", body: `${businessName} - ${type}`, leadId });
   }

Import createNotification and notifyAllManagers in each file:
import { createNotification, notifyAllManagers } from "../lib/notify";

Add the notification endpoints to openapi.yaml and re-run codegen.

FRONTEND — Add notification bell to the app shell.

Edit artifacts/mbs-crm/src/components/app-shell.tsx:

1. Import Bell icon: import { Bell } from "lucide-react";
2. Import the notification hooks (after codegen): import { useGetNotificationsUnreadCount, useGetNotifications, usePutNotificationsReadAll } from "@workspace/api-client-react";
3. Import Popover: import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
4. Import useLocation from wouter for navigation.

5. In the SidebarContent component (or in the AppShell main layout), add a notification bell in the header area (the top bar on mobile, or next to the user info on desktop):

Create a NotificationBell component:
- Fetch unread count with useGetNotificationsUnreadCount() — refetch every 30 seconds using { refetchInterval: 30000 }
- Show a Bell icon with a red badge showing the unread count (if > 0)
- On click, open a Popover showing the last 10 notifications fetched from useGetNotifications({ limit: 10 })
- Each notification row shows: icon (by type), title, body (truncated), relative time ("2m ago")
- Clicking a notification navigates to /leads/[leadId] and marks it as read
- "Mark all as read" button at the top of the popover
- "View all" link at the bottom (optional — can navigate to a full notifications page later)

Place the NotificationBell in the mobile top bar (the div with md:hidden) and in the desktop sidebar header area.


================================================================================
PROMPT 4 — LEAD SCORING ENGINE
================================================================================

Add an automated lead scoring system (0-100) based on financial data, application completeness, and business profile. This helps reps prioritize high-quality leads.

SCHEMA — Edit lib/db/src/schema/leads.ts. Add two columns to the leadsTable:
  leadScore: integer("lead_score"),
  leadScoreBreakdown: jsonb("lead_score_breakdown"),

Run: pnpm --filter @workspace/db run push

BACKEND — Create artifacts/api-server/src/lib/leadScoring.ts:

import { db } from "@workspace/db";
import { leadsTable, companiesTable, applicationsTable, bankStatementExtractionsTable } from "@workspace/db";
import { eq, avg } from "drizzle-orm";

interface ScoreCriterion {
  name: string;
  points: number;
  maxPoints: number;
  detail: string;
}

interface ScoreResult {
  score: number;
  breakdown: ScoreCriterion[];
}

export async function calculateLeadScore(leadId: number): Promise<ScoreResult> {
  const lead = await db.query.leadsTable.findFirst({
    where: eq(leadsTable.id, leadId),
    with: { company: true },
  });
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const company = (lead as any).company;
  const application = await db.query.applicationsTable.findFirst({ where: eq(applicationsTable.leadId, leadId) });
  const extractions = await db.query.bankStatementExtractionsTable.findMany({ where: eq(bankStatementExtractionsTable.leadId, leadId) });

  const breakdown: ScoreCriterion[] = [];

  // 1. Monthly revenue (0-25 pts)
  if (extractions.length > 0) {
    const avgDeposits = extractions.reduce((sum, e) => sum + (Number(e.totalDeposits) || 0), 0) / extractions.length;
    let pts = 0;
    let detail = "";
    if (avgDeposits > 50000) { pts = 25; detail = `Avg monthly deposits $${Math.round(avgDeposits).toLocaleString()} (excellent)`; }
    else if (avgDeposits > 25000) { pts = 20; detail = `Avg monthly deposits $${Math.round(avgDeposits).toLocaleString()} (strong)`; }
    else if (avgDeposits > 10000) { pts = 15; detail = `Avg monthly deposits $${Math.round(avgDeposits).toLocaleString()} (moderate)`; }
    else if (avgDeposits > 5000) { pts = 10; detail = `Avg monthly deposits $${Math.round(avgDeposits).toLocaleString()} (low)`; }
    else { pts = 5; detail = `Avg monthly deposits $${Math.round(avgDeposits).toLocaleString()} (very low)`; }
    breakdown.push({ name: "Monthly Revenue", points: pts, maxPoints: 25, detail });
  } else {
    breakdown.push({ name: "Monthly Revenue", points: 0, maxPoints: 25, detail: "No bank statements uploaded" });
  }

  // 2. Average daily balance (0-15 pts)
  if (extractions.length > 0) {
    const avgBalance = extractions.reduce((sum, e) => sum + (Number(e.averageDailyBalance) || 0), 0) / extractions.length;
    let pts = 0;
    if (avgBalance > 10000) pts = 15;
    else if (avgBalance > 5000) pts = 12;
    else if (avgBalance > 2000) pts = 8;
    else pts = 4;
    breakdown.push({ name: "Avg Daily Balance", points: pts, maxPoints: 15, detail: `$${Math.round(avgBalance).toLocaleString()} average` });
  } else {
    breakdown.push({ name: "Avg Daily Balance", points: 0, maxPoints: 15, detail: "No data" });
  }

  // 3. NSF history (0-15 pts)
  if (extractions.length > 0) {
    const avgNsf = extractions.reduce((sum, e) => sum + (e.nsfCount || 0), 0) / extractions.length;
    let pts = 0;
    if (avgNsf === 0) pts = 15;
    else if (avgNsf <= 2) pts = 10;
    else if (avgNsf <= 5) pts = 5;
    else pts = 0;
    breakdown.push({ name: "NSF History", points: pts, maxPoints: 15, detail: `${avgNsf.toFixed(1)} avg NSFs/month` });
  } else {
    breakdown.push({ name: "NSF History", points: 0, maxPoints: 15, detail: "No data" });
  }

  // 4. Existing positions (0-15 pts)
  const positions = lead.existingPositions ?? 0;
  let posPts = 0;
  if (positions === 0) posPts = 15;
  else if (positions === 1) posPts = 12;
  else if (positions === 2) posPts = 8;
  else posPts = 3;
  breakdown.push({ name: "Existing Positions", points: posPts, maxPoints: 15, detail: `${positions} detected` });

  // 5. Time in business (0-15 pts)
  const tib = company?.timeInBusinessMonths ?? 0;
  let tibPts = 0;
  if (tib >= 60) tibPts = 15;
  else if (tib >= 24) tibPts = 12;
  else if (tib >= 12) tibPts = 8;
  else if (tib >= 6) tibPts = 5;
  else tibPts = 2;
  breakdown.push({ name: "Time in Business", points: tibPts, maxPoints: 15, detail: tib > 0 ? `${tib} months` : "Unknown" });

  // 6. Application completeness (0-15 pts)
  let compPts = 0;
  if (application) {
    compPts = 5; // base for having an application
    if (extractions.length >= 3) compPts += 5; // bank statements uploaded
    if (application.consentCreditPull) compPts += 3; // consent given
    if (application.signatureData) compPts += 2; // signed
  }
  breakdown.push({ name: "Application Completeness", points: compPts, maxPoints: 15, detail: application ? "Application submitted" : "No application" });

  const score = breakdown.reduce((sum, b) => sum + b.points, 0);

  // Save to lead
  await db.update(leadsTable).set({ leadScore: score, leadScoreBreakdown: breakdown }).where(eq(leadsTable.id, leadId));

  return { score, breakdown };
}

BACKEND — Wire auto-calculation into existing flows:

1. Edit artifacts/api-server/src/routes/applications.ts — after OCR extraction completes (after the bank statement processing loop), add:
   import { calculateLeadScore } from "../lib/leadScoring";
   await calculateLeadScore(leadId).catch((err) => logger.error({ err }, "Lead scoring failed"));

2. Edit artifacts/api-server/src/routes/credit.ts — after a successful credit pull (where creditScore is saved to the lead), add:
   import { calculateLeadScore } from "../lib/leadScoring";
   await calculateLeadScore(leadId).catch(() => {});

3. Add an endpoint for manual re-calculation:
   POST /api/leads/:id/score — triggers calculateLeadScore(leadId), returns the result.

FRONTEND — Edit artifacts/mbs-crm/src/pages/leads.tsx:

1. Add a "Score" column to the lead table (after Status). Show the score as a colored badge:
   - Green (bg-green-100 text-green-800) for 70+
   - Yellow (bg-yellow-100 text-yellow-800) for 40-69
   - Red (bg-red-100 text-red-800) for < 40
   - Gray (bg-gray-100 text-gray-500) for null/undefined with text "—"
2. Make the column sortable (add "leadScore" to the validSortFields in the API).
3. Add filter chips: "High Score (70+)", "Medium (40-69)", "Low (<40)".

FRONTEND — Edit artifacts/mbs-crm/src/pages/lead-detail.tsx:

In the Info tab header area (near the status badge), add a score indicator:
- A circular gauge or a horizontal progress bar showing the score (0-100)
- Color-coded: green/yellow/red
- Clicking it expands to show the full breakdown: a list of criteria with name, points/maxPoints, and detail text
- A small "Recalculate" button that calls POST /api/leads/:id/score and refreshes

Add the new endpoints to openapi.yaml and re-run codegen.


================================================================================
PROMPT 5 — AUTOMATED WORKFLOW RULES & TASK CREATION
================================================================================

Add automated task creation on status changes so the pipeline becomes a guided workflow.

SCHEMA — Create lib/db/src/schema/workflowRules.ts:

import { pgTable, serial, integer, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { LEAD_STATUSES } from "./leads";

export const workflowRulesTable = pgTable("workflow_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  triggerStatus: text("trigger_status", { enum: LEAD_STATUSES }).notNull(),
  actionType: text("action_type", { enum: ["create_task", "send_notification"] }).notNull(),
  actionConfig: jsonb("action_config").notNull(),
  // actionConfig for create_task: { taskTitle: string, taskDescription: string, dueDaysFromNow: number, dueHoursFromNow: number }
  // actionConfig for send_notification: { title: string, body: string }
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

Export from lib/db/src/schema/index.ts. Add relations. Run push.

BACKEND — Create artifacts/api-server/src/lib/workflowEngine.ts:

import { db } from "@workspace/db";
import { workflowRulesTable, tasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logActivity } from "./activityHelper";
import { createNotification } from "./notify";

export async function executeWorkflowRules(leadId: number, newStatus: string, assignedRepId: number | null, userId: number): Promise<void> {
  const rules = await db.query.workflowRulesTable.findMany({
    where: (r, { and, eq }) => and(eq(r.triggerStatus, newStatus as any), eq(r.isActive, true)),
  });

  for (const rule of rules) {
    const config = rule.actionConfig as Record<string, any>;

    if (rule.actionType === "create_task" && assignedRepId) {
      const dueDate = new Date();
      if (config.dueDaysFromNow) dueDate.setDate(dueDate.getDate() + config.dueDaysFromNow);
      if (config.dueHoursFromNow) dueDate.setHours(dueDate.getHours() + config.dueHoursFromNow);

      await db.insert(tasksTable).values({
        leadId,
        userId: assignedRepId,
        title: config.taskTitle || rule.name,
        description: config.taskDescription || "",
        dueDate,
        isCompleted: false,
      });

      await logActivity({ userId, leadId, action: "auto_task_created", entityType: "task", entityId: leadId, details: { ruleName: rule.name, taskTitle: config.taskTitle } });
    }

    if (rule.actionType === "send_notification" && assignedRepId) {
      await createNotification({
        userId: assignedRepId,
        type: "status_changed",
        title: config.title || rule.name,
        body: config.body || `Workflow rule triggered: ${rule.name}`,
        leadId,
      });
    }
  }
}

BACKEND — Wire into leads.ts. In the status change handler (PUT /leads/:id/status), AFTER the existing matching trigger and drip enrollment trigger, add:

import { executeWorkflowRules } from "../lib/workflowEngine";
await executeWorkflowRules(params.data.id, body.data.status, lead.assignedRepId, user.id).catch((err) => logger.error({ err }, "Workflow rules failed"));

BACKEND — Create artifacts/api-server/src/routes/workflowRules.ts with full CRUD (admin only):
- GET /workflow-rules — list all rules
- POST /workflow-rules — create a rule (body: name, triggerStatus, actionType, actionConfig)
- PUT /workflow-rules/:id — update a rule
- DELETE /workflow-rules/:id — delete a rule

Register in routes/index.ts.

SEED DEFAULT RULES — Add a seed script or include in the initial prompt to Replit: insert these default workflow rules into the database after the tables are created:

1. { name: "Follow-up reminder", triggerStatus: "contacted", actionType: "create_task", actionConfig: { taskTitle: "Follow up with lead", taskDescription: "24-hour follow-up after initial contact", dueDaysFromNow: 1 } }
2. { name: "Review application", triggerStatus: "application_received", actionType: "create_task", actionConfig: { taskTitle: "Review application and financials", taskDescription: "Check the application details and bank statement data", dueHoursFromNow: 2 } }
3. { name: "Check lender response", triggerStatus: "submitted_to_underwriting", actionType: "create_task", actionConfig: { taskTitle: "Check lender response", taskDescription: "Follow up on submission status", dueDaysFromNow: 2 } }
4. { name: "Send approval notice", triggerStatus: "approved", actionType: "create_task", actionConfig: { taskTitle: "Notify merchant of approval", taskDescription: "Call or email the merchant with the good news", dueHoursFromNow: 1 } }
5. { name: "Confirm funding", triggerStatus: "funded", actionType: "create_task", actionConfig: { taskTitle: "Confirm funding received", taskDescription: "Verify the merchant received funds and follow up", dueDaysFromNow: 1 } }
6. { name: "Discuss alternatives", triggerStatus: "declined", actionType: "create_task", actionConfig: { taskTitle: "Discuss alternatives with merchant", taskDescription: "Review other funding options", dueDaysFromNow: 1 } }

FRONTEND — Add a "Workflow Rules" page under Administration in the sidebar (admin only).
Add to the app shell navItems (admin section): { href: "/workflow-rules", label: "Workflow Rules", icon: Zap }
Create artifacts/mbs-crm/src/pages/workflow-rules.tsx:
- Table listing all rules with columns: Name, Trigger Status, Action Type, Active (toggle switch)
- "Add Rule" button opens a dialog with: name input, trigger status dropdown (from LEAD_STATUSES), action type dropdown, and dynamic config fields based on action type
- For create_task: taskTitle input, taskDescription textarea, dueDaysFromNow number input, dueHoursFromNow number input
- Edit and delete buttons per row
- Use existing shadcn/ui Dialog, Switch, Select, Input, Button components

Add to App.tsx routes:
<Route path="/workflow-rules"><ProtectedRoute component={WorkflowRules} /></Route>

Add endpoints to openapi.yaml and re-run codegen.


================================================================================
PROMPT 6 — CALL NOTES & POST-CALL WORKFLOW
================================================================================

Add the ability for reps to take notes during calls and log call outcomes, with an optional follow-up task.

SCHEMA — Edit lib/db/src/schema/communications.ts. Add two columns to communicationsTable:
  callNotes: text("call_notes"),
  callOutcome: text("call_outcome", { enum: ["connected", "voicemail", "no_answer", "wrong_number", "busy"] }),

Run: pnpm --filter @workspace/db run push

BACKEND — Edit artifacts/api-server/src/routes/communications.ts (or twilio.ts, wherever the communications update endpoint is). Add or update:

PUT /api/communications/:id — update a communication record (to save call notes and outcome after a call):
  Body: { callNotes?: string, callOutcome?: string }
  Only allow the user who made/received the call OR a manager/admin to update
  Log to activity_log

If this endpoint doesn't exist, create it. Only callNotes and callOutcome should be updateable — not the call itself, direction, recording, etc.

FRONTEND — Edit artifacts/mbs-crm/src/components/softphone-widget.tsx:

1. Add a collapsible notes textarea below the call controls during an active call. Use a small "Notes" button that expands a textarea. Text entered here is stored in component state.

2. When a call ends (the Twilio device fires a "disconnect" event), show a post-call modal (Dialog):
   - Header: "Call Summary — [Lead Name]"
   - Call duration display (from the call timer)
   - Notes textarea (pre-filled with anything typed during the call)
   - Outcome selector: radio buttons or a select dropdown with options: Connected, Voicemail, No Answer, Wrong Number, Busy
   - Checkbox: "Schedule follow-up" — when checked, shows a date picker for the follow-up due date
   - "Save" button:
     - Calls PUT /api/communications/:id with { callNotes, callOutcome }
     - If follow-up is checked, calls POST /api/leads/:leadId/tasks with { title: "Follow up on call", dueDate: selectedDate }
     - Close the modal
   - "Skip" button: close without saving

3. To get the communication ID for the PUT call: when an outbound call is initiated and the server creates the communication record, the response should include the communication ID. Store it in the softphone context so the post-call modal can reference it.

FRONTEND — Edit the Communications tab in artifacts/mbs-crm/src/pages/lead-detail.tsx:

For call entries in the communications thread, add below the existing duration/recording line:
- If callOutcome exists: show a small badge (e.g., "Connected" in green, "Voicemail" in yellow, "No Answer" in gray)
- If callNotes exists: show the notes text in a slightly indented, muted block below the call entry. Truncate long notes with "Show more" toggle.


================================================================================
PROMPT 7 — APPLICATION STATUS PAGE FOR MERCHANTS
================================================================================

Add a public status tracking page so merchants can check their application status without calling.

SCHEMA — Edit lib/db/src/schema/leads.ts. Add a column:
  trackingToken: text("tracking_token").unique(),

Run: pnpm --filter @workspace/db run push

BACKEND — Edit artifacts/api-server/src/routes/applications.ts:

1. When creating a lead via the /applications/submit endpoint, generate a tracking token:
   import { randomBytes } from "crypto";
   const trackingToken = randomBytes(6).toString("hex"); // 12-char hex token
   Include trackingToken in the lead insert.

2. Add a PUBLIC endpoint (no auth):
   GET /api/applications/status/:token
   - Look up the lead by trackingToken
   - If not found: return 404 { error: "Not found" }
   - If found: return ONLY safe public data:
     {
       status: lead.status,
       applicationType: lead.applicationType,
       companyName: lead.companyName,
       assignedRepName: rep?.name || "MBS Team",
       submittedAt: application?.submittedAt,
       statusHistory: [{ status, changedAt }] // from leadStatusHistory, most recent first
     }
   - Do NOT return: SSN, email, phone, financial data, credit data, or any PII

3. Include the tracking token in the application confirmation (if an email is sent on submit).

FRONTEND — Create artifacts/mbs-crm/src/pages/application-status.tsx:

A public page (no auth required) with:
- MBS branding (logo, navy #1F4E79 header)
- A centered card with an input field: "Enter your tracking number"
- Submit button
- On submit: call GET /api/applications/status/:token
- If found, show:
  - Company name
  - Application type
  - A visual timeline/stepper showing all statuses in order:
    Application Received → Contacted → Submitted to Underwriting → Approved → Funded
  - The current status is highlighted (filled circle), past statuses have checkmarks, future statuses are empty circles
  - Each completed status shows the date it was reached
  - "Your representative: [name]"
  - "Questions? Contact us at [phone/email]"
- If not found: "We couldn't find an application with that tracking number. Please double-check and try again, or contact us."

Add route in App.tsx (public, no ProtectedRoute):
<Route path="/apply/status" component={ApplicationStatus} />


================================================================================
PROMPT 8 — UI/UX POLISH
================================================================================

Polish the existing UI for production quality. Do NOT change any functionality — only improve the visual experience.

1. LOADING SKELETONS — Replace any bare spinner or loading text with skeleton loaders that match the content layout.

Edit artifacts/mbs-crm/src/pages/leads.tsx:
While data is loading (before the table renders), show 8 skeleton rows matching the table column widths. Use the existing Skeleton component from @/components/ui/skeleton:
<div className="space-y-2">
  {Array.from({ length: 8 }).map((_, i) => (
    <div key={i} className="flex gap-4 px-4 py-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-28" />
    </div>
  ))}
</div>

Edit artifacts/mbs-crm/src/pages/dashboard.tsx:
While analytics data is loading, show skeleton cards (matching the KPI card layout) and a skeleton chart area.

Edit artifacts/mbs-crm/src/pages/lead-detail.tsx:
While lead data is loading, show skeleton blocks for the header (name, status, rep) and tab content area.

2. EMPTY STATES — Add helpful empty states with icons and action buttons.

When leads list is empty: show a centered empty state with the Users icon, heading "No leads yet", description "Create your first lead or import from a spreadsheet.", and two buttons: "New Lead" (links to /leads/new) and "Import from Excel" (triggers the import dialog).

When notes tab is empty on lead detail: "No notes yet. Add a note to track conversations and updates." with a focused add-note input.

When tasks tab is empty: "No tasks yet. Create a task to stay on top of follow-ups." with an "Add Task" button.

When documents tab is empty: "No documents attached. Upload bank statements, contracts, or other files." with an upload button.

When communications tab is empty: "No calls or messages yet. Make a call or send a text to get started." with call and SMS action buttons.

Use the existing Empty component from @/components/ui/empty if it exists, or create a simple reusable EmptyState component:
function EmptyState({ icon: Icon, title, description, action }: { icon: any; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="h-12 w-12 text-muted-foreground/40 mb-4" />
      <h3 className="text-lg font-medium text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm">{description}</p>
      {action}
    </div>
  );
}

3. BREADCRUMBS — Add to the lead detail page.
At the top of lead-detail.tsx, before the lead header, add:
<nav className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
  <Link href="/leads" className="hover:text-foreground transition-colors">Leads</Link>
  <ChevronRight className="h-4 w-4" />
  <span className="text-foreground font-medium">{leadName}</span>
</nav>

4. RELATIVE TIMESTAMPS — In the leads list table, change the "Created" column from showing the full ISO date to a relative format: "2 hours ago", "3 days ago", "Dec 15".
Create a utility function in artifacts/mbs-crm/src/lib/utils.ts:
export function relativeTime(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

5. HORIZONTAL TAB SCROLLING — In lead-detail.tsx, the TabsList with 11 tabs overflows on mobile. Wrap the TabsList in a scrollable container:
<div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
  <TabsList className="inline-flex w-max md:w-auto">
    {/* existing TabsTrigger elements */}
  </TabsList>
</div>

6. CONFIRMATION DIALOGS — Add AlertDialog confirmation before:
- Changing status to "declined" (in lead-detail.tsx status change handler)
- Deleting any record (if delete buttons exist)
Use the existing AlertDialog from @/components/ui/alert-dialog.


================================================================================
PROMPT 9 — PROJECT DOCUMENTATION
================================================================================

Replace the contents of replit.md (in the project root) with this complete project documentation:

# MBS CRM — Custom Sales & Deal Management Platform

A full-stack CRM for My Business Solutions (MBS), a business financing brokerage. Manages leads, applications, underwriting, communications, lender matching, email marketing, and reporting.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- **Monorepo:** pnpm workspaces, Node.js 24, TypeScript 5.9
- **API:** Express 5, REST, OpenAPI spec with Orval codegen
- **DB:** PostgreSQL + Drizzle ORM (22 tables)
- **Auth:** Clerk (roles: admin / manager / rep)
- **Web:** React + Vite + Tailwind + shadcn/ui + wouter
- **Mobile:** Expo (React Native) with Clerk auth
- **Integrations:** Twilio (calls/SMS), SendGrid (email), Anthropic Claude (OCR), Experian (credit), Puppeteer (PDF)

## Where things live

- `lib/db/src/schema/` — Database schema (Drizzle ORM)
- `lib/api-spec/openapi.yaml` — OpenAPI specification (source of truth)
- `lib/api-client-react/` — Generated typed API client (React Query hooks)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/` — Shared backend modules (matching engine, OCR, encryption, drip engine, notifications, workflow engine, lead scoring, PDF rendering)
- `artifacts/mbs-crm/src/pages/` — React pages (dashboard, leads, lead-detail, apply, settings, admin pages)
- `artifacts/mbs-crm/src/components/` — Shared components (app-shell, softphone-widget, UI library)
- `artifacts/mbs-crm-mobile/` — Expo mobile app

## Required Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `ENCRYPTION_KEY` — 64 hex characters (32 bytes) for AES-256-GCM SSN/credit encryption
- `VITE_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — Clerk authentication
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` / `TWILIO_TWIML_APP_SID` — Twilio Voice + SMS
- `SENDGRID_API_KEY` / `SENDGRID_WEBHOOK_VERIFICATION_KEY` — SendGrid email
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` / `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` — Claude OCR
- `EXPERIAN_API_URL` / `EXPERIAN_API_KEY` / `EXPERIAN_API_SECRET` — Credit bureau

## Architecture decisions

- First Clerk user auto-provisions as admin; subsequent users as reps
- SSNs and credit payloads encrypted at field level (AES-256-GCM), never sent to browser
- Credit compliance log enforced append-only at DB level (PostgreSQL triggers)
- Lender matching auto-triggers on status change to "application_received"
- Drip sequences auto-enroll leads on matching status change
- Workflow rules auto-create tasks on status changes
- Lead scoring auto-calculates on OCR completion and credit pull
- Twilio and SendGrid webhooks validate signatures
- Public endpoints (/apply, /leads/capture) are rate-limited

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after editing openapi.yaml
- Run `pnpm --filter @workspace/db run push` after editing schema files
- The ENCRYPTION_KEY must NEVER change after data is encrypted — SSNs become unrecoverable
- Twilio webhook URLs must point to the deployed URL, not localhost
- SendGrid domain must be verified (SPF + DKIM) before emails deliver


================================================================================
AFTER ALL PROMPTS — VERIFICATION CHECKLIST
================================================================================

Run after completing all prompts:

□ pnpm run typecheck — passes with no errors
□ pnpm run build — builds successfully
□ pnpm --filter @workspace/api-spec run codegen — regenerates without errors
□ New tables exist in database (notifications, workflow_rules, plus new columns on leads and communications)
□ All new routes registered in artifacts/api-server/src/routes/index.ts
□ All new schema files exported from lib/db/src/schema/index.ts
□ All new pages have routes in artifacts/mbs-crm/src/App.tsx
□ Notification bell appears in the app shell header
□ Bulk action bar appears when selecting leads in the list
□ Lead scores display in the leads list
□ Workflow rules page accessible from admin sidebar
□ Application status page works at /apply/status
□ Post-call modal appears when a call ends
□ Loading skeletons appear during data fetch
□ Empty states show when no data exists
□ Tab list scrolls horizontally on mobile
