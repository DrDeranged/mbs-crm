import assert from "node:assert/strict";
import test from "node:test";
import { DASHBOARD_EMPTY_STATES } from "./dashboardEmptyStates.ts";

test("dashboard uses the approved empty-state copy", () => {
  assert.equal(DASHBOARD_EMPTY_STATES.repActivity, "No rep activity in this period yet");
  assert.equal(DASHBOARD_EMPTY_STATES.leadActivity, "Leads haven't been worked yet.");
});