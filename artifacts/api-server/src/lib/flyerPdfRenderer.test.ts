import assert from "node:assert/strict";
import test from "node:test";
import {
  createFlyerPdfRenderer,
  FLYER_RENDER_CONCURRENCY,
  FLYER_RENDER_TIMEOUT_MS,
  FlyerRenderTimeoutError,
} from "./flyerPdfRenderer";

test("production flyer renderer defaults are pinned to two concurrent renders and 30 seconds", () => {
  assert.equal(FLYER_RENDER_CONCURRENCY, 2);
  assert.equal(FLYER_RENDER_TIMEOUT_MS, 30_000);
});

test("flyer rendering keeps five queued requests at a maximum concurrency of two", async () => {
  let active = 0;
  let maximum = 0;
  const render = createFlyerPdfRenderer(async (html) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 8));
    active -= 1;
    return Buffer.from(html);
  });

  const results = await Promise.all(["1", "2", "3", "4", "5"].map(render));
  assert.equal(maximum, 2);
  assert.deepEqual(results.map(String), ["1", "2", "3", "4", "5"]);
});

test("a flyer render timeout is represented as a 503 error and retains its active slot", async () => {
  let releaseFirst: (() => void) | undefined;
  let startedSecond = false;
  const render = createFlyerPdfRenderer(
    async (html) => {
      if (html === "first") await new Promise<void>((resolve) => { releaseFirst = resolve; });
      else startedSecond = true;
      return Buffer.from(html);
    },
    { concurrency: 1, timeoutMs: 20 },
  );

  await assert.rejects(render("first"), (error: unknown) =>
    error instanceof FlyerRenderTimeoutError && error.status === 503,
  );
  const second = render("second");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(startedSecond, false, "a timed-out Chromium render still occupies its only slot");
  releaseFirst?.();
  assert.equal(String(await second), "second");
});

test("five callers receive 503 by their enqueue deadline when the two active renders never settle", async () => {
  let active = 0;
  let maximum = 0;
  const render = createFlyerPdfRenderer(
    async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>(() => {});
      return Buffer.from("%PDF-unreachable");
    },
    { concurrency: 2, timeoutMs: 8 },
  );

  const results = await Promise.allSettled(["1", "2", "3", "4", "5"].map(render));
  assert.equal(maximum, 2);
  assert.equal(results.length, 5);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.ok(result.reason instanceof FlyerRenderTimeoutError);
      assert.equal(result.reason.status, 503);
    }
  }
});

test("flyer renderer refuses a configuration above the two-render safety cap", () => {
  assert.throws(
    () => createFlyerPdfRenderer(async () => Buffer.from("%PDF"), { concurrency: 3 }),
    /between one and two/,
  );
});