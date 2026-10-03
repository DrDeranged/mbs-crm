import test from "node:test";
import assert from "node:assert/strict";
import { compareApproved } from "./structure-comparison.mjs";

const button = name => ({ tag: "BUTTON", name, role: null, type: "button", href: null, disabled: false });
const a = button("A"), b = button("B"), link = { ...button("Call"), tag: "A", href: "tel:+12025550123", type: null };
const key = "leads-390-rep";
const rules = { keys: { [key]: {
  replacements: [{ index: 1, before: [], after: [link] }],
  beforeExempt: [], afterExempt: [button("Upload")],
} } };
const compare = (before = [a,b], after = [a,link,b], exemptions = [button("Upload")]) =>
  compareApproved(key,before,after,[],exemptions,rules);
test("accepts only the exact approved insertion and exemption", () => assert.equal(compare().passed,true));
test("rejects an additional contact link", () => assert.equal(compare([a,b],[a,link,link,b]).passed,false));
test("rejects removal including a completely empty inventory", () => {
  assert.equal(compare([a,b],[a,link]).passed,false);
  assert.equal(compare([a,b],[]).passed,false);
});
test("rejects reordered surviving controls", () => assert.equal(compare([a,b],[b,link,a]).passed,false));
test("rejects changed destination or disabled state", () => {
  assert.equal(compare([a,b],[a,{...link,href:"tel:+19999999999"},b]).passed,false);
  assert.equal(compare([a,b],[a,link,{...b,disabled:true}]).passed,false);
});
test("rejects an extra control hidden inside an approved container", () =>
  assert.equal(compare([a,b],[a,link,b],[button("Upload"),button("Delete")]).passed,false));
test("rejects unknown page/role/width contracts", () =>
  assert.throws(()=>compareApproved("settings-999-owner",[a],[a],[],[],rules),/No approved/));
test("rejects baseline drift at an approved replacement", () => {
  const manifest={keys:{[key]:{replacements:[{index:0,before:[a],after:[link]}],beforeExempt:[],afterExempt:[]}}};
  assert.equal(compareApproved(key,[b],[link],[],[],manifest).passed,false);
});
test("dashboard accepts company-first labels only at unchanged control positions", () => {
  const k="dashboard-390-admin", old=button("New owner for Fixture Equipment LLC");
  const renamed={...old,name:"New owner for Fixture Equipment LLC — Synthetic Contact"};
  const m={keys:{[k]:{replacements:[{index:0,before:[old],after:[renamed]}],beforeExempt:[],afterExempt:[]}}};
  const result=compareApproved(k,[old,b],[renamed,b],[],[],m);
  assert.equal(result.passed,true);
  assert.equal(result.dashboardAudit.descriptorsExceptNameUnchangedAtEveryIndex,true);
  assert.equal(compareApproved(k,[old,b],[b,renamed],[],[],m).passed,false);
});