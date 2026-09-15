---
name: Lender packet provenance
description: Source precedence, fixture conflicts, and structured gate provenance
---

# Lender packet provenance and matching

Authoritative lender eligibility rules belong in the packet-backed structured
seed/update data and matcher fields, never in fixture strings or notes parsing.
Keep the source text verbatim in lender notes for provenance. When source
information has no field or reliable lead input, retain it in the notes and
leave the matching value `null`; do not invent thresholds or silently turn it
into a generic lender rule. The production seed report must list unique lender
names in each displayed outcome while preserving detailed update records for
audit.

**Why:** The user explicitly corrected a fixture that contradicted a startup
credit rule: the lender specification wins; never waive a rule to make a test pass.

**How to apply:** Derive fixture lender criteria from canonical packet mappings.
Record any required borrower assumptions explicitly. Compare JSON rules by
semantic value rather than serialization order: PostgreSQL jsonb can reorder keys.
