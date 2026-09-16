import assert from "node:assert/strict";
import test from "node:test";
import { createHttp5xxRecorder, type Http5xxRecord } from "./httpErrorObservation";

test("5xx recorder logs and persists request correlation fields and an error stack", async () => {
  const logged: Array<{ bindings: Record<string, unknown>; message: string }> = [];
  const persisted: Http5xxRecord[] = [];
  const recorder = createHttp5xxRecorder({
    logger: { error: (bindings, message) => logged.push({ bindings, message }) },
    persist: async (record) => { persisted.push(record); },
  });

  recorder.record({
    requestId: "request-123",
    method: "POST",
    path: "/api/flyers/generate",
    userId: "user-456",
    status: 503,
    error: new Error("Flyer render timed out"),
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(persisted.length, 1);
  assert.deepEqual(
    { requestId: persisted[0]?.requestId, method: persisted[0]?.method, path: persisted[0]?.path, userId: persisted[0]?.userId, status: persisted[0]?.status },
    { requestId: "request-123", method: "POST", path: "/api/flyers/generate", userId: "user-456", status: 503 },
  );
  assert.match(persisted[0]?.stack ?? "", /Flyer render timed out/);
  assert.equal(logged[0]?.message, "HTTP 5xx response");
});

test("5xx recorder deliberately ignores non-server responses", async () => {
  let persisted = false;
  const recorder = createHttp5xxRecorder({
    logger: { error: () => assert.fail("must not log a 400") },
    persist: async () => { persisted = true; },
  });
  recorder.record({
    requestId: "request-123",
    method: "POST",
    path: "/api/example",
    userId: null,
    status: 400,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(persisted, false);
});