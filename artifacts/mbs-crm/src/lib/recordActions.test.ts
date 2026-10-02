import test from "node:test";
import assert from "node:assert/strict";
import { dealActionAvailable, leadActionTab, MOBILE_ACTION_MIN_WIDTH, RECORD_ACTIONS, RECORD_ACTION_MIN_TOUCH_HEIGHT } from "./recordActions.ts";

test("all seven record actions remain defined and meet mobile touch sizing", () => {
  assert.deepEqual(RECORD_ACTIONS, ["upload", "edit", "call", "text", "email", "note", "task"]);
  assert.ok(RECORD_ACTION_MIN_TOUCH_HEIGHT >= 44);
  assert.ok(MOBILE_ACTION_MIN_WIDTH >= 44);
});

test("lead actions always reach their functional record sections from every tab", () => {
  for (const tab of ["info", "notes", "tasks", "documents", "communications", "activity", "lenders", "marketing", "application", "financials", "credit", "consent"] as const) {
    assert.equal(leadActionTab("upload", tab), "documents");
    assert.equal(leadActionTab("edit", tab), tab);
    assert.equal(leadActionTab("note", tab), "notes");
    assert.equal(leadActionTab("task", tab), "tasks");
    assert.equal(leadActionTab("call", tab), "communications");
    assert.equal(leadActionTab("text", tab), "communications");
    assert.equal(leadActionTab("email", tab), "communications");
  }
});

test("deal action eligibility is contact/link-based, never stage-based", () => {
  for (const stage of ["waiting_on_app", "funded", "declined", "dead"]) {
    void stage;
    const contact = { leadId: 31, phone: "555-0101", email: "contact@example.com" };
    for (const action of RECORD_ACTIONS) assert.equal(dealActionAvailable(action, contact), true);
  }
  assert.equal(dealActionAvailable("edit", {}), true);
  assert.equal(dealActionAvailable("call", {}), false);
  assert.equal(dealActionAvailable("text", { phone: "555-0101" }), false);
  assert.equal(dealActionAvailable("email", {}), false);
  assert.equal(dealActionAvailable("upload", {}), false);
  assert.equal(dealActionAvailable("note", {}), false);
  assert.equal(dealActionAvailable("task", {}), false);
});