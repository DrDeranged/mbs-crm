import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Script, createContext } from "node:vm";
import { notificationClickAction, recoverFromStaleServiceWorker, SERVICE_WORKER_VERSION, watchForInstalledUpdate } from "./serviceWorkerUpdate.ts";

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

test("service worker keeps API fetches network-only and deletes caches outside its version allowlist", async () => {
  const source = await readFile(resolve(import.meta.dirname, "../../public/sw.js"), "utf8");
  assert.equal(source.includes("url.pathname.startsWith('/api/')"), true);
  assert.equal(source.includes("url.pathname === '/api'"), true);
  assert.equal(source.includes("const CACHE_ALLOWLIST = new Set([CACHE_NAME])"), true);
  assert.equal(source.includes(".filter((name) => !CACHE_ALLOWLIST.has(name))"), true);
  assert.equal(source.includes("self.skipWaiting()"), true);
  assert.equal(source.includes(".then(() => self.clients.claim())"), true);
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

test("stale worker recovery unregisters every worker, clears every cache, and reloads only once", async () => {
  const originalNavigator = globalThis.navigator;
  const originalWindow = (globalThis as any).window;
  const originalSessionStorage = (globalThis as any).sessionStorage;
  const originalCaches = (globalThis as any).caches;
  let reloads = 0;
  let unregistered = 0;
  const deletedCaches: string[] = [];
  const session = new Map<string, string>();
  const unknown = { scriptURL: "https://crm.test/sw.js?v=old" };
  const current = { scriptURL: `https://crm.test/sw.js?v=${SERVICE_WORKER_VERSION}` };
  const registrations = [
    { active: unknown, waiting: null, installing: null, unregister: async () => { unregistered++; } },
    { active: current, waiting: null, installing: null, unregister: async () => { unregistered++; } },
  ];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serviceWorker: {
        controller: unknown,
        getRegistrations: async () => registrations,
      },
    },
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => session.set(key, value),
    },
  });
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      keys: async () => ["mbs-crm-v1", "unrelated-cache"],
      delete: async (name: string) => { deletedCaches.push(name); return true; },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { reload: () => { reloads++; } } },
  });
  assert.equal(await recoverFromStaleServiceWorker(), true);
  assert.equal(unregistered, 2);
  assert.deepEqual(deletedCaches, ["mbs-crm-v1", "unrelated-cache"]);
  assert.equal(reloads, 1);
  assert.equal(await recoverFromStaleServiceWorker(), false);
  assert.equal(unregistered, 4);
  assert.equal(reloads, 1);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: originalSessionStorage });
  Object.defineProperty(globalThis, "caches", { configurable: true, value: originalCaches });
});

test("current version registrations do not trigger recovery", async () => {
  const originalNavigator = globalThis.navigator;
  const current = { scriptURL: `https://crm.test/sw.js?v=${SERVICE_WORKER_VERSION}` };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serviceWorker: {
        getRegistrations: async () => [
          { active: current, waiting: null, installing: null, unregister: async () => true },
        ],
      },
    },
  });
  assert.equal(await recoverFromStaleServiceWorker(), false);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

test("lookalike and markerless worker versions trigger recovery", async () => {
  const originalNavigator = globalThis.navigator;
  const originalWindow = (globalThis as any).window;
  const originalSessionStorage = (globalThis as any).sessionStorage;
  const originalCaches = (globalThis as any).caches;
  let unregistered = 0;
  for (const scriptURL of [
    "https://crm.test/sw.js",
    `https://crm.test/sw.js?v=${SERVICE_WORKER_VERSION}0`,
    `https://crm.test/sw.js?other=${SERVICE_WORKER_VERSION}`,
  ]) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        serviceWorker: {
          getRegistrations: async () => [{
            active: { scriptURL },
            waiting: null,
            installing: null,
            unregister: async () => { unregistered++; return true; },
          }],
        },
      },
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: { getItem: () => "1", setItem: () => {} },
    });
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: { keys: async () => [], delete: async () => true },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { reload: () => assert.fail("reload guard should suppress reload") } },
    });
    assert.equal(await recoverFromStaleServiceWorker(), false);
  }
  assert.equal(unregistered, 3);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: originalSessionStorage });
  Object.defineProperty(globalThis, "caches", { configurable: true, value: originalCaches });
});

test("initial v3 registration does not add a controller-change reload handler", async () => {
  const source = await readFile(resolve(import.meta.dirname, "../hooks/use-pwa.tsx"), "utf8");
  assert.match(source, /const hadControllerBeforeRegistration = Boolean\(navigator\.serviceWorker\.controller\)/);
  assert.match(source, /if \(hadControllerBeforeRegistration\) \{[\s\S]*addEventListener\('controllerchange'/);
});