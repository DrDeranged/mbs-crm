import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import {
  CLERK_FAPI,
  getClerkFapiOrigin,
  getClerkKeyPrefix,
  getClerkPublishableKeyOrigin,
  clerkProxyMiddleware,
} from "../middlewares/clerkProxyMiddleware";
import { createClerkHealthProbe } from "./clerkHealth";

function publishableKey(prefix: "pk_test" | "pk_live", hostname: string): string {
  return `${prefix}_${Buffer.from(`${hostname}$`).toString("base64url")}`;
}

test("Clerk publishable key origins are decoded for diagnostics only", () => {
  assert.equal(
    getClerkPublishableKeyOrigin(
      publishableKey("pk_test", "select-humpback-65.clerk.accounts.dev"),
    ),
    "https://select-humpback-65.clerk.accounts.dev",
  );
  assert.equal(
    getClerkPublishableKeyOrigin(publishableKey("pk_live", "clerk.app.example.com")),
    "https://clerk.app.example.com",
  );
});

test("Clerk proxy always uses the documented proxy upstream", () => {
  assert.equal(getClerkFapiOrigin(), CLERK_FAPI);
  assert.equal(getClerkPublishableKeyOrigin("pk_test_not a host"), undefined);
  assert.equal(getClerkPublishableKeyOrigin(""), undefined);
});

test("production proxy emits a fatal diagnostic when its secret is missing", () => {
  const calls: unknown[][] = [];
  clerkProxyMiddleware({
    env: { NODE_ENV: "production", CLERK_PUBLISHABLE_KEY: "pk_test_invalid" },
    log: {
      error: () => {},
      fatal: (...args: unknown[]) => { calls.push(args); },
      info: () => {},
    } as any,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.[0], { missingVariable: "CLERK_SECRET_KEY" });
});

test("production proxy logs the derived FAPI host and safe key prefixes once", () => {
  const calls: unknown[][] = [];
  clerkProxyMiddleware({
    env: {
      NODE_ENV: "production",
      CLERK_PUBLISHABLE_KEY: publishableKey("pk_live", "clerk.app.example.com"),
      CLERK_SECRET_KEY: "sk_live_secret",
    },
    log: {
      error: () => {},
      fatal: () => {},
      info: (...args: unknown[]) => { calls.push(args); },
    } as any,
    proxyFactory: (() => (_req: unknown, _res: unknown, next: () => void) => next()) as any,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.[0], {
    clerkFapiHost: "frontend-api.clerk.dev",
    publishableKeyHost: "clerk.app.example.com",
    publishableKeyPrefix: "pk_live",
    secretKeyPrefix: "sk_live",
  });
  assert.equal(getClerkKeyPrefix("invalid"), "unknown");
});

test("production proxy logs a full upstream exception and returns a short reason", () => {
  const exception = new Error("upstream exploded");
  const calls: unknown[][] = [];
  const handler = clerkProxyMiddleware({
    env: {
      NODE_ENV: "production",
      CLERK_PUBLISHABLE_KEY: publishableKey("pk_live", "clerk.app.example.com"),
      CLERK_SECRET_KEY: "sk_live_secret",
    },
    log: {
      error: (...args: unknown[]) => { calls.push(args); },
      fatal: () => {},
      info: () => {},
    } as any,
    proxyFactory: (() => () => { throw exception; }) as any,
  });
  let status = 0;
  let body = "";
  const response = {
    headersSent: false,
    status(value: number) { status = value; return this; },
    type() { return this; },
    send(value: string) { body = value; return this; },
  };
  handler(
    {
      originalUrl: "/api/__clerk/v1/client",
      url: "/v1/client",
    } as any,
    response as any,
    () => assert.fail("proxy failures must not continue to application middleware"),
  );
  assert.equal(status, 502);
  assert.equal(body, "Clerk upstream request failed");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.[0], {
    requestPath: "/api/__clerk/v1/client",
    upstreamUrl: "https://frontend-api.clerk.dev/v1/client",
    upstreamStatus: null,
    upstreamResponseHeaders: null,
    err: exception,
  });
});

test("production proxy preserves an upstream failure status and logs response headers", () => {
  const calls: unknown[][] = [];
  const handler = clerkProxyMiddleware({
    env: {
      NODE_ENV: "production",
      CLERK_PUBLISHABLE_KEY: publishableKey("pk_live", "clerk.app.example.com"),
      CLERK_SECRET_KEY: "sk_live_secret",
    },
    log: {
      error: (...args: unknown[]) => { calls.push(args); },
      fatal: () => {},
      info: () => {},
    } as any,
    proxyFactory: ((options: any) => (req: unknown, res: unknown) => {
      const upstream = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string | string[]>;
      };
      upstream.statusCode = 503;
      upstream.headers = {
        "retry-after": "5",
        "set-cookie": ["sensitive-cookie"],
      };
      options.on.proxyRes(upstream, req, res);
      upstream.end();
    }) as any,
  });
  let status = 0;
  let body = "";
  const response = {
    headersSent: false,
    status(value: number) { status = value; return this; },
    type() { return this; },
    send(value: string) { body = value; return this; },
  };
  handler(
    {
      originalUrl: "/api/__clerk/v1/environment",
      url: "/v1/environment",
    } as any,
    response as any,
    () => assert.fail("upstream failures must not continue to application middleware"),
  );
  assert.equal(status, 503);
  assert.equal(body, "Clerk upstream request failed");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.[0], {
    requestPath: "/api/__clerk/v1/environment",
    upstreamUrl: "https://frontend-api.clerk.dev/v1/environment",
    upstreamStatus: 503,
    upstreamResponseHeaders: {
      "retry-after": "5",
      "set-cookie": "[redacted]",
    },
    err: new Error("Clerk upstream returned HTTP 503"),
  });
});

test("Clerk health probes the proxy upstream and caches the result", async () => {
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
  assert.deepEqual(requested, [CLERK_FAPI]);

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