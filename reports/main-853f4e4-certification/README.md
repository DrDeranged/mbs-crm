# Certification of GitHub main 853f4e4

**Verdict: NOT CERTIFIED. No publication performed.**

Candidate: `853f4e49378b10daf3d59d81769c81fe812ca0ea`, parent `1316888e5ead2f19986fa6fc1d6abe6755c43fe2`.
Source tree: `96bf6b0cbd0b4118461b77c651355d9d4ff4af1c`.
The 1,041 tracked candidate files matched the pinned local source snapshot, including migrations 067–068. See [source-binding.json](source-binding.json).
This is an audit of that candidate, not a repaired or newly published revision.

## Requested checks

| Check | Result |
| --- | --- |
| Full 11-gate preflight | PASS, exit 0; 723 tests passed, one intentionally skipped. |
| Rehearsal against actual production backup | NOT CERTIFIED: clone source was `schema-only`, not a production backup restore. |
| Strict mobile controls, required 36/36 | FAIL: 30/36. Exemption inventories match 36/36. |
| Leads at 390, 768, 1280, 1440; light/dark | Eight authenticated screenshots captured. Tested interactions passed as detailed below. |
| Disabled reply capture preserves campaign Reply-To | FAIL: candidate rejects campaign sends before sending, instead of preserving configured Reply-To. |
| Completed campaign Results with new KPI and 13 sends | PASS on the candidate against an anonymized historical production snapshot in an isolated fixture. Not a production UI deployment. |

## 1. Preflight and migration provenance

Complete, unedited final transcript: [preflight.txt](preflight.txt).
Actual shell exit: [preflight-exit.txt](preflight-exit.txt).
Contiguous final tail: [preflight-tail.txt](preflight-tail.txt).
Clone provenance: [migration-clone-provenance.json](migration-clone-provenance.json).

The first preflight attempt failed because a test enumerated the already-deleted but still-indexed test-results file. After removing that index entry, the **entire** preflight was rerun and passed. The failed transcript and exit remain in this evidence folder.

Actual clone-stage excerpt:

```text
PREFLIGHT 9/11: production database clone
> workspace@0.0.0 db:clone-prod /home/runner/workspace
> pnpm --silent --dir scripts exec tsx ./src/dbCloneProd.ts
DB clone source: schema-only
Public base tables: 31
Public columns: 320
Schema migrations ledger rows: 0
DB CLONE PASS
PREFLIGHT 10/11: migration rehearsal
```

All 68 migrations passed rehearsal, including empty/populated-schema reconciliation and retry. However, the successful command cannot establish compatibility with real production data when its input is a schema-only fallback. A real production backup rehearsal remains required.

## 2. Strict mobile structure

Baseline: certified `2af927ca2830926bf325cef2eecfffc24ab5c110`, both retained baseline code and the archived certified control inventory.

All 36 combinations were compared: three roles (admin/manager/rep), six pages, two widths (390/768). The extractor includes all DOM controls, including hidden controls, and only the two already-declared exemption categories. No new exemptions or control-name normalization were introduced.

**30/36 exact matches.** All six failures are **Lead Detail** at both widths for all three roles. Two extra candidate controls are absent from the certified baseline:

- INPUT: `Search referrer`
- BUTTON: `Share referral link`

Leads itself matches the certified controls for all six role/width combinations. Fixture timestamps were aligned with the archived 18-day idle / 19-days-ago labels; original failed harness attempts remain available.

Evidence: [structure-controls.json](structure-controls.json), [structure-differences.json](structure-differences.json), [leads-certification.json](leads-certification.json).

## 3. Leads browser checks and screenshots

Real development Clerk sign-in and isolated synthetic fixture contacts were used against the immutable candidate build. See [immutable-web-public.sha256](immutable-web-public.sha256).

The representative functional journey confirmed:

- Full-name search and company search return the expected matching fixture lead.
- Contacted status, Equipment type, and representative filters behave as expected.
- Oldest First selects ascending sort and requests `sortOrder=asc`.
- Lead-link navigation opens the correct detail record.
- Email action opens the lead's Comms tab.
- Phone links expose the expected `tel:` destination; default dialing was deliberately prevented, and contact actions did not incorrectly trigger row navigation.

These checks validate browser navigation and destinations, not actual telephone calling or email delivery. The functional journey is separate from the eight viewport captures; it is not eight independent full interaction suites.

