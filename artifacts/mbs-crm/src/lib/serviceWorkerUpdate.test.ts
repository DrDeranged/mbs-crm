import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { notificationClickAction, watchForInstalledUpdate } from "./serviceWorkerUpdate.ts";

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
  assert.equal(source.includes("fetch(event.request).catch(() => unavailableResponse())"), true);
  assert.equal(source.includes("name.startsWith(CACHE_PREFIX)"), true);
  assert.equal(source.includes("caches.delete(name).filter"), false);
  assert.equal(source.includes("self.addEventListener('push'"), true);
  assert.equal(source.includes("self.addEventListener('notificationclick'"), true);
});

async function createWorker(fetchImpl: (request: any, init?: any) => Promise<Response>) {
  const source = await readFile(resolve(import.meta.dirname, "../../public/sw.js"), "utf8");
  const listeners = new Map<string, (event: any) => void>();
  const entries = new Map<string, Response>();
  const origin = "https://crm.test";
  const cache = {
    addAll: async (requests: Request[]) => {
      for (const request of requests) entries.set(request.url, new Response("offline page"));
    },
    put: async (request: Request | string, response: Response) => {
      const key = typeof request === "string" ? new URL(request, origin).href : request.url;
      entries.set(key, response.clone());
    },
    delete: async (request: Request | string) => {
      const key = typeof request === "string" ? new URL(request, origin).href : request.url;
      return entries.delete(key);
    },
  };
  const caches = {
    open: async () => cache,
    match: async (request: Request | string) => {
      const key = typeof request === "string" ? new URL(request, origin).href : request.url;
      return entries.get(key)?.clone();
    },
    keys: async () => ["mbs-crm-v1"],
    delete: async () => true,
  };
  class WorkerRequest extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, origin) : input, init);
    }
  }
  const self = {
    location: { origin, href: `${origin}/sw.js` },
    clients: { claim: () => Promise.resolve() },
    registration: { scope: `${origin}/` },
    addEventListener: (type: string, callback: (event: any) => void) => listeners.set(type, callback),
  };
  runInNewContext(source, {
    self,
    caches,
    fetch: fetchImpl,
    Request: WorkerRequest,
    Response,
    URL,
    Promise,
  });
  return {
    entries,
    async fetch(request: Request | { url: string; method: string; mode?: string }) {
      let responsePromise: Promise<Response> | undefined;
      listeners.get("fetch")?.({ request, respondWith: (response: Promise<Response>) => { responsePromise = response; } });
      assert.ok(responsePromise, "fetch handler should call respondWith");
      return responsePromise!;
    },
  };
}

test("navigation and entry bundle bypass HTTP cache; offline navigation prefers cached shell then offline page", async () => {
  const fetchCalls: Array<{ request: any; init?: any }> = [];
  let networkOnline = true;
  const worker = await createWorker(async (request, init) => {
    fetchCalls.push({ request, init });
    if (!networkOnline) throw new Error("offline");
    return new Response("fresh app shell");
  });
  worker.entries.set("https://crm.test/offline.html", new Response("offline page"));
  const route = { url: "https://crm.test/leads/42", method: "GET", mode: "navigate" };
  const onlineResponse = await worker.fetch(route);
  assert.equal(await onlineResponse.text(), "fresh app shell");
  assert.equal(fetchCalls[0].init?.cache, "no-store");

  networkOnline = false;
  const cachedShellResponse = await worker.fetch(route);
  assert.equal(cachedShellResponse instanceof Response, true);
  assert.equal(await cachedShellResponse.text(), "fresh app shell");
  worker.entries.delete("https://crm.test/index.html");
  const offlineResponse = await worker.fetch(route);
  assert.equal(offlineResponse instanceof Response, true);
  assert.equal(await offlineResponse.text(), "offline page");
});

test("entry bundle is network-first with no-store even when an old entry is cached", async () => {
  let requestedCacheMode: string | undefined;
  const worker = await createWorker(async (_request, init) => {
    requestedCacheMode = init?.cache;
    return new Response("current bundle");
  });
  const bundle = new Request("https://crm.test/assets/index-oldhash123.js");
  await worker.entries.set(bundle.url, new Response("stale bundle"));
  const response = await worker.fetch(bundle);
  assert.equal(requestedCacheMode, "no-store");
  assert.equal(await response.text(), "current bundle");
});

test("hashed assets are cache-first and failed uncached assets still resolve to a Response", async () => {
  let networkCalls = 0;
  const worker = await createWorker(async () => {
    networkCalls++;
    throw new Error("offline");
  });
  const cachedAsset = new Request("https://crm.test/assets/chunk-AbCdEf123.js");
  await worker.entries.set(cachedAsset.url, new Response("cached chunk"));
  const cachedResponse = await worker.fetch(cachedAsset);
  assert.equal(await cachedResponse.text(), "cached chunk");
  assert.equal(networkCalls, 0);

  const missingAssetResponse = await worker.fetch(new Request("https://crm.test/assets/chunk-ZyXwVu987.js"));
  assert.equal(missingAssetResponse instanceof Response, true);
  assert.equal(missingAssetResponse.status, 503);
  assert.equal(networkCalls, 1);
});

test("HTML fallbacks for hashed JS and CSS assets return 503 and are never cached", async () => {
  const worker = await createWorker(async (request) => {
    const url = new URL(request.url);
    if (url.pathname.includes("removed")) {
      return new Response("<html>Not found</html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    const isCss = url.pathname.endsWith(".css");
    return new Response(isCss ? "body { color: red; }" : "export const ready = true;", {
      status: 200,
      headers: { "Content-Type": isCss ? "text/css" : "application/javascript" },
    });
  });

  for (const assetUrl of [
    "https://crm.test/assets/removed-AbCdEf123.js",
    "https://crm.test/assets/removed-ZyXwVu987.css",
  ]) {
    const response = await worker.fetch(new Request(assetUrl));
    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type") || "", /^text\/plain/i);
    assert.equal(await response.text(), "This resource is unavailable while offline.");
    assert.equal(worker.entries.has(assetUrl), false);
  }

  for (const [assetUrl, expectedBody] of [
    ["https://crm.test/assets/chunk-GgHhIi123.js", "export const ready = true;"],
    ["https://crm.test/assets/theme-JjKkLl456.css", "body { color: red; }"],
  ]) {
    const response = await worker.fetch(new Request(assetUrl));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), expectedBody);
    assert.equal(worker.entries.has(assetUrl), true);
  }
});

test("API and other network-only failures resolve to Responses rather than rejected fetch events", async () => {
  const worker = await createWorker(async () => { throw new Error("offline"); });
  const apiResponse = await worker.fetch(new Request("https://crm.test/api/leads"));
  const staticResponse = await worker.fetch(new Request("https://crm.test/favicon.ico"));
  assert.equal(apiResponse instanceof Response, true);
  assert.equal(staticResponse instanceof Response, true);
  assert.equal(apiResponse.status, 503);
  assert.equal(staticResponse.status, 503);
});
