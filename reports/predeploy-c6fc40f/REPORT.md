# Pre-deploy validation: GitHub main c6fc40f

**Verdict: NOT READY TO PUBLISH.** Validation only. No product code changes or publishing.

Source commit: undefined; tree: 7fad71128600161b469e35da5cc52d03a7a5db00; 1580 verified Git blobs. Frozen build provenance is under frozen-builds/current.json and its referenced build-provenance.json. Source was restored byte-for-byte after an environment restart; completed preflight was not rerun or relabelled.

FAIL below can mean an unsatisfied requirement or an incomplete validation, not a confirmed product defect.

| Item | Result | Raw evidence and findings |
|---|---|---|
| 1 | **FAIL** | All 11 CLI gates PASS, exit 0; ledger 68, no pending migrations. The clone was schema-only, not an actual production backup. Read-only production ledger was 66; only 067–068 remain. Evidence: [preflight.raw.log](preflight.raw.log); [preflight-tail.txt](preflight-tail.txt); [clone-provenance.json](clone-provenance.json); [migration-ledger-readonly.json](migration-ledger-readonly.json) |
| 2 | **FAIL** | 36/36 not established. Original comparison has 74 failures. Offline classification separates fixture/capture-plan issues; 27 Open softphone and six Apply-label discrepancies remain unproven exceptions. No allowlist was widened. Evidence: [structure-delta-classification.md](structure-delta-classification.md); [structure-delta-classification.json](structure-delta-classification.json); [structure-raw-deltas.json](structure-raw-deltas.json); [runs/structure-final/reports/nate-workflows/control-review.json](runs/structure-final/reports/nate-workflows/control-review.json) |
| 3 | **FAIL** | Partial: six active eligible admin/manager/rep users, self included; inactive/pending/merged rejected; all eligible destinations and self persist through assignment APIs; admin/manager Lead-header UI self/other assignment passes; rep directory UI requests and assignee controls absent. Each of all five requested picker inventories/self-save paths was not individually completed in the browser. Evidence: [functional-assertions.raw.json](functional-assertions.raw.json); [runs/core-final/reports/nate-workflows/after/controls.json](runs/core-final/reports/nate-workflows/after/controls.json) |
| 4 | **FAIL** | Partial: API identity checks and desktop Deals list/Pipeline/header captured. Referral matching did not pass in the continuation; Cmd-K and notification checks were not completed. No whole-request naming certification. Evidence: [core-final.raw.log](core-final.raw.log); [core-resume-role-boundary.raw.log](core-resume-role-boundary.raw.log); [functional-assertions.raw.json](functional-assertions.raw.json) |
| 5 | **FAIL** | Partial: US Fund Advisor=2, vendor_list=30, prospect_list=1, Website=1; exact selected-ID bulk assignment updated and persisted exactly two fixtures; manager/admin bulk UI and rep absence checked. Source-filter UI/requests exercised vendor_list, not the specifically requested USFA-only result set; that exact case remains unverified. Evidence: [functional-assertions.raw.json](functional-assertions.raw.json) |
| 6 | **PASS** | Three Deals options, All/open/exclude-open preview behavior, picked-lead filtering/deduplication, closed/hold/archived/no-deal exclusion from open membership, and saved-rule approval invalidation pass. Evidence: [functional-assertions.raw.json](functional-assertions.raw.json) |
| 7 | **PASS** | Unconfigured parse: one recipient, HTTP201, Sent1/Failed0, configured/captured Reply-To single-campaign-replies@example.invalid. Independent Campaign5 completed 13 fixture sends and Results UI showed13; read-only production Campaign5 also completed with13. Loopback transport only; 14 bounded simulated calls, no actual email/provider or production mutation. Evidence: [runs/campaign-canonical-fixture-final/one-recipient-campaign.json](runs/campaign-canonical-fixture-final/one-recipient-campaign.json); [runs/campaign-canonical-fixture-final/sendgrid-captured-body.json](runs/campaign-canonical-fixture-final/sendgrid-captured-body.json); [runs/campaign-canonical-fixture-final/campaign5-fixture.json](runs/campaign-canonical-fixture-final/campaign5-fixture.json); [runs/campaign-canonical-fixture-final/campaign5-fixture-results-sent-13.png](runs/campaign-canonical-fixture-final/campaign5-fixture-results-sent-13.png); [campaign-5-production-readonly.json](campaign-5-production-readonly.json) |
| 8 | **FAIL** | Required six pages covered across all three roles. Authorized UI 403/404/503: zero; rep Campaigns shows Manager Access Required without an HTTP error. Strict all-4xx/5xx requirement does not pass: the behavior browser deliberately generated twenty400 assignment-rejection responses and one409 stale-approval response; all request paths/pages and expected reasons are retained. Six unrelated accessibility console messages also retained. No unexpected authorized UI HTTP defect identified. Evidence: [browser-error-ledger.json](browser-error-ledger.json); [runs/core-final/reports/nate-workflows/after/capture-meta.json](runs/core-final/reports/nate-workflows/after/capture-meta.json); [runs/core-resume-role-boundary/reports/nate-workflows/after/assertions.json](runs/core-resume-role-boundary/reports/nate-workflows/after/assertions.json) |

