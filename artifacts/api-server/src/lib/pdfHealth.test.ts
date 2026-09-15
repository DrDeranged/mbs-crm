import test from "node:test";
import assert from "node:assert/strict";
import { createPdfHealthProbe } from "./pdfHealth";

test("native PDF is healthy without Chromium; failed launches are cached for ten minutes", async () => {
  let time = 1;
  let launches = 0;
  const probe = createPdfHealthProbe({
    now: () => time,
    loadBrowser: async () => ({ launch: async () => {
      launches++;
      throw new Error("Could not find Chrome at /private/path");
    } }),
  });
  const values = await Promise.all([probe(), probe()]);
  assert.deepEqual(values[0], { nativeRenderer: "ok", puppeteer: "unavailable:Chromium executable not found" });
  assert.equal(launches, 1);
  time += 599_999;
  await probe();
  assert.equal(launches, 1);
  time += 2;
  await probe();
  assert.equal(launches, 2);
});

test("successful probe closes browser and uses bounded launch options", async () => {
  let closed = false;
  const probe = createPdfHealthProbe({ loadBrowser: async () => ({ launch: async (options) => {
    assert.equal(options.timeout, 5_000);
    return { close: async () => { closed = true; } };
  } }) });
  assert.equal((await probe()).puppeteer, "ok");
  assert.equal(closed, true);
});

test("probe times out and still closes a late browser", async () => {
  let closed = false;
  const probe = createPdfHealthProbe({
    timeoutMs: 5,
    loadBrowser: async () => ({ launch: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { close: async () => { closed = true; } };
    } }),
  });
  assert.match((await probe()).puppeteer, /timed out/);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(closed, true);
});