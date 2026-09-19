import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  assert.equal(source.includes("event.respondWith(fetch(event.request))"), true);
  assert.equal(source.includes("name.startsWith(CACHE_PREFIX)"), true);
  assert.equal(source.includes("caches.delete(name).filter"), false);
});