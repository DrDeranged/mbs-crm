# Lender seed provenance (Requirement A)

This table is the audit boundary for the lender seed. A populated value is
copied from a `docs/lenders/LENDER_SEED_SPEC_*.md` statement; `NULL` means that
the spec does not state a lender-level value that fits the existing schema.
Tier-only or program-only values are kept in `notes` and are not promoted to a
lender-level field.

| Lender | pricing | turnaround (business days) | compensation | requiredDocuments | equipmentRestrictions |
|---|---|---|---|---|---|
| Alliance Funding Group (AFG) | NULL — 2026-09-14, lines 107-112 | NULL — 2026-09-14, lines 107-112 | NULL — 2026-09-14, lines 107-112 (commission is program-specific) | NULL — 2026-09-14, lines 107-112 | NULL — 2026-09-14, lines 107-112 (restrictions are program-specific) |
| AMUR Equipment Finance | NULL — 2026-09-14, lines 114-116 | NULL — 2026-09-14, lines 114-116 | NULL — 2026-09-14, lines 114-116 (points are stated, but no supported lender-level range is uniform across tiers) | NULL — 2026-09-14, lines 114-116 | NULL — 2026-09-14, lines 114-116 |
| Y.E.S. Leasing | NULL — 2026-09-14, lines 118-120 | NULL — 2026-09-14, lines 118-120 | NULL — 2026-09-14, lines 118-120 | NULL — 2026-09-14, lines 118-120 | NULL — 2026-09-14, lines 118-120 |
| Dexly Finance | NULL — 2026-09-15, lines 67-74 (factor/ISO tiers are not a single pricing shape) | NULL — 2026-09-15, lines 67-74 | NULL — 2026-09-15, lines 67-74 (commission is factor-tiered) | NULL — 2026-09-15, lines 67-74 (stips are conditional) | NULL — 2026-09-15, lines 69-71 (industry restrictions, no equipment list) |
| TimePayment Corp | NULL — 2026-09-15, lines 76-83 | NULL — 2026-09-15, lines 76-83 | populated: max 15 points — 2026-09-15, lines 79-80 | NULL — 2026-09-15, lines 79-81 (conditional financials/banks) | populated — 2026-09-15, lines 80-81 |
| Keystone Equipment Finance Corp (KEF) | NULL — 2026-09-14, lines 31-48 | NULL — 2026-09-14, lines 31-48 | NULL — 2026-09-14, lines 31-48 | populated — 2026-09-14, line 48 | populated — 2026-09-14, lines 45-46 |
| Channel Partners Capital | NULL — 2026-09-14, lines 51-66 | NULL — 2026-09-14, lines 60-63 | NULL — 2026-09-14, lines 60-63 (WC and EF schedules differ) | populated — 2026-09-14, lines 60, 65 | populated — 2026-09-14, lines 61, 64 |
| PEAC Solutions | NULL — 2026-09-14, lines 84-99 | NULL — 2026-09-14, lines 91-98 | populated: 8–15 points — 2026-09-14, line 96 | NULL — 2026-09-14, lines 94-98 (program-dependent) | NULL — 2026-09-14, lines 98-99 (manual list not extracted) |
| Luminar Capital | NULL — 2026-09-14, lines 101-102 (separate packet is not reproduced in the spec) | NULL — 2026-09-14, lines 101-102 | NULL — 2026-09-14, lines 101-102 (separate packet is not reproduced in the spec) | NULL — 2026-09-14, lines 101-102 | NULL — 2026-09-14, lines 101-102 |
| North Mill Equipment Finance (NMEF) | populated: 10–26% EFA — 2026-09-15, lines 18-20 | NULL — 2026-09-15, lines 15-27 | populated: 4–11% standard schedule — 2026-09-15, line 22 (tiered schedule retained in notes) | NULL for app-only submissions — 2026-09-15, line 17 states financials only above $300K (conditional rule retained in notes) | NULL — 2026-09-15, lines 23-24 (asset rules remain in notes) |
| CapTech Financial | NULL — 2026-09-15, lines 38-42 | populated: 2–10 — 2026-09-15, line 42 | NULL — 2026-09-15, line 42 (“uncapped referral fee” has no schema representation) | populated — 2026-09-15, lines 39-41 | NULL — 2026-09-15, lines 40-41 (targets, not restrictions) |
| Ophelia Capital Group | NULL — 2026-09-15, lines 54-59 | NULL — 2026-09-15, lines 56-57 (same-day commission is not underwriting turnaround) | NULL — 2026-09-15, line 57 | NULL — 2026-09-15, lines 55-57 | NULL — 2026-09-15, lines 55-56 |
| Maxim Commercial Capital | populated: 18.5–55% tier range — 2026-09-17, lines 15-24 | NULL — 2026-09-17, lines 25-29 | populated: 5–15 points — 2026-09-17, lines 25-28 | populated — 2026-09-17, lines 25-29 | populated — 2026-09-17, lines 25-28 |
| Fenix Capital Funding | NULL — 2026-09-18, lines 18-26 (factor examples are not a stated range) | NULL — 2026-09-18, lines 18-26 | NULL — 2026-09-18, lines 22-25 (12 points is built into offers, not a universal compensation range) | populated — 2026-09-18, lines 21-22 | NULL — 2026-09-18, lines 27-29 (industry prohibition, not equipment restrictions) |

