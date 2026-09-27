import assert from "node:assert/strict";
import { test } from "node:test";
import { isChunkLoadError, reloadOnceForChunkError } from "./chunkRecovery.ts";

test("failed lazy route import reloads at most once per build in a browser session", () => {
  const flags = new Map<string, string>();
  const storage = {
    getItem: (key: string) => flags.get(key) ?? null,
    setItem: (key: string, value: string) => { flags.set(key, value); },
  };
  let reloads = 0;
  const failedImport = new TypeError("Failed to fetch dynamically imported module: /assets/deals-old.js");
  const retry = (build: string) => reloadOnceForChunkError(failedImport, build, storage, () => { reloads++; });
  assert.equal(retry("build-a"), true);
  assert.equal(retry("build-a"), false);
  assert.equal(retry("build-b"), true);
  assert.equal(reloads, 2);
  assert.equal(isChunkLoadError(new Error("Other render error")), false);
  assert.equal(reloadOnceForChunkError(new Error("Other render error"), "build-a", storage, () => { reloads++; }), false);
});

test("blocked session storage prevents an unbounded reload loop", () => {
  const unavailable = { getItem: () => { throw new Error("blocked"); }, setItem: () => {} };
  let reloads = 0;
  assert.equal(reloadOnceForChunkError("ChunkLoadError", "build", unavailable, () => { reloads++; }), false);
  assert.equal(reloads, 0);
});