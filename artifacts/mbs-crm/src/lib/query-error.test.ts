import assert from "node:assert/strict";
import test from "node:test";
import { getQueryErrorReason, getQueryErrorStatus } from "./query-error.ts";

test("reads status from generated API errors", () => {
  assert.equal(getQueryErrorStatus({ status: 404 }), 404);
  assert.equal(getQueryErrorStatus({ response: { status: 503 } }), 503);
  assert.equal(getQueryErrorStatus(new Error("network failure")), undefined);
});

test("prefers a server API reason and falls back to the error message", () => {
  assert.equal(
    getQueryErrorReason({ data: { detail: "database unavailable" }, message: "HTTP 500" }),
    "database unavailable",
  );
  assert.equal(getQueryErrorReason(new Error("Failed to fetch")), "Failed to fetch");
  assert.equal(getQueryErrorReason({ status: 500 }), null);
});