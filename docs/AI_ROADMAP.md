# AI Roadmap

## Purpose

This document outlines the next AI phase for stakeholder review. Each capability
is intended to assist the team while preserving human approval for customer
communications, lender decisions, and material lead-data changes.

## 1. AI Voice Qualification

**What it does:** Once the phone system is credentialed, AI assists with
outbound qualification calls using approved scripts. It transcribes the call,
creates call notes automatically, and extracts qualifying details such as
requested amount, funding timeline, and equipment type into the lead record.

**What it needs:** Credentialed Twilio calling, call-recording and transcription
consent controls, approved qualification scripts, lead-field mappings, and a
review/audit path for extracted values before or after they are written.

**Rough effort:** 3–5 weeks, including telephony integration, consent handling,
transcription, extraction, CRM writes, and end-to-end testing.

## 2. Inbound Email Intelligence

**What it does:** Once email is credentialed, AI classifies inbound replies as
interested, not now, wrong contact, or another approved category. It drafts a
suggested response, updates the lead status where rules allow, and flags hot
replies to the assigned rep immediately. Sending remains a deliberate human
action through the existing email path.

**What it needs:** Credentialed inbound email, message ingestion and threading,
classification labels, status-transition rules, response templates, rep
notification delivery, and retention/consent policies for message content.

**Rough effort:** 2–4 weeks, including ingestion, classification, draft review,
status updates, notifications, and failure/retry handling.

## 3. Auto-Qualification & Routing

**What it does:** New website leads receive an AI pre-qualification pass before
an employee opens the record. The pass identifies missing data, compares the
lead’s industry and request with current lender boxes, produces a fit summary,
and routes the lead to the most appropriate rep.

**What it needs:** Reliable website-lead events, complete lender-box data,
routing rules and rep capacity signals, a defined fit-summary format, and
fallback behavior when data is incomplete or the model is uncertain.

**Rough effort:** 3–5 weeks, including event processing, lender-fit evaluation,
routing logic, summary presentation, and operational monitoring.

## 4. Funder Intelligence

**What it does:** Admins can upload lender guideline PDFs and receive a draft
lender record. AI extracts the same kinds of guideline details currently
captured manually for AFG, AMUR, YES, and FINPAC, while preserving source
references. An admin reviews and approves the draft before it affects matching.

**What it needs:** PDF upload and storage, document parsing/OCR for scanned
packets, a normalized lender-guideline schema, source citations, duplicate
detection, and an admin approval workflow.

**Rough effort:** 3–4 weeks, including extraction, normalization, source
traceability, draft records, approval, and representative packet testing.

## 5. Portfolio Analytics

**What it does:** A monthly AI review summarizes conversion by source and
industry, identifies lender-box coverage gaps such as working-capital
shortages, and suggests lender-recruitment priorities. Outputs are aggregate
planning insights rather than automated decisions.

**What it needs:** Stable outcome definitions, complete source/industry/lender
data, a monthly reporting window, trustworthy aggregate queries, and an
analyst-facing review and export surface.

**Rough effort:** 2–3 weeks, including metric definitions, aggregate analysis,
gap detection, review workflow, and scheduled report generation.