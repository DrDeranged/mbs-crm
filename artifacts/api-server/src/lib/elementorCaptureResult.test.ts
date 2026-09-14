import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { parseElementorCaptureRequest } from "./elementorCaptureResult.ts";

test("malformed Elementor root gets a stable 400 HTTP result", () => {
  assert.deepEqual(parseElementorCaptureRequest(null), {
    ok: false,
    status: 400,
    body: { error: "Invalid Elementor payload: expected an object" },
  });
});

test("malformed fields and non-string name values get a 400 envelope without throwing", () => {
  const nullFields = parseElementorCaptureRequest({ fields: null });
  assert.equal(nullFields.ok, false);
  assert.equal(nullFields.status, 400);
  assert.match(nullFields.body.error, /fields must be an object/);

  const nonStringName = parseElementorCaptureRequest({ fields: { name: { value: 42 } } });
  assert.equal(nonStringName.ok, false);
  assert.equal(nonStringName.status, 400);
  assert.match(nonStringName.body.error, /Invalid Elementor name/);
});