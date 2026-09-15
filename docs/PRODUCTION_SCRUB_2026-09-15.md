PRODUCTION SCRUB — audited cycle. Production is READ-ONLY throughout: never create, modify, or delete a production record. Code and tests only. Every item reports PASS / FAIL / BLOCKED with file:line evidence. One commit per lettered section, pushed to main, hashes reported. Do not deploy.

Start: `git status` clean, HEAD 8c65d94. Otherwise stop.

A. AUTH MATRIX. Produce docs/AUTH_MATRIX.md by enumerating every Express route registration in artifacts/api-server/src/routes (currently 155): method, path, file:line, guard (public / requireUser / admin / rep-scoped), and HOW scoping is enforced (the exact predicate). Rules that must hold: (1) every mutating route is non-public except the documented public intake routes (/applications/submit, /r/:slug, health, webhooks with signature verification); (2) every /admin route checks role === "admin"; (3) every list/detail/export/download a rep can reach is filtered by assignedRepId/assignedTo; (4) webhooks (Twilio, SendGrid, Clerk) verify signatures. Any violation = FAIL → fix it → re-enumerate → confirm zero FAIL. Add a test that walks the router and asserts no mutating route is unguarded.

B. INPUT TYPING. Replace every `any` on a request-input path in routes/ and lib/ (req.body/query/params, parsed JSON, multer) with zod schemas or precise types — 46 occurrences today. Report the ones you deliberately left (non-input) with file:line and reason. Every public route must reject malformed input with 400 + a field name, never 500.

C. RAW SQL RE-CHECK. Re-run the S1 audit on current main (docs/raw-sql-s1-audit.md is dated before the last ~40 commits): list every sql`` fragment and any relational `where` that references a column from a table other than the queried one. Fix or mark safe with reason.

D. PINNING TESTS (must fail if the rule is removed):
   - Rep Performance list = role rep OR holds ≥1 lead/deal; display-name fallback = email local part.
   - Avg Funding Time excludes deals funded within 24h of creation and renders "—".
   - /leads/export and /deals/export: rep gets own rows only; admin all.
   - Slug retirement: retired slug 301s; retired slug cannot be re-reserved; rename refused with qr-card leads attached.
   - Application submit: bare-digit EIN stored XX-XXXXXXX; malformed EIN → 400 field "ein"; missing consent → 400 naming the field; no body ever equals {error:"Invalid input"}; consent_text_version recorded.
   - Lender package: rep 403 on another rep's lead; statements selected by bankstatement- key; corrupt statement listed on the last page.

E. ROUTING RULES (client-specified, partially landed): 
   - Admin settings: routing.mode manual|round_robin (default manual); routing.staleDays (default 7); routing.autoReassignStale (default false). Round-robin applies ONLY to non-qr-card, non-prospect_list inbound leads across active role=rep users. QR-card leads always to the card's rep. Prospect-list leads stay unassigned/admin-only.
   - Stale queue on the admin dashboard: assigned leads with no activity in staleDays; one-click reassign; auto-reassign only when both settings allow; every reassignment logged as an activity naming old and new rep.
   - Claiming: reps cannot self-assign (assert in A's matrix + test).
   - Rep self-service: drip sequences and email templates get ownerId; reps CRUD their own, read admin-owned, enroll only their own leads; enforced on the API (403 tests), not just UI.

F. RE-APPLICATION. Duplicate phone/email on submit attaches the new application to the EXISTING lead (activity "Re-application submitted", rep notified) and returns the normal success page. Never a 409 dead-end. Test: second submission with the same email creates no duplicate lead.

G. EMAIL PROOF. Admin data tools → "Send SendGrid test email": one CEO-template email from funding@ to an admin-entered address, SendGrid message id shown inline. /health/deep gains sendgrid: { configured, lastWebhookAt, trackingEnabled } where trackingEnabled is read from SendGrid's mail settings API (read-only). Nothing sends unless clicked.

H. OPERATIONAL POLISH. Dashboard empty states ("No rep activity in this period yet"; "Leads haven't been worked yet") when all-zero. lib/renderPdf.ts: confirm the concurrency cap (≤2), page cleanup on error, 30s timeout → 503 from flyer and lender-package routes; add a test with 5 simultaneous mocked renders.

I. STARTUP + MIGRATIONS. index.ts column checks must name every migration 012–018; add a single startup summary line "schema OK" or the list of missing migrations. Confirm no code path writes a column that has no migration.

Guardrails: model string "claude-sonnet-4-6" untouched; no dependency additions; no changes to lender seed values or matcher gates (they were just audited); no touching lead-detail/ panels beyond what E requires. Full suite + typecheck; paste the tail. Final line: SHIP / DO-NOT-SHIP with reason.