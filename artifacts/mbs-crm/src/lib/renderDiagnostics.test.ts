import test from "node:test";
import assert from "node:assert/strict";
import { describeRenderError } from "./renderDiagnostics.ts";

test("identifies import failures without leaking URL credentials or values", () => {
  const error = new TypeError("Failed to fetch dynamically imported module: https://private.example/src/pages/dashboard.tsx?token=private-token");
  const result = describeRenderError(error, "\n    at Dashboard (https://private.example/src/pages/dashboard.tsx?token=private-token:12:4)\n    at AppShell (private record)");
  assert.match(result, /TypeError: A page code import failed/);
  assert.match(result, /Components: Dashboard → AppShell/);
  assert.doesNotMatch(result, /private|token|https|record/);
});

test("unknown errors do not display arbitrary exception data", () => {
  const result = describeRenderError(new Error("Jane Example jane@example.com SSN 123-45-6789 Bearer private-token"));
  assert.doesNotMatch(result, /Jane|@|123|Bearer|private-token/);
  assert.match(result, /failed to render/);
});

test("classifies common render errors using fixed safe descriptions", () => {
  assert.match(describeRenderError(new Error("Rendered more hooks than during the previous render.")), /hook order/);
  assert.match(describeRenderError(new Error("Maximum update depth exceeded")), /state-update loop/);
  assert.match(describeRenderError(new TypeError("Cannot read properties of undefined (reading 'secret-field')")), /missing value/);
  assert.match(describeRenderError(new RangeError("Invalid time value")), /invalid date/);
  assert.match(describeRenderError(new Error("AppearanceProvider is required.")), /appearance context/);
  assert.match(describeRenderError(null), /^Error:/);
});