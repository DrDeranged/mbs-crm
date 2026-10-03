import test from "node:test";
import assert from "node:assert/strict";
import { appearanceKey, readAppearance, resolveAppearance } from "./appearance.ts";
test("appearance defaults to light and never loads another account's preference", () => {
  const values = new Map([[appearanceKey("a"),"dark"],[appearanceKey("b"),"light"],[appearanceKey("os"),"system"]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null };
  assert.equal(readAppearance(storage,null),"light");
  assert.equal(readAppearance(storage,"a"),"dark");
  assert.equal(readAppearance(storage,"b"),"light");
  assert.equal(readAppearance(storage,"c"),"light");
  assert.equal(readAppearance(storage,"os"),"system");
});
test("system follows OS while explicit modes override it", () => {
  assert.equal(resolveAppearance("system",true),"dark");
  assert.equal(resolveAppearance("system",false),"light");
  assert.equal(resolveAppearance("light",true),"light");
  assert.equal(resolveAppearance("dark",false),"dark");
});
test("invalid and inaccessible storage preferences are safe", () => {
  assert.equal(readAppearance({getItem:()=>"other"},"a"),"light");
  assert.equal(readAppearance({getItem:()=>{throw new Error("blocked");}},"a"),"light");
});