| Lender | stipulations / approval conditions | max advance (including tiers) | minimum down payment (including tiers) | specialties | super-broker / referral split |
|---|---|---|---|---|---|
| Alliance Funding Group (AFG) | populated: 3 months banks, deposits, no negative days, no BK — 2026-09-14, lines 107-112 | NULL — 2026-09-14, lines 107-112 | NULL — 2026-09-14, lines 107-112 | populated: working capital, equipment, transportation — 2026-09-14, lines 107-110 | NULL — 2026-09-14, lines 107-112 |
| AMUR Equipment Finance | populated: 7-year bureau, 7 tradelines, bank statements, references — 2026-09-14, lines 114-116 | NULL — 2026-09-14, lines 114-116 | populated: startup 20%; other tiers zero-down — 2026-09-14, lines 114-116 | populated: specialty vehicle and construction vendor — 2026-09-14, lines 114-116 | NULL — 2026-09-14, lines 114-116 |
| Y.E.S. Leasing | populated: signed app, 3 months business banks, invoice — 2026-09-14, lines 118-120 | NULL — 2026-09-14, lines 118-120 | populated: general 10–20%, dump 25%, yellow iron 35–50% — 2026-09-14, lines 118-120 | populated: yellow iron, vocational trucks, income-generating equipment — 2026-09-14, lines 118-120 | NULL — 2026-09-14, lines 118-120 |
| Dexly Finance | populated: application, 3 bank statements, AR, tax return, DL/VC, card statement — 2026-09-15, lines 67-74 | NULL — 2026-09-15, lines 67-74 | NULL — 2026-09-15, lines 67-74 | NULL — 2026-09-15, lines 69-71 | populated: ISO commission factor schedule — 2026-09-15, line 72 |
| TimePayment Corp | populated: conditional financials/banks, PG, site inspection — 2026-09-15, lines 79-81 | populated: tier funding caps $6K–$150K — 2026-09-15, lines 79-80 | populated: 10% startup security deposit — 2026-09-15, line 80 | NULL — 2026-09-15, lines 80-81 | NULL — 2026-09-15, lines 79-80 |
| Keystone Equipment Finance Corp (KEF) | populated: application, last 3 months banks, equipment description/invoice — 2026-09-14, line 48 | NULL — 2026-09-14, lines 42-45 | populated: startup 30%, non-startup 20%, under-2-years/no CDL 50% — 2026-09-14, line 42 | populated: transportation, construction, arbor, waste — 2026-09-14, line 39 | NULL — 2026-09-14, lines 31-48 |
| Channel Partners Capital | populated: application, banks, ID, voided check, ownership verification — 2026-09-14, lines 60, 65 | populated: EF tiers $50K–$300K, transportation max $150K — 2026-09-14, lines 61-63 | NULL — 2026-09-14, lines 60-63 | populated: transportation, hard assets, equipment finance — 2026-09-14, lines 61-64 | NULL — 2026-09-14, lines 60-63 |
| PEAC Solutions | populated: PG, banks, tax/credit history and structured-program banks — 2026-09-14, lines 92-98 | NULL — 2026-09-14, lines 92-98 | populated: structured finance has two advance payments — 2026-09-14, line 95 | NULL — 2026-09-14, lines 98-99 | NULL — 2026-09-14, lines 91-97 |
| Luminar Capital | populated: monthly revenue, deposit count, ADB, negative-day and remit limits — 2026-09-14, lines 101-102 (separate packet not reproduced) | NULL — 2026-09-14, lines 101-102 | NULL — 2026-09-14, lines 101-102 | NULL — 2026-09-14, lines 101-102 | populated: ISO compensation, clawback — 2026-09-14, lines 101-102 (separate packet not reproduced) |
| North Mill Equipment Finance (NMEF) | populated: financials/tax returns, statements, credit and collateral conditions — 2026-09-15, lines 16-27 | populated: LTV 120–175% by tier — 2026-09-15, lines 18-20 | populated: 0–10% by tier — 2026-09-15, lines 18-20 | populated: trucks, trailers, construction, medical, printing — 2026-09-15, lines 23-24 | populated: commission schedule — 2026-09-15, line 22 |
| CapTech Financial | populated: audited/reviewed or internal financials, tax returns, YTD statements — 2026-09-15, lines 39-41 | NULL — 2026-09-15, lines 38-42 | NULL — 2026-09-15, lines 38-42 | populated: technology, FF&E, logistics, manufacturing, construction, agriculture — 2026-09-15, line 40 | populated: uncapped referral fee — 2026-09-15, line 42 |
| Ophelia Capital Group | populated: ownership, deposits, negative-day/NSF, funding conditions — 2026-09-15, lines 55-57 | NULL — 2026-09-15, lines 55-57 | NULL — 2026-09-15, lines 55-57 | populated: MCA, all industries except listed exclusions — 2026-09-15, lines 55-56 | populated: same-day commissions — 2026-09-15, line 57 |
| Maxim Commercial Capital | populated: application, invoice/specs, banks, tax/property docs by product — 2026-09-17, lines 25-29 | populated: equipment 80% retail / real estate 70% CLTV — 2026-09-17, lines 14, 27-28 | populated: tier ranges 10–60% — 2026-09-17, lines 15-24 | populated: heavy equipment, vocational, trucks/trailers, structured financing, real estate — 2026-09-17, lines 13, 25-28 | populated: 5–15% by amount/product — 2026-09-17, lines 25-28 |
| Fenix Capital Funding | populated: owner application, banks, balances, ownership, AR, ID, bank verification — 2026-09-18, lines 19-22 | NULL — 2026-09-18, lines 18-26 | NULL — 2026-09-18, lines 18-26 | populated: MCA, consolidation, 1st–5th positions — 2026-09-18, lines 18-25 | populated: 20% factor points upfront / remainder after 90 days — 2026-09-18, lines 22-23 |

## Schema gaps reported

The current lender schema has no provenance/source-line column, no
program-scoped pricing, compensation, documents, restrictions, or turnaround
shape, and no nullable representation for its non-null arrays. Consequently,
conditional/tiered values remain verbatim in `notes`; unsupported fields are
seeded as `null` (or the schema-required empty array) rather than inferred.
`Luminar Capital`'s separate packet is only referenced, not reproduced, by the
2026-09-14 spec; therefore those fields remain null until a line-addressable
spec is added.