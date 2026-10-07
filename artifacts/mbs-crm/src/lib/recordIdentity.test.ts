import test from "node:test";
import assert from "node:assert/strict";
import { contactName, formatDealIdentity, formatLeadIdentity } from "./recordIdentity.ts";

test("formats lead identity company first and tolerates missing or blank fields", () => {
  assert.equal(formatLeadIdentity({ id: 12, companyName: "  Godspeed Logistics ", firstName: " John ", lastName: "Smith " }), "Godspeed Logistics — John Smith");
  assert.equal(formatLeadIdentity({ companyName: "Godspeed Logistics" }), "Godspeed Logistics");
  assert.equal(formatLeadIdentity({ firstName: "John", lastName: "Smith" }), "John Smith");
  assert.equal(formatLeadIdentity({ id: 12, companyName: "  ", firstName: " ", lastName: "" }), "Lead #12");
  assert.equal(formatLeadIdentity({ id: 12, entityLabel: "Lead #12" }), "Lead #12");
  assert.equal(formatLeadIdentity(null), "Lead");
});

test("contactName trims and combines available name parts only", () => {
  assert.equal(contactName({ firstName: " Jane ", lastName: "Doe " }), "Jane Doe");
  assert.equal(contactName({ firstName: "Jane" }), "Jane");
  assert.equal(contactName({ lastName: "Doe" }), "Doe");
  assert.equal(contactName({ firstName: " ", lastName: "" }), "");
});

test("deal cards accept authorized server business labels and explicit missing-contact states", () => {
  assert.equal(formatDealIdentity({ entityLabel: "Existing Business LLC", companyName: null, contactName: null }), "Existing Business LLC");
  assert.equal(formatDealIdentity({ entityLabel: "No lead linked" }), "No lead linked");
  assert.equal(formatDealIdentity({ entityLabel: "Lead details unavailable" }), "Lead details unavailable");
  assert.equal(formatDealIdentity({ entityLabel: "Current Lead Company — Jane Smith", companyName: "Current Lead Company", contactName: "Jane Smith" }), "Current Lead Company — Jane Smith");
});

test("formats deal identity using authorized linked lead fields with neutral fallback", () => {
  assert.equal(formatDealIdentity({
    id: 4,
    dealName: "Custom offer",
    lead: { id: 12, companyName: "Godspeed Logistics", firstName: "John", lastName: "Smith" },
  }), "Godspeed Logistics — John Smith");
  assert.equal(formatDealIdentity({ id: 4, dealName: "Custom offer", lead: { id: 12, companyName: "Godspeed Logistics" } }), "Godspeed Logistics");
  assert.equal(formatDealIdentity({ id: 4, dealName: "Custom offer", lead: { id: 12, firstName: "John", lastName: "Smith" } }), "John Smith");
  assert.equal(formatDealIdentity({ id: 4, entityLabel: "Deal #4", dealName: "Custom offer", lead: { id: 12, companyName: " ", firstName: " ", lastName: "" } }), "Deal");
  assert.equal(formatDealIdentity({ id: 4, dealName: "Custom offer" }), "Deal");
  assert.equal(formatDealIdentity({ id: 4, companyName: "Godspeed Logistics", contactName: "John Smith" }), "Godspeed Logistics — John Smith");
  assert.equal(formatDealIdentity({ dealName: "Custom offer" }), "Deal");
  assert.equal(formatDealIdentity(null), "Deal");
  assert.equal(formatDealIdentity({ id: 41, entityLabel: "Deal 41" }), "Deal");
  assert.equal(formatDealIdentity({
    lead: { companyName: "", firstName: "", lastName: "" },
    companyName: "Stale company", contactName: "Stale person", entityLabel: "Stale deal name",
  }), "Deal", "linked identity is authoritative even when its fields are empty");
  assert.equal(formatDealIdentity({
    lead: { companyName: "123 Equipment", firstName: "Alex" }, companyName: "Stale company",
  }), "123 Equipment — Alex", "legitimate company numbers are not stripped");
});