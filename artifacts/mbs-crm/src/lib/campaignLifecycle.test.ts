import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  allowedTabs, defaultTab, resolveTab, canArchive, canUnarchive, canDeleteCampaign, compareLabel,
  recoveryAction, shouldPollRecovery, cancelledSummary, isCampaignQueryKey, recoveryLinkedLabel, canManageLifecycle,
} from "./campaignLifecycle.ts";

const src = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

test("launched statuses expose only results, content, audience with results default", () => {
  for (const s of ["running", "paused", "completed", "cancelled", "failed"]) {
    assert.deepEqual(allowedTabs(s), ["results", "content", "audience"]);
    assert.equal(defaultTab(s), "results");
    assert.equal(resolveTab(s, "review"), "results");
  }
});

test("draft, approved and scheduled use the four step flow; scheduled opens on launch", () => {
  for (const s of ["draft", "approved", "scheduled"]) assert.deepEqual(allowedTabs(s), ["content", "audience", "review", "launch"]);
  assert.equal(defaultTab("draft"), "content");
  assert.equal(defaultTab("scheduled"), "launch");
  assert.equal(resolveTab("approved", "launch"), "launch");
});

test("archive, unarchive and delete eligibility", () => {
  assert.equal(canManageLifecycle("admin"), true);
  assert.equal(canManageLifecycle("manager"), false);
  assert.equal(canManageLifecycle("rep"), false);
  for (const s of ["draft", "completed", "cancelled", "failed"]) assert.equal(canArchive({ status: s }), true);
  for (const s of ["approved", "scheduled", "running", "paused"]) assert.equal(canArchive({ status: s }), false);
  assert.equal(canArchive({ status: "draft", archivedAt: "2025-01-01" }), false);
  assert.equal(canUnarchive({ archivedAt: "2025-01-01" }), true);
  assert.equal(canDeleteCampaign("admin", { canDelete: true }), true);
  assert.equal(canDeleteCampaign("admin", { canDelete: false }), false);
  assert.equal(canDeleteCampaign("manager", { canDelete: true }), false);
});

test("compare labels use name, status and send date or Not sent", () => {
  assert.equal(compareLabel({ name: "Q3", status: "draft", sendDate: null }), "Q3 \u00b7 Draft \u00b7 Not sent");
  assert.match(compareLabel({ name: "Q3", status: "completed", sendDate: "2025-03-04T15:00:00Z" }), /^Q3 \u00b7 Completed \u00b7 Mar \d, 2025$/);
});

test("recovery action gating and linked states", () => {
  const none = { eligibleRemaining: 4, recoveries: [] };
  assert.equal(recoveryAction("rep", none).kind, "none");
  assert.equal(recoveryAction("manager", none).kind, "none");
  assert.equal(recoveryAction("admin", none).kind, "create");
  assert.equal(recoveryAction("admin", { eligibleRemaining: 0, recoveries: [] }).kind, "none");
  assert.equal(recoveryAction("admin", undefined).kind, "none");
  const linked = (status: string) => recoveryAction("manager", { eligibleRemaining: 9, recoveries: [{ id: 7, name: "R", status }] });
  assert.deepEqual(linked("completed"), { kind: "linked", label: "Remaining recipients sent via R", campaignId: 7 });
  assert.match(recoveryLinkedLabel({ id: 1, name: "R", status: "scheduled" }), /awaiting send via R/);
  assert.match(recoveryLinkedLabel({ id: 1, name: "R", status: "approved" }), /awaiting send via R/);
  assert.match(recoveryLinkedLabel({ id: 1, name: "R", status: "running" }), /sending now via R/);
  assert.match(recoveryLinkedLabel({ id: 1, name: "R", status: "paused" }), /paused/);
});

test("cancelled summary never calls source pending Queued and lists reasons", () => {
  const s = cancelledSummary({ notSentHere: 10, sentViaRecovery: 6, pendingViaRecovery: 2, exclusions: [{ reason: "unsubscribed", count: 1 }, { reason: "No email address", count: 3 }] });
  assert.equal(s.headline, "10 not sent here \u2014 6 sent via linked recovery, 4 excluded: Unsubscribed (1), No email address (3)");
  assert.doesNotMatch(s.headline, /Queued/);
  assert.match(s.pending ?? "", /2 still pending/);
  assert.equal(cancelledSummary({ notSentHere: 1, sentViaRecovery: 0, pendingViaRecovery: 0, exclusions: [] }).pending, null);
});

test("recovery polling and lifecycle invalidation cover every campaign query", () => {
  assert.equal(shouldPollRecovery({ pendingViaRecovery: 1, recoveries: [] }), true);
  assert.equal(shouldPollRecovery({ pendingViaRecovery: 0, recoveries: [{ id: 1, name: "R", status: "completed" }] }), false);
  for (const k of ["/api/campaigns", "/api/campaigns/3", "/api/campaigns/3/recovery", "/api/campaigns/metrics"]) assert.equal(isCampaignQueryKey([k]), true);
  assert.equal(isCampaignQueryKey(["/api/leads"]), false);
});

test("pages wire archive filter, delete confirmation, stepper and read-only launched tabs", async () => {
  const list = await src("../pages/campaigns.tsx");
  assert.match(list, /useListCampaigns\(\{ showArchived \}\)/);
  assert.match(list, /useListCampaignMetrics\(\{ showArchived \}/);
  assert.match(list, /useState\(false\)/);
  assert.match(list, /compareLabel\(/);
  const detail = await src("../pages/campaign-detail.tsx");
  assert.match(detail, /data-testid="campaign-stepper"/);
  assert.match(detail, /<TabsContent value="launch"/);
  assert.match(detail, /fieldset disabled=\{launched\}/);
  assert.match(detail, /disabled=\{launched \|\| !!campaign\.audienceRules/);
  assert.doesNotMatch(detail, /grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6/);
  assert.match(detail, /setLocation\("\/campaigns"\)/);
  const life = await src("../components/campaign-lifecycle-actions.tsx");
  assert.match(life, /Delete “\{campaign\?\.name\}”\?/);
  assert.match(life, /isCampaignQueryKey/);
});
