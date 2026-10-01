import assert from "node:assert/strict";
import test from "node:test";
import { captureException, initSentry } from "./sentry";

test("Sentry remains unloaded without a DSN and retains its privacy-safe capture setup when enabled", async () => {
  let loads = 0;
  let sentryOptions: Parameters<typeof import("@sentry/node").init>[0] | undefined;
  const tags = new Map<string, string>();
  let captured: unknown;

  await initSentry({
    env: {},
    loadSentry: async () => {
      loads++;
      throw new Error("Sentry should not load without a DSN");
    },
  });
  assert.equal(loads, 0);

  const mockSentry = {
    init(options: typeof sentryOptions) {
      sentryOptions = options;
    },
    withScope(callback: (scope: { setTag(key: string, value: string): void }) => void) {
      callback({ setTag: (key, value) => tags.set(key, value) });
    },
    captureException(error: unknown) {
      captured = error;
    },
  };
  await initSentry({
    env: { SENTRY_DSN: "https://example.test/123" },
    loadSentry: async () => {
      loads++;
      return mockSentry as unknown as typeof import("@sentry/node");
    },
  });
  assert.equal(loads, 1);
  assert.equal(sentryOptions?.sendDefaultPii, false);

  const event = {
    request: { data: { ssn: "should be removed" }, cookies: { session: "should be removed" }, headers: { authorization: "removed" } },
  };
  const sanitizedEvent = await sentryOptions?.beforeSend?.(event as never, {} as never);
  assert.deepEqual(sanitizedEvent?.request, {});

  const error = new Error("test error");
  captureException(error, { request_id: "test-request" });
  assert.equal(captured, error);
  assert.equal(tags.get("request_id"), "test-request");
});