## Migration rehearsal and production limits

All eleven command-line gates passed. The managed rehearsal metadata explicitly says **sourceKind=schema-only**, therefore it does **not** satisfy the actual-production-clone requirement. Rehearsal applied to ledger68 with no pending migrations and divergence PASS. Read-only production metadata reported66 (through066); development reported68. No production schema/data was changed.

## Interrupted/failed harness attempts

All attempts remain retained. Core-final stopped on an ambiguous two-deal label selector. Continuations encountered an environment restart, absent restored build outputs, Campaigns comparison-button/link ambiguity, the legitimate rep Manager Access Required boundary, and unfinished desktop command-palette/referral checks at a mobile viewport. These attempts are not converted into successful whole-run exits.

The original one-recipient sends failed **before transport** on fixture public-origin validation (first HTTP, then noncanonical HTTPS). The final fixture derives the canonical outbound origin from the pinned production URL policy. Final one-recipient + separate Campaign5 run exited0; no product URL-policy or reply-capture code was changed.

## Full preflight tail

The complete transcript is preflight.raw.log (and preflight-transcript.txt). Tail below includes clone provenance, rehearsal and divergence. Exported copies redact credentials and non-synthetic contact data; export-manifest.json records affected files.

```text

PREFLIGHT 9/11: production database clone

> workspace@0.0.0 db:clone-prod /tmp/predeploy-c6fc40f-source
> pnpm --silent --dir scripts exec tsx ./src/dbCloneProd.ts

DB clone source: schema-only
Public base tables: 31
Public columns: 320
Schema migrations ledger rows: 0
DB CLONE PASS
PREFLIGHT 10/11: migration rehearsal

> workspace@0.0.0 migrate:rehearse /tmp/predeploy-c6fc40f-source
> pnpm --silent --dir scripts exec tsx ./src/migrate-rehearse.ts

Applied names/count: 002_rep_slugs.sql, 003_deals.sql, 004_deal_intended_rep_slug.sql, 006_drip_sequence_ownership.sql, 009_email_send_failure_reason.sql, 010_email_webhook_events.sql, 011_email_rate_slots.sql, 012_application_signature.sql, 013_retired_rep_slugs.sql, 014_application_optional_fields.sql, 015_application_consent_text_version.sql, 016_user_titles.sql, 017_deal_notes_gm_split.sql, 018_lender_matcher_gates.sql, 019_document_categories.sql, 020_lender_submissions.sql, 021_lead_package_config.sql, 022_lender_submission_package_snapshots.sql, 023_routing_and_marketing_ownership.sql, 024_email_compliance_daily_budget.sql, 025_usfa_intake.sql, 026_usfa_intake_runtime_support.sql, 028_merge_going_to_funding_stage.sql, 029_deal_approvals.sql, 030_add_application_collateral.sql, 031_collateral_library.sql, 032_finance_application_collateral.sql, 033_lender_submission_review_fields.sql, 034_application_sms_consent.sql, 035_user_identities.sql, 036_partners_contacts.sql, 037_partner_flows_and_texting.sql, 038_partner_texting.sql, 039_ridgestone_partner_profile.sql, 040_release_schema_parity.sql, 041_push_notifications.sql, 042_push_delivery_ledger.sql, 043_align_push_schema.sql, 044_notification_delivery_claims.sql, 045_application_equipment_category_homeowner.sql, 046_complete_partner_contacts_recovery.sql, 047_partner_contacts_prerequisite.sql, 048_financing_campaign_draft.sql, 049_lender_underwriting_intelligence.sql, 050_lender_guideline_versions.sql, 051_users_role_default_pending.sql, 052_reusable_campaign_launcher.sql, 053_campaign_preview_approval_snapshots.sql, 054_campaign_preview_recipient_snapshots.sql, 055_campaign_launch_execution_leases.sql, 056_campaign_flyer.sql, 057_telephony_settings.sql, 058_telephony_business_defaults.sql, 059_inbound_voice_settings.sql, 060_inbound_voice_array_defaults.sql, 061_telephony_completion.sql, 062_email_readiness_daily_cap.sql, 063_lead_vertical.sql, 064_collateral_flyer_library.sql, 065_campaign_flyer_link_vendor_template.sql, 066_bundled_vendor_equipment_flyers.sql, 067_campaign_attribution.sql, 068_campaign_attribution_fk_names.sql / 63
Superseded names/count: none / 0
Failed: none
Ledger before/after counts: 0/68
Added ledger rows: 000_baseline, 001_create_credit_tables, 002_rep_slugs, 003_deals, 004_deal_intended_rep_slug, 005_lead_distribution_settings, 006_drip_sequence_ownership, 007_lead_staleness_threshold, 008_email_safety_settings, 009_email_send_failure_reason, 010_email_webhook_events, 011_email_rate_slots, 012_application_signature, 013_retired_rep_slugs, 014_application_optional_fields, 015_application_consent_text_version, 016_user_titles, 017_deal_notes_gm_split, 018_lender_matcher_gates, 019_document_categories, 020_lender_submissions, 021_lead_package_config, 022_lender_submission_package_snapshots, 023_routing_and_marketing_ownership, 024_email_compliance_daily_budget, 025_usfa_intake, 026_usfa_intake_runtime_support, 028_merge_going_to_funding_stage, 029_deal_approvals, 030_add_application_collateral, 031_collateral_library, 032_finance_application_collateral, 033_lender_submission_review_fields, 034_application_sms_consent, 035_user_identities, 036_partners_contacts, 037_partner_flows_and_texting, 038_partner_texting, 039_ridgestone_partner_profile, 040_release_schema_parity, 041_push_notifications, 042_push_delivery_ledger, 043_align_push_schema, 044_notification_delivery_claims, 045_application_equipment_category_homeowner, 046_complete_partner_contacts_recovery, 047_partner_contacts_prerequisite, 048_financing_campaign_draft, 049_lender_underwriting_intelligence, 050_lender_guideline_versions, 051_users_role_default_pending, 052_reusable_campaign_launcher, 053_campaign_preview_approval_snapshots, 054_campaign_preview_recipient_snapshots, 055_campaign_launch_execution_leases, 056_campaign_flyer, 057_telephony_settings, 058_telephony_business_defaults, 059_inbound_voice_settings, 060_inbound_voice_array_defaults, 061_telephony_completion, 062_email_readiness_daily_cap, 063_lead_vertical, 064_collateral_flyer_library, 065_campaign_flyer_link_vendor_template, 066_bundled_vendor_equipment_flyers, 067_campaign_attribution, 068_campaign_attribution_fk_names
Changed ledger rows: none
Removed ledger rows: none
Applied names/count: 000_baseline.sql, 001_create_credit_tables.sql, 002_rep_slugs.sql, 003_deals.sql, 004_deal_intended_rep_slug.sql, 005_lead_distribution_settings.sql, 006_drip_sequence_ownership.sql, 007_lead_staleness_threshold.sql, 008_email_safety_settings.sql, 009_email_send_failure_reason.sql, 010_email_webhook_events.sql, 011_email_rate_slots.sql, 012_application_signature.sql, 013_retired_rep_slugs.sql, 014_application_optional_fields.sql, 015_application_consent_text_version.sql, 016_user_titles.sql, 017_deal_notes_gm_split.sql, 018_lender_matcher_gates.sql, 019_document_categories.sql, 020_lender_submissions.sql, 021_lead_package_config.sql, 022_lender_submission_package_snapshots.sql, 023_routing_and_marketing_ownership.sql, 024_email_compliance_daily_budget.sql, 025_usfa_intake.sql, 026_usfa_intake_runtime_support.sql, 028_merge_going_to_funding_stage.sql, 029_deal_approvals.sql, 030_add_application_collateral.sql, 031_collateral_library.sql, 032_finance_application_collateral.sql, 033_lender_submission_review_fields.sql, 034_application_sms_consent.sql, 035_user_identities.sql, 036_partners_contacts.sql, 037_partner_flows_and_texting.sql, 038_partner_texting.sql, 039_ridgestone_partner_profile.sql, 040_release_schema_parity.sql, 041_push_notifications.sql, 042_push_delivery_ledger.sql, 043_align_push_schema.sql, 044_notification_delivery_claims.sql, 045_application_equipment_category_homeowner.sql, 046_complete_partner_contacts_recovery.sql, 047_partner_contacts_prerequisite.sql, 048_financing_campaign_draft.sql, 049_lender_underwriting_intelligence.sql, 050_lender_guideline_versions.sql, 051_users_role_default_pending.sql, 052_reusable_campaign_launcher.sql, 053_campaign_preview_approval_snapshots.sql, 054_campaign_preview_recipient_snapshots.sql, 055_campaign_launch_execution_leases.sql, 056_campaign_flyer.sql, 057_telephony_settings.sql, 058_telephony_business_defaults.sql, 059_inbound_voice_settings.sql, 060_inbound_voice_array_defaults.sql, 061_telephony_completion.sql, 062_email_readiness_daily_cap.sql, 063_lead_vertical.sql, 064_collateral_flyer_library.sql, 065_campaign_flyer_link_vendor_template.sql, 066_bundled_vendor_equipment_flyers.sql, 067_campaign_attribution.sql, 068_campaign_attribution_fk_names.sql / 68
Superseded names/count: none / 0
Failed: none
Ledger before/after counts: 0/68
Added ledger rows: 000_baseline, 001_create_credit_tables, 002_rep_slugs, 003_deals, 004_deal_intended_rep_slug, 005_lead_distribution_settings, 006_drip_sequence_ownership, 007_lead_staleness_threshold, 008_email_safety_settings, 009_email_send_failure_reason, 010_email_webhook_events, 011_email_rate_slots, 012_application_signature, 013_retired_rep_slugs, 014_application_optional_fields, 015_application_consent_text_version, 016_user_titles, 017_deal_notes_gm_split, 018_lender_matcher_gates, 019_document_categories, 020_lender_submissions, 021_lead_package_config, 022_lender_submission_package_snapshots, 023_routing_and_marketing_ownership, 024_email_compliance_daily_budget, 025_usfa_intake, 026_usfa_intake_runtime_support, 028_merge_going_to_funding_stage, 029_deal_approvals, 030_add_application_collateral, 031_collateral_library, 032_finance_application_collateral, 033_lender_submission_review_fields, 034_application_sms_consent, 035_user_identities, 036_partners_contacts, 037_partner_flows_and_texting, 038_partner_texting, 039_ridgestone_partner_profile, 040_release_schema_parity, 041_push_notifications, 042_push_delivery_ledger, 043_align_push_schema, 044_notification_delivery_claims, 045_application_equipment_category_homeowner, 046_complete_partner_contacts_recovery, 047_partner_contacts_prerequisite, 048_financing_campaign_draft, 049_lender_underwriting_intelligence, 050_lender_guideline_versions, 051_users_role_default_pending, 052_reusable_campaign_launcher, 053_campaign_preview_approval_snapshots, 054_campaign_preview_recipient_snapshots, 055_campaign_launch_execution_leases, 056_campaign_flyer, 057_telephony_settings, 058_telephony_business_defaults, 059_inbound_voice_settings, 060_inbound_voice_array_defaults, 061_telephony_completion, 062_email_readiness_daily_cap, 063_lead_vertical, 064_collateral_flyer_library, 065_campaign_flyer_link_vendor_template, 066_bundled_vendor_equipment_flyers, 067_campaign_attribution, 068_campaign_attribution_fk_names
Changed ledger rows: none
Removed ledger rows: none
[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[✓] Pulling schema from database...
Schema parity OK: SQL runner and complete Drizzle schema set match
EMPTY-SCHEMA users.role default: pending
EMPTY-SCHEMA 000-TO-LATEST REHEARSAL PASS
[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[⡿] Pulling schema from database...
[2K[1G[⢿] Pulling schema from database...
[2K[1G[⣻] Pulling schema from database...
[2K[1G[⣽] Pulling schema from database...
[2K[1G[⣷] Pulling schema from database...
[2K[1G[⣯] Pulling schema from database...
[2K[1G[⣟] Pulling schema from database...
[2K[1G[✓] Pulling schema from database...
Schema parity OK: SQL runner and complete Drizzle schema set match
POPULATED-SCHEMA initial no-ledger reconciliation: applied=63, ledger=68|1, baseline SQL skipped
POPULATED-SCHEMA retry: applied=0, adopted=000_baseline (a07aee3fbf5a174ff94c05859a401cac808b0c89435fd834e4bae09e75117902), constraints/indexes unchanged (63/746|246|196)
MIGRATION REHEARSAL PASS
PREFLIGHT 11/11: database divergence

> workspace@0.0.0 db:divergence /tmp/predeploy-c6fc40f-source
> pnpm --silent --dir scripts exec tsx ./src/db-divergence.ts

Clone-only ledger rows: none
Dev-only ledger rows: none
Changed ledger rows: none
Clone-only tables: none
Dev-only tables: none
Clone-only columns: none
Dev-only columns: none
Changed columns: none
DB DIVERGENCE PASS
PREFLIGHT PASS

AUTHORITATIVE_COMMAND_EXIT=0

```

## Release blockers

1. Obtain and rehearse an actual production backup/clone; schema-only fallback is insufficient.
2. Establish the requested canonical36/36 mobile comparison without unapproved exceptions.
3. Finish all five individual assignment picker paths, Cmd-K/notification/referral naming, and the specific USFA-only filtering case.

No live send, publishing, or production writes were performed. Final fixture screenshot is campaign5-fixture-results-sent-13.png; the production value is a separately labelled read-only query, not a production-browser capture.
