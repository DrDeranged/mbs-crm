import assert from "node:assert/strict";
import test from "node:test";
import { formatProductionCloseoutResults } from "./productionCloseoutSummary.ts";

test("formats ordered production closeout success summaries", () => {
  const lines = formatProductionCloseoutResults([
    { operation: "lenders", status: "succeeded", details: { created: 2, unchanged: 0, createdNames: ["Dexly Finance", "Thoro Corp"], unchangedNames: [] } },
    { operation: "templates", status: "succeeded", details: { templatesCreated: 9, skippedTemplates: 0, sequenceCreated: true } },
    { operation: "slugs", status: "succeeded", details: { changed: 3, unchanged: 0, users: [{ userId: 7, slug: "arslan" }, { userId: 12, slug: "arslan-d2" }, { userId: 16, slug: "nate" }] } },
    { operation: "ownership", status: "succeeded", details: { changed: 21, ordinaryChanged: 21, ordinaryAtNate: 21, calvinCleared: 4, calvinReservedUnassigned: 4, arslanTotalDeals: 0 } },
  ]);

  assert.deepEqual(lines.map((line) => line.label), ["ownership", "slugs", "templates", "lenders"]);
  assert.match(lines[0].summary, /21 changed.*21 ordinary changed.*21 at Nate Ford.*4 Calvin cleared/);
  assert.match(lines[1].summary, /3 changed.*targets: 7 → arslan, 12 → arslan-d2, 16 → nate/);
  assert.equal(lines[2].summary, "9 created · 0 skipped · nurture sequence created");
  assert.match(lines[3].summary, /2 created.*Dexly Finance, Thoro Corp/);
});

test("formats failed and skipped closeout statuses", () => {
  const lines = formatProductionCloseoutResults([
    { operation: "ownership", status: "succeeded", details: { changed: 0 } },
    { operation: "slugs", status: "failed", details: { error: "slug conflict" } },
    { operation: "templates", status: "skipped", details: { reason: "Skipped after slugs failed" } },
    { operation: "lenders", status: "skipped", details: { reason: "Skipped after slugs failed" } },
  ]);

  assert.equal(lines[1].summary, "Error: slug conflict");
  assert.equal(lines[2].summary, "Skipped: Skipped after slugs failed");
  assert.equal(lines[3].status, "skipped");
});