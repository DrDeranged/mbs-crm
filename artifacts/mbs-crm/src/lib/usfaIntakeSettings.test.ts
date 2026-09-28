import assert from "node:assert/strict";
import test from "node:test";
import { usfaConnectionInputValues, usfaConnectionLoadStatus } from "./usfaIntakeSettings.ts";

test("USFA connection inputs hydrate from persisted settings after a reload", () => {
  assert.deepEqual(usfaConnectionInputValues({
    usfaSheetId: "saved-sheet-id",
    usfaSheetTab: "Applications",
  }), {
    sheetId: "saved-sheet-id",
    sheetTab: "Applications",
  });
});

test("USFA connection inputs handle an unconfigured sheet with the default tab", () => {
  assert.deepEqual(usfaConnectionInputValues({
    usfaSheetId: null,
    usfaSheetTab: "",
  }), {
    sheetId: "",
    sheetTab: "Sheet1",
  });
});

test("USFA settings load errors expose their HTTP status or network failure", () => {
  assert.equal(usfaConnectionLoadStatus(503), "HTTP 503");
  assert.equal(usfaConnectionLoadStatus(null), "HTTP status unavailable (network error)");
});