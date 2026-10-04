import assert from "node:assert/strict";
import test from "node:test";
import { createSidebarHoverController, SIDEBAR_CLOSE_DELAY, SIDEBAR_OPEN_DELAY } from "./sidebarHover.ts";

function fixture() {
  let held = false;
  const changes: boolean[] = [];
  const timers: { callback: () => void; delay: number; cancelled: boolean }[] = [];
  const controller = createSidebarHoverController(open => changes.push(open), () => !held, (callback, delay) => {
    const timer = { callback, delay, cancelled: false };
    timers.push(timer);
    return () => { timer.cancelled = true; };
  });
  return { controller, changes, timers, hold: (next: boolean) => { held = next; } };
}

test("repeated hover events do not restart opening and slow down the sidebar", () => {
  const f = fixture();
  f.controller.request(true);
  f.controller.request(true);
  assert.equal(f.timers.length, 1);
  assert.equal(f.timers[0].delay, SIDEBAR_OPEN_DELAY);
  f.timers[0].callback();
  assert.deepEqual(f.changes, [true]);
});

test("a quick pointer reversal cancels opening; stale callbacks cannot reopen", () => {
  const f = fixture();
  f.controller.request(true);
  f.controller.request(false);
  assert.equal(f.timers[0].cancelled, true);
  f.timers[0].callback();
  assert.deepEqual(f.changes, []);
});

test("re-entry cancels closing without flicker", () => {
  const f = fixture();
  f.controller.setOpen(true);
  f.controller.request(false);
  assert.equal(f.timers[0].delay, SIDEBAR_CLOSE_DELAY);
  f.controller.request(true);
  f.timers[0].callback();
  assert.deepEqual(f.changes, [true]);
});

test("an open portaled layer or pressed pointer blocks both pending and new intents", () => {
  const f = fixture();
  f.controller.setOpen(true);
  f.controller.request(false);
  f.hold(true);
  f.timers[0].callback();
  f.controller.request(false);
  assert.deepEqual(f.changes, [true]);
  assert.equal(f.timers.length, 1);
  f.hold(false);
  f.controller.request(false);
  f.timers[1].callback();
  assert.deepEqual(f.changes, [true, false]);
});

test("press cancellation and explicit keyboard/pin state supersede pending hover", () => {
  const f = fixture();
  f.controller.request(true);
  f.controller.cancel();
  f.timers[0].callback();
  assert.deepEqual(f.changes, []);
  f.controller.setOpen(true);
  f.controller.request(false);
  f.controller.setOpen(false);
  f.timers[1].callback();
  assert.deepEqual(f.changes, [true, false]);
});

test("unpin reconciliation closes retained hover state after leaving while pinned", () => {
  const f = fixture();
  f.controller.setOpen(true);
  f.hold(true);
  f.controller.cancel(); // Pin transition.
  f.controller.request(false); // Pointer left while pinned; closing is blocked.
  assert.equal(f.timers.length, 0);
  f.hold(false);
  f.controller.cancel();
  f.controller.request(false); // Unpin must re-evaluate the previously blocked intent.
  f.timers[0].callback();
  assert.deepEqual(f.changes, [true, false]);
});

test("unpin reconciliation preserves owned keyboard focus until blur", () => {
  const f = fixture();
  f.hold(true);
  f.controller.setOpen(true); // Keyboard focus records ownership even while pinned.
  f.controller.cancel();
  f.controller.request(false); // Unpinned, but keyboard focus still owns the sidebar.
  assert.equal(f.timers.length, 0);
  assert.deepEqual(f.changes, [true]);
  f.hold(false);
  f.controller.request(false); // Focus moved into main content.
  f.timers[0].callback();
  assert.deepEqual(f.changes, [true, false]);
});