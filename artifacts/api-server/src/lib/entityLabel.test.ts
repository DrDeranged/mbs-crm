import assert from "node:assert/strict";
import test from "node:test";
import { contactName, entityLabel } from "./entityLabel";

test("entity labels trim identity and prefer company before contact", () => {
  assert.equal(contactName(" John ", " Smith "), "John Smith");
  assert.equal(entityLabel(" Godspeed Logistics ", " John Smith ", "Lead #1"), "Godspeed Logistics — John Smith");
  assert.equal(entityLabel(" Godspeed Logistics ", "", "Lead #1"), "Godspeed Logistics");
  assert.equal(entityLabel("", " John Smith ", "Lead #1"), "John Smith");
  assert.equal(entityLabel("  ", "  ", "Lead #1"), "Lead #1");
});