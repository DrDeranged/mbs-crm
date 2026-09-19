import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Script, createContext } from "node:vm";
import { notificationClickAction, removeStaleServiceWorkers, SERVICE_WORKER_VERSION, watchForInstalledUpdate } from "./serviceWorkerUpdate.ts";

test("new service worker update is announced only after installed with an existing controller", () => {
  let listener: (() => void) | undefined;
  let worker = {
    state: "installing",
    addEventListener: (_type: "statechange", callback: () => void) => { listener = callback; },
  };
  let updates = 0;
  watchForInstalledUpdate(worker, () => false, () => updates++);
  worker.state = "installed";
  listener?.();
  assert.equal(updates, 0);
  watchForInstalledUpdate(worker, () => true, () => updates++);
  listener?.();
  assert.equal(updates, 1);
});

test("notification click focuses a matching client, otherwise opens the exact deep link", () => {
  const focused = { url: "https://crm.test/leads/42", focus: () => {} };
  assert.deepEqual(notificationClickAction([focused], "/leads/42"), { kind: "focus", client: focused });
  assert.deepEqual(notificationClickAction([], "/leads/42"), { kind: "open", url: "/leads/42" });
});

test("service worker keeps API fetches network-only and cleans only its cache namespace", async () => {
  const source = await readFile(resolve(import.meta.dirname, "../../public/sw.js"), "utf8");
  assert.equal(source.includes("url.pathname.startsWith('/api/')"), true);
  assert.equal(source.includes("url.pathname === '/api'"), true);
  assert.equal(source.includes("name.startsWith(CACHE_PREFIX)"), true);
  assert.equal(source.includes("caches.delete(name).filter"), false);
});

test("service worker bypasses Clerk and API requests and always resolves handled failures to Response", async () => {
  const source = await readFile(resolve(import.meta.dirname, "../../public/sw.js"), "utf8");
  const listeners = new Map<string, (event: any) => void>();
  const context = createContext({
    URL,
    Request,
    Response,
    Promise,
    console,
    fetch: () => Promise.reject(new Error("offline")),
    caches: { match: async () => undefined },
    self: {
      location: { origin: "https://crm.test" },
      addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
    },
  });
  new Script(source).runInContext(context);
  const fetchListener = listeners.get("fetch")!;
  for (const url of [
    "https://crm.test/api",
    "https://crm.test/api/leads",
    "https://crm.test/api/__clerk/session",
    "https://accounts.dev/v1/client",
    "https://cdn.clerk.com/npm/@clerk/shared/index.js",
  ]) {
    let responded = false;
    fetchListener({
      request: new Request(url),
      respondWith: () => { responded = true; },
    });
    assert.equal(responded, false, `should bypass ${url}`);
  }
  let responsePromise: Promise<Response> | undefined;
  fetchListener({
    request: new Request("https://crm.test/static/app.js"),
    respondWith: (promise: Promise<Response>) => { responsePromise = promise; },
  });
  const response = await responsePromise;
  assert.equal(response instanceof Response, true);
  assert.equal(response?.type, "error");
});

test("stale worker kill switch unregisters unknown versions and reloads only once", async () => {
  const originalNavigator = globalThis.navigator;
  const originalWindow = (globalThis as any).window;
  const originalSessionStorage = (globalThis as any).sessionStorage;
  let reloads = 0;
  let unregistered = 0;
  const unknown = { scriptURL: "https://crm.test/sw.js?v=old" };
  const current = { scriptURL: `https://crm.test/sw.js?v=${SERVICE_WORKER_VERSION}` };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serviceWorker: {
        controller: unknown,
        getRegistrations: async () => [
          { active: unknown, waiting: null, installing: null, unregister: async () => { unregistered++; } },
          { active: current, waiting: null, installing: null, unregister: async () => { unregistered++; } },
        ],
      },
    },
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { reload: () => { reloads++; } } },
  });
  await removeStaleServiceWorkers();
  assert.equal(unregistered, 1);
  assert.equal(reloads, 1);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: originalSessionStorage });
});