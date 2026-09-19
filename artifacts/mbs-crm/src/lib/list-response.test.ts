import assert from "node:assert/strict";
import test from "node:test";
import { listData, listPayload } from "./list-response.ts";

test("list data never exposes a non-array value to list consumers", () => {
  assert.deepEqual(listData(undefined), { items: [], malformed: false });
  assert.deepEqual(listData([{ id: 1 }]), { items: [{ id: 1 }], malformed: false });
  assert.deepEqual(listData({ error: "nope" }), { items: [], malformed: true });
  assert.deepEqual(listData(null), { items: [], malformed: true });
});

test("list payload accepts only arrays or configured array envelopes", () => {
  assert.deepEqual(listPayload({ users: [{ id: 2 }] }, ["users"]), {
    items: [{ id: 2 }],
    malformed: false,
  });
  assert.deepEqual(listPayload({ users: "wrong" }, ["users"]), {
    items: [],
    malformed: true,
  });
});