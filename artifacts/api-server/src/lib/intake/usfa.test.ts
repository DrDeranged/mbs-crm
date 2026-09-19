import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mapUsfaRow, USFA_HEADERS, type UsfaRow } from "./usfa";

const row: UsfaRow = {
  Id: "USFA-DOE-001", COMPANY: "Doe Street LLC", "Credit Score": "Over 700",
  Industry: "Trucking", "OWNER NAME": "", "First Name": "Jane", "Last Name": "Doe",
  Email: "Jane.Doe@example.com", "Phone 1": "2125842202.0", "Phone 2": "9175550100.0",
  EIN: "12345678.0", "START DATE": "2020-06-15", SSN: "001234567", Street: "1 Doe Street",
  City: "New York", State: "", "Zip/postal code": "10001.0", DOB: "1980-01-02",
  REVENUE: "$15,000 - $50,000", "AMOUNT REQUESTED": "642928747.0",
  "Comment / feedback": "Needs statements", CREATEDAT: "2024-01-02T03:04:05.000Z",
  "Comment 2": "Call owner", "Comment 3": "", "STATEMENT(A)": "https://usfundadvisor.ai/challenge/a",
  "STATEMENT(B)": "https://usfundadvisor.ai/challenge/b", "STATEMENT(C)": "", "STATEMENT(D)": "",
};

test("USFA mapper normalizes the exact Doe Street vendor row", () => {
  const result = mapUsfaRow(row, new Date("2025-06-16T00:00:00Z"));
  assert.deepEqual(result.lead, {
    firstName: "Jane", lastName: "Doe", email: "jane.doe@example.com", phone: "2125842202",
    companyName: "Doe Street LLC", ein: "01-2345678", applicationType: "working_capital",
    leadSource: "usfundadvisor", externalId: "USFA-DOE-001", requestedAmount: 642928747,
    creditScore: 700, creditScoreBand: "Over 700", monthlyRevenueBand: "$15,000 - $50,000",
    createdAt: new Date("2024-01-02T03:04:05.000Z"),
  });
  assert.deepEqual(result.company, {
    name: "Doe Street LLC", address: "1 Doe Street", city: "New York", state: null, zip: "10001",
    industry: "Trucking", timeInBusinessMonths: 60, annualRevenue: 180000,
  });
  assert.deepEqual(result.intakePrefill, { ssn: "001234567", dob: "1980-01-02" });
  assert.equal(result.metadata.creditScoreRaw, "Over 700");
  assert.equal(result.lead.externalId, "USFA-DOE-001");
  assert.equal(result.lead.creditScoreBand, "Over 700");
  assert.equal(result.lead.monthlyRevenueBand, "$15,000 - $50,000");
  assert.equal(result.metadata.ownerName, "Jane Doe");
  assert.deepEqual(result.metadata.statementLinks, [
    "https://usfundadvisor.ai/challenge/a", "https://usfundadvisor.ai/challenge/b",
  ]);
  assert.equal(result.metadata.altPhone, "9175550100");
  assert.equal(result.metadata.phoneInvalid, false);
  assert.equal(result.metadata.einWasShort, false);
  assert.equal(result.taskPlan?.statementCount, 2);
  assert.ok(!Object.hasOwn(result.lead, "SSN"));
  assert.ok(!Object.hasOwn(result.lead, "DOB"));
});

test("USFA source migration leaves existing companies and runtime support to later migrations", async () => {
  const migration = await readFile(new URL("../../../../../lib/db/migrations/025_usfa_intake.sql", import.meta.url), "utf8");
  assert.match(migration, /ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "external_id"/);
  assert.match(migration, /credit_score_band/);
  assert.match(migration, /monthly_revenue_band/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS "companies"/);
  assert.doesNotMatch(migration, /company_settings|usfa_application_email_log|usfa_prefill_invites|ALTER TABLE "documents"|ALTER TABLE "tasks"/);
  const runtimeMigration = await readFile(new URL("../../../../../lib/db/migrations/026_usfa_intake_runtime_support.sql", import.meta.url), "utf8");
  assert.match(runtimeMigration, /company_settings|usfa_application_email_log|usfa_prefill_invites/);
});

test("mapper preserves the exact 28-header contract and handles score/revenue bands", () => {
  assert.equal(USFA_HEADERS.length, 28);
  const under = mapUsfaRow({ Id: "2", "Credit Score": "Under 600", REVENUE: "12000" });
  assert.equal(under.lead.creditScore, null);
  assert.equal(under.metadata.monthlyRevenueFloor, 12000);
  assert.equal(under.metadata.monthlyRevenueCeiling, 12000);
  assert.equal(under.company.annualRevenue, 144000);
  const range = mapUsfaRow({ Id: "3", "Credit Score": "650-699", REVENUE: "$15,000 - $50,000" });
  assert.equal(range.lead.creditScore, 650);
  assert.equal(range.metadata.monthlyRevenueCeiling, 50000);
});

test("mapper zero-pads EIN and zip, flags short EIN, and keeps SSN/DOB out of lead data", () => {
  const result = mapUsfaRow({ Id: "4", EIN: "1234567.0", "Zip/postal code": "42", SSN: "123-45-6789", DOB: "01/02/1980" });
  assert.equal(result.lead.ein, "00-1234567");
  assert.equal(result.metadata.einWasShort, true);
  assert.equal(result.company.zip, "00042");
  assert.deepEqual(result.intakePrefill, { ssn: "123-45-6789", dob: "01/02/1980" });
  assert.ok(!Object.hasOwn(result.lead, "ssn"));
  assert.ok(!Object.hasOwn(result.lead, "dob"));
});

test("dedupe plan prefers external id and excludes the vendor's test address from email matching", () => {
  const normal = mapUsfaRow({ Id: "5", Email: "person@example.com", "Phone 1": "212-555-0101" });
  assert.equal(normal.dedupePlan.action, "external_id_first_then_reapplication");
  assert.deepEqual(normal.dedupePlan.matchOrder, ["external_id", "email", "phone"]);
  assert.equal(normal.dedupePlan.allowEmailMatch, true);
  const testRow = mapUsfaRow({ Id: "6", Email: "tech@usfundadvisor.ai" });
  assert.equal(testRow.dedupePlan.allowEmailMatch, false);
  assert.equal(testRow.dedupePlan.phone, null);
});

test("mapper rejects rows without an external id and marks malformed primary phones", () => {
  assert.throws(() => mapUsfaRow({ COMPANY: "Missing ID" }), /Id is required/);
  const result = mapUsfaRow({ Id: "8", "Phone 1": "21255501" });
  assert.equal(result.lead.phone, "21255501");
  assert.equal(result.metadata.phoneInvalid, true);
});

test("comments, alternate phone, and statement metadata never fetch or embed statement contents", () => {
  const result = mapUsfaRow({
    Id: "7", "Phone 2": "2125550102", "Comment / feedback": "one", "Comment 2": "two",
    "STATEMENT(A)": "https://usfundadvisor.ai/challenge/secret",
  });
  assert.deepEqual(result.metadata.comments, ["one", "two"]);
  assert.equal(result.metadata.altPhone, "2125550102");
  assert.deepEqual(result.metadata.statementLinks, ["https://usfundadvisor.ai/challenge/secret"]);
  assert.equal(result.taskPlan?.title, "Download bank statements from USFA dashboard and upload as Bank statement");
  assert.equal(JSON.stringify(result).includes("statement contents"), false);
});