import assert from "node:assert/strict";
import test from "node:test";
import { campaignRepOptions, campaignSourceOptions } from "./campaignAudienceOptions.ts";

test("source options use database values, including imported tags, with sorted lead counts", () => {
  assert.deepEqual(campaignSourceOptions([
    { source: "prospect_list", leadCount: 521 },
    { source: "manual", leadCount: 2 },
    { source: "import:fall-event", leadCount: 7 },
    { source: "manual", leadCount: 3 },
  ]), [
    ["import:fall-event", "import:fall-event (7)"],
    ["manual", "Manual (5)"],
    ["prospect_list", "prospect_list (521)"],
  ]);
  assert.deepEqual(campaignSourceOptions([]), []);
});

test("rep options exclude inactive, merged and placeholder users, dedupe by id", () => {
  const users = [
    { id: 2, name: "Arslan Din", email: "arslan@example.com", isActive: true, mergedInto: null },
    { id: 2, name: "Arslan Din", email: "arslan@example.com", isActive: true, mergedInto: null },
    { id: 3, name: "Arslan Din", email: "former@example.com", isActive: false, mergedInto: 2 },
    { id: 4, name: "Any Rep", email: "placeholder@example.com", isActive: true, mergedInto: null },
    { id: 5, name: "Other Rep", email: "other@example.com", isActive: true, mergedInto: 2 },
    { id: 6, name: "Zoe Rep", email: "zoe@example.com", isActive: true, mergedInto: null },
  ];
  assert.deepEqual(campaignRepOptions(users).map((user) => user.id), [2, 6]);
});