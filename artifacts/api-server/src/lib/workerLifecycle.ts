import type { Worker } from "node:worker_threads";

/** Subscribe at creation, not shutdown: exit is a one-time event. */
export function trackWorkerLifecycle(worker: Worker): { shutdown: () => Promise<void> } {
  let exited = false;
  const done = new Promise<void>((resolve) => {
    worker.once("exit", () => {
      exited = true;
      resolve();
    });
  });
  return {
    shutdown: () => {
      if (!exited) worker.postMessage({ type: "shutdown" });
      return done;
    },
  };
}