| Width | Light | Dark |
| --- | --- | --- |
| 390 | [Screenshot](leads-390-light.png) | [Screenshot](leads-390-dark.png) |
| 768 | [Screenshot](leads-768-light.png) | [Screenshot](leads-768-dark.png) |
| 1280 | [Screenshot](leads-1280-light.png) | [Screenshot](leads-1280-dark.png) |
| 1440 | [Screenshot](leads-1440-light.png) | [Screenshot](leads-1440-dark.png) |

All captures use 900px viewport height. Document widths equal viewport widths; desktop fit regions have equal client/scroll widths. This does not assert every contact control is initially on-screen at tablet width, where the retained table can scroll.

Exact selectors, observed outcomes, and geometry: [journeys.json](journeys.json).

## 4. Production reply-capture configuration and outbound blocker

Production configuration metadata shows no `SENDGRID_INBOUND_PARSE_SECRET` and no enabled flag. No secret values were printed. An unauthenticated request to the published inbound endpoint returned 401; that response alone is not proof of the enable flag.

Configuration evidence: [reply-capture-production.json](reply-capture-production.json), [production-inbound-status.txt](production-inbound-status.txt).

The isolated runtime proof imports the actual candidate email sender. With capture unconfigured and a synthetic configured campaign Reply-To, it returns:

```text
Campaign reply capture is not enabled/configured
configurationReason: missing:campaign_reply_capture
deliveryOutcome: definite_failure
```

There were **zero provider calls and zero database writes**. The rejection occurs in `artifacts/api-server/src/routes/email.ts` before a normal campaign message can be delivered. Therefore capture is inactive, but the requested ordinary-send / configured-Reply-To behavior **fails**.

Proof and repeatable helper: [reply-policy-runtime.json](reply-policy-runtime.json), [reply-policy-runtime.mjs](reply-policy-runtime.mjs), [reply-policy-runtime.txt](reply-policy-runtime.txt).

## 5. Historical completed campaign

Production was queried read-only. Campaign 5, **Vendors — Heavy Equipment**, is completed and has 13 recorded sends. An anonymized historical snapshot was restored only into a guarded disposable fixture, retaining send/recipient relationships, statuses, and timestamps while replacing contact identities, emails, users, and template references.

Candidate `/campaigns/5`:

- Results API: HTTP 200; Sent **13**.
- Metrics API: HTTP 200; Sent **13**.
- Existing Results Sent counter and new Sent KPI both rendered **13**.
- Historical `tracking_since` remained NULL; recipient `sent_at` remained NULL, while actual email-send `sent_at` remained populated.
- Unknown historical clicks, replies, and funded metrics show **Not tracked**, not invented zeroes.

No campaign launch or delivery action was invoked. This is proof of **candidate-code rendering on historical production records**, not a newly published production page.

Evidence: [campaign-results-verification.json](campaign-results-verification.json), [campaign-5-results.png](campaign-5-results.png), [historical-campaign-source-provenance.json](historical-campaign-source-provenance.json), [historical-campaign-anonymized.json](historical-campaign-anonymized.json).

## Limitations and cleanup

No browser `pageerror` exceptions were recorded. There were 229 console errors across baseline, target, and journey contexts: 92 service-worker registration errors in contexts deliberately blocking service workers, 78 HTTP 503s, 32 HTTP 403s, and 27 HTTP 404s. The resource errors were not traced to specific requests in this run; this is **not** a clean-console certification. Raw entries: [console-errors.json](console-errors.json).

The disposable fixture database and synthetic Clerk users were cleaned up. No live sends, telephone calls, production writes, or publication occurred.

Repository cleanup removes `test-results/.last-run.json` and ignores `/test-results/`. Product source remains unchanged; accompanying agent-memory documentation retains the certification constraints. Initial/intermediate harness failures are preserved rather than omitted. Evidence file digests are in `evidence-manifest.json`; upload verification records are kept separately from the immutable evidence commit.

## Required before certification can pass

1. Restore the required mobile control compatibility or obtain explicit approval for a different certified baseline; do not silently exempt the new controls.
2. Make reply capture optional while preserving configured campaign Reply-To for ordinary outbound mail.
3. Rehearse migrations on an actual production backup with recorded provenance.
