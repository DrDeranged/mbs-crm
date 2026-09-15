import assert from "node:assert/strict";
import test from "node:test";
import { formatLenderSeedError, formatLenderSeedSummary, formatProductionCloseoutResults } from "./productionCloseoutSummary.ts";

test("formats ordered production closeout success summaries", () => {
  const lines = formatProductionCloseoutResults([
    { operation: "lenders", status: "succeeded", details: {
      created: 2,
      updated: 3,
      unchanged: 1,
      createdNames: ["Dexly Finance", "Thoro Corp"],
      updatedNames: ["Alliance Funding Group (AFG)", "AMUR Equipment Finance", "Y.E.S. Leasing"],
      unchangedNames: ["Navitas Credit Corp"],
    } },
    { operation: "templates", status: "succeeded", details: { templatesCreated: 9, skippedTemplates: 0, sequenceCreated: true } },
    { operation: "slugs", status: "succeeded", details: { changed: 3, unchanged: 0, users: [{ userId: 7, slug: "arslan" }, { userId: 12, slug: "arslan-d2" }, { userId: 16, slug: "nate" }] } },
    { operation: "ownership", status: "succeeded", details: { changed: 21, ordinaryChanged: 21, ordinaryAtNate: 21, calvinCleared: 4, calvinReservedUnassigned: 4, arslanTotalDeals: 0 } },
  ]);

  assert.deepEqual(lines.map((line) => line.label), ["ownership", "slugs", "templates", "lenders"]);
  assert.match(lines[0].summary, /21 changed.*21 ordinary changed.*21 at Nate Ford.*4 Calvin cleared/);
  assert.match(lines[1].summary, /3 changed.*targets: 7 → arslan, 12 → arslan-d2, 16 → nate/);
  assert.equal(lines[2].summary, "9 created · 0 skipped · nurture sequence created");
  assert.equal(
    lines[3].summary,
    "created 2 / updated 3 / unchanged 1 · created: Dexly Finance, Thoro Corp · updated: Alliance Funding Group (AFG), AMUR Equipment Finance, Y.E.S. Leasing · unchanged: Navitas Credit Corp",
  );
});

test("formats a lender seed summary with missing update targets separately", () => {
  const lines = formatProductionCloseoutResults([
    {
      operation: "lenders",
      status: "succeeded",
      details: {
        created: 0,
        updated: 0,
        unchanged: 8,
        createdNames: [],
        updatedNames: [],
        unchangedNames: ["Dexly Finance", "Thoro Corp"],
        missingUpdateNames: ["AMUR Equipment Finance"],
      },
    },
  ]);

  assert.equal(
    lines[0].summary,
    "created 0 / updated 0 / unchanged 8 · created: none · updated: none · unchanged: Dexly Finance, Thoro Corp · missing: AMUR Equipment Finance",
  );
});

test("uses the exact lender count/name structure for first and repeat runs", () => {
  assert.equal(
    formatLenderSeedSummary({
      created: 6,
      updated: 3,
      unchanged: 2,
      createdNames: [
        "Navitas Credit Corp",
        "Keystone Equipment Finance Corp (KEF)",
        "Channel Partners Capital",
        "TimePayment Corp",
        "PEAC Solutions",
        "Luminar Capital",
      ],
      updatedNames: ["Alliance Funding Group (AFG)", "AMUR Equipment Finance", "Y.E.S. Leasing"],
      unchangedNames: ["Dexly Finance", "Thoro Corp"],
    }),
    "created 6 / updated 3 / unchanged 2 · created: Navitas Credit Corp, Keystone Equipment Finance Corp (KEF), Channel Partners Capital, TimePayment Corp, PEAC Solutions, Luminar Capital · updated: Alliance Funding Group (AFG), AMUR Equipment Finance, Y.E.S. Leasing · unchanged: Dexly Finance, Thoro Corp",
  );
  assert.equal(
    formatLenderSeedSummary({
      created: 0,
      updated: 0,
      unchanged: 11,
      createdNames: [],
      updatedNames: [],
      unchangedNames: [
        "Dexly Finance",
        "Thoro Corp",
        "Navitas Credit Corp",
        "Keystone Equipment Finance Corp (KEF)",
        "Channel Partners Capital",
        "TimePayment Corp",
        "PEAC Solutions",
        "Luminar Capital",
        "Alliance Funding Group (AFG)",
        "AMUR Equipment Finance",
        "Y.E.S. Leasing",
      ],
    }),
    "created 0 / updated 0 / unchanged 11 · created: none · updated: none · unchanged: Dexly Finance, Thoro Corp, Navitas Credit Corp, Keystone Equipment Finance Corp (KEF), Channel Partners Capital, TimePayment Corp, PEAC Solutions, Luminar Capital, Alliance Funding Group (AFG), AMUR Equipment Finance, Y.E.S. Leasing",
  );
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

test("formats manual lender fallback mutation errors for the destructive toast", () => {
  assert.equal(formatLenderSeedError(new Error("database unavailable")), "database unavailable");
  assert.equal(formatLenderSeedError({ message: "request failed" }), "request failed");
  assert.equal(formatLenderSeedError({}), "Unable to seed or update lenders.");
});