import assert from "node:assert/strict";
import test from "node:test";
import {
  getClerkFapiOrigin,
  LEGACY_CLERK_FAPI,
  clerkProxyMiddleware,
} from "../middlewares/clerkProxyMiddleware";
import { createClerkHealthProbe } from "./clerkHealth";

function publishableKey(prefix: "pk_test" | "pk_live", hostname: string): string {
  return `${prefix}_${Buffer.from(`${hostname}$`).toString("base64url")}`;
}

test("Clerk FAPI origin is derived from test and live publishable keys", () => {
  assert.equal(
    getClerkFapiOrigin(publishableKey("pk_test", "select-humpback-65.clerk.accounts.dev")),
    "https://select-humpback-65.clerk.accounts.dev",
  );
  assert.equal(
    getClerkFapiOrigin(publishableKey("pk_live", "clerk.app.example.com")),
    "https://clerk.app.example.com",
  );
});

test("Clerk FAPI origin uses the legacy fallback for invalid keys", () => {
  assert.equal(getClerkFapiOrigin("pk_test_not a host"), LEGACY_CLERK_FAPI);
  assert.equal(getClerkFapiOrigin(""), LEGACY_CLERK_FAPI);
});

test("production proxy emits a fatal diagnostic when its secret is missing", () => {
  const calls: unknown[][] = [];
  clerkProxyMiddleware({
    env: { NODE_ENV: "production", CLERK_PUBLISHABLE_KEY: "pk_test_invalid" },
    log: { fatal: (...args: unknown[]) => { calls.push(args); } } as any,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.[0], { missingVariable: "CLERK_SECRET_KEY" });
});

test("Clerk health probes the decoded host and caches the result", async () => {
  let now = 1_000;
  const requested: string[] = [];
  const probe = createClerkHealthProbe({
    env: () => ({
      CLERK_SECRET_KEY: "present",
      CLERK_PUBLISHABLE_KEY: publishableKey("pk_test", "instance.clerk.accounts.dev"),
    }),
    request: async (url) => { requested.push(url); },
    now: () => now,
    timeoutMs: 25,
    cacheMs: 100,
  });

  assert.deepEqual(await probe(), {
    secretKey: true,
    publishableKey: true,
    proxyReachable: true,
  });
  assert.deepEqual(await probe(), {
    secretKey: true,
    publishableKey: true,
    proxyReachable: true,
  });
  assert.deepEqual(requested, ["https://instance.clerk.accounts.dev"]);

  now += 101;
  await probe();
  assert.equal(requested.length, 2);
});

test("Clerk health reports missing keys and an unreachable upstream", async () => {
  const probe = createClerkHealthProbe({
    env: () => ({}),
    request: async () => { throw new Error("unreachable"); },
    timeoutMs: 25,
  });
  assert.deepEqual(await probe(), {
    secretKey: false,
    publishableKey: false,
    proxyReachable: false,
  });
});