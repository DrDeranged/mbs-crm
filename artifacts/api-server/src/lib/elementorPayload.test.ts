import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types test runner resolves explicit .ts imports.
import { parseElementorPayload } from "./elementorPayload.ts";

test("parses valid nested Elementor fields", () => {
  const result = parseElementorPayload({
    fields: {
      name: { type: "text", value: "Jane Doe" },
      email: { type: "email", value: "Jane@Example.com" },
      field_0bb8c14: { type: "tel", value: "(555) 555-1212" },
    },
  });
  assert.deepEqual(result, {
    ok: true,
    data: {
      firstName: "Jane",
      lastName: "Doe",
      fullName: "Jane Doe",
      email: "jane@example.com",
      phone: "(555) 555-1212",
      message: "",
      company: "",
    },
  });
});

test("rejects malformed payload containers and name values", () => {
  assert.equal(parseElementorPayload(null).ok, false);
  assert.equal(parseElementorPayload({ fields: [] }).ok, false);
  const badEntry = parseElementorPayload({ fields: { name: "Jane Doe" } });
  assert.equal(badEntry.ok, false);
  assert.match(badEntry.ok ? "" : badEntry.error, /Invalid Elementor name/);
  assert.equal(parseElementorPayload({ fields: { name: {} } }).ok, false);
  const badName = parseElementorPayload({ name: { first: "Jane" } });
  assert.equal(badName.ok, false);
  assert.match(badName.ok ? "" : badName.error, /Invalid Elementor name/);
});

test("keeps valid empty and no-contact webhook shapes as semantic outcomes", () => {
  assert.deepEqual(parseElementorPayload({}), {
    ok: true,
    data: { firstName: "", lastName: "", fullName: "", email: "", phone: "", message: "", company: "" },
  });
  assert.equal(parseElementorPayload({ fields: { message: { value: "hello" } } }).ok, true);
});