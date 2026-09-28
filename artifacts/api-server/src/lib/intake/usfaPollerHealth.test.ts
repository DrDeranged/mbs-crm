import assert from "node:assert/strict";
import test from "node:test";
import {
  createUsfaPollerRunTracker,
  hasUnhealthyArmedUsfaPoller,
  usfaPollerDisarmedReason,
  usfaPollerJobSummary,
} from "./usfaPollerHealth";

test("USFA poller health records its last run, result status, and item count", () => {
  const tracker = createUsfaPollerRunTracker(() => new Date("2026-02-03T04:05:06.000Z"));
  assert.deepEqual(tracker.snapshot(true, null), {
    lastRanAt: null, status: "never", itemsProcessed: 0, armed: true, reason: null,
  });

  tracker.start();
  assert.deepEqual(tracker.snapshot(true, null), {
    lastRanAt: "2026-02-03T04:05:06.000Z", status: "running", itemsProcessed: 0, armed: true, reason: null,
  });

  tracker.finish("degraded", 7);
  assert.deepEqual(tracker.snapshot(true, null), {
    lastRanAt: "2026-02-03T04:05:06.000Z", status: "degraded", itemsProcessed: 7, armed: true, reason: null,
  });
});

test("USFA poller health reports skipped runs, failures, and disarm reasons", () => {
  const tracker = createUsfaPollerRunTracker(() => new Date("2026-02-03T04:05:06.000Z"));
  tracker.start();
  tracker.finish("skipped", 0);
  assert.equal(tracker.snapshot(false, "Google service account is not configured").reason,
    "Google service account is not configured");
  tracker.start();
  tracker.fail();
  assert.equal(tracker.snapshot(true, null).status, "error");
  assert.equal(usfaPollerDisarmedReason(true, null),
    "Background jobs are disabled by DISABLE_BACKGROUND_JOBS");
  assert.equal(usfaPollerDisarmedReason(false, "Sheet ID is not configured"),
    "Sheet ID is not configured");
});

test("deep-health job summary exposes both USFA pollers with the operational fields", () => {
  const sheet = createUsfaPollerRunTracker().snapshot(false, "Sheet ID is not configured");
  const application = createUsfaPollerRunTracker().snapshot(true, null);
  const jobs = usfaPollerJobSummary(sheet, application);
  assert.deepEqual(Object.keys(jobs), ["usfa-sheet", "usfa-application"]);
  for (const job of Object.values(jobs)) {
    assert.equal("lastRanAt" in job, true);
    assert.equal("status" in job, true);
    assert.equal("itemsProcessed" in job, true);
    assert.equal("armed" in job, true);
    assert.equal("reason" in job, true);
  }
  assert.equal(jobs["usfa-sheet"].reason, "Sheet ID is not configured");
});

test("only armed USFA pollers with a failed last run affect overall health", () => {
  const tracker = createUsfaPollerRunTracker();
  tracker.start();
  tracker.fail();
  const failed = tracker.snapshot(true, null);
  const optionalUnconfigured = tracker.snapshot(false, "Object Storage is not configured");
  const neverRanButArmed = createUsfaPollerRunTracker().snapshot(true, null);

  assert.equal(hasUnhealthyArmedUsfaPoller(failed, neverRanButArmed), true);
  assert.equal(hasUnhealthyArmedUsfaPoller(optionalUnconfigured, neverRanButArmed), false);
  assert.equal(hasUnhealthyArmedUsfaPoller(neverRanButArmed), false);
});