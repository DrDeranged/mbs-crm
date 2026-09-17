import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getTableName } from "drizzle-orm";
import {
  PARTNER_CONTACT_ROLES,
  PARTNER_TYPES,
  SUBMISSION_METHODS,
  partnerContactsTable,
} from "./schema/lenders";

test("partner model exposes the requested controlled vocabularies", () => {
  assert.deepEqual(PARTNER_TYPES, ["direct_lender", "broker_out", "broker_in"]);
  assert.deepEqual(SUBMISSION_METHODS, ["email", "portal", "both"]);
  assert.deepEqual(PARTNER_CONTACT_ROLES, ["rep", "submissions", "credit", "docs", "funding", "other"]);
  assert.equal(getTableName(partnerContactsTable), "partner_contacts");
});

test("partner migration is append-only and contains safe backfill and seed", async () => {
  const sql = await readFile(new URL("../migrations/036_partners_contacts.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE partner_contacts/);
  assert.match(sql, /FROM lenders/);
  assert.match(sql, /'Jes Orozco'/);
  assert.match(sql, /'jorozco@ridgestonecap\.com'/);
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i);
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\s+lenders\s+(RENAME|DROP)\b/i);
});