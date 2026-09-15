import assert from "node:assert/strict";
import test from "node:test";
import { createNoteSaveController } from "./noteSaveController.ts";

test("Enter followed by blur starts exactly one note mutation", async () => {
  const controller = createNoteSaveController();
  let calls = 0;
  let resolveMutation!: () => void;
  const mutation = () => {
    calls++;
    return new Promise<void>((resolve) => {
      resolveMutation = resolve;
    });
  };

  assert.equal(controller.save(7, "old", "new", mutation), true);
  assert.equal(controller.save(7, "old", "new", mutation), false);
  assert.equal(calls, 1);
  resolveMutation();
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test("unchanged note starts no mutation", () => {
  const controller = createNoteSaveController();
  let calls = 0;
  assert.equal(controller.save(7, "same", "same", async () => calls++), false);
  assert.equal(calls, 0);
});