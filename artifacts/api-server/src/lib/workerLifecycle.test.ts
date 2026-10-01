import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import test from "node:test";
import { trackWorkerLifecycle } from "./workerLifecycle";

const fixture = `
const { parentPort } = require('node:worker_threads');
const timer = setInterval(() => {}, 1000);
parentPort.on('message', ({type}) => {
  if (type === 'shutdown') { clearInterval(timer); parentPort.close(); }
});`;

test("shutdown resolves after an already-observed unexpected worker exit", async () => {
  const worker = new Worker(fixture, { eval: true });
  const lifecycle = trackWorkerLifecycle(worker);
  await worker.terminate();
  await lifecycle.shutdown();
});

test("worker exit while public requests drain cannot strand shutdown", async () => {
  const worker = new Worker(fixture, { eval: true });
  const lifecycle = trackWorkerLifecycle(worker);
  await worker.terminate();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await lifecycle.shutdown();
});

test("normal shutdown asks a live worker to close and waits for exit", async () => {
  const worker = new Worker(fixture, { eval: true });
  const lifecycle = trackWorkerLifecycle(worker);
  let exited = false;
  worker.once("exit", () => { exited = true; });
  await lifecycle.shutdown();
  assert.equal(exited, true);
});