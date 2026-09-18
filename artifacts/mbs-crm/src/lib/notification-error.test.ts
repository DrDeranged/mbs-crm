import assert from "node:assert/strict";
import test from "node:test";
import { getNotificationLoadError } from "./notification-error.ts";

test("notification errors include status and server reason for admins", () => {
  assert.equal(
    getNotificationLoadError(
      {
        status: 422,
        statusText: "Unprocessable Entity",
        data: { error: "Invalid limit" },
      },
      true,
    ),
    "HTTP 422: Invalid limit",
  );
});

test("notification errors do not expose server diagnostics to non-admins", () => {
  assert.equal(
    getNotificationLoadError(
      {
        status: 500,
        statusText: "Internal Server Error",
        data: { error: "database credentials leaked" },
        message: "HTTP 500 Internal Server Error: database credentials leaked",
      },
      false,
    ),
    "HTTP 500: Internal Server Error",
  );
});

test("notification errors retain the HTTP status when no reason is available", () => {
  assert.equal(
    getNotificationLoadError({ status: 503, statusText: "" }, false),
    "HTTP 503: Request failed",
  );
});