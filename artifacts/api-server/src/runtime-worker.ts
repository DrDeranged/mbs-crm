import { createServer } from "node:http";
import { parentPort } from "node:worker_threads";

if (!parentPort) throw new Error("API runtime requires a worker parent");
const parent = parentPort;
let stopping = false;
let stopJobs: (() => void) | undefined;
let dispose: (() => Promise<void>) | undefined;
const server = createServer();
let initialization: Promise<void>;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await initialization.catch(() => undefined);
  stopJobs?.();
  if (server.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await dispose?.();
  parent.postMessage({ type: "stopped" });
  parent.close();
}
parent.on("message", (message: { type: string }) => {
  if (message.type === "shutdown") void stop();
});

initialization = import("./runtime").then(async ({ initializeRuntime }) => {
  const runtime = await initializeRuntime();
  stopJobs = runtime.stopBackgroundJobs;
  dispose = runtime.dispose;
  if (stopping) return;
  server.on("request", runtime.listener);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Runtime has no HTTP port");
  parent.postMessage({ type: "ready", port: address.port });
}).catch((error) => {
  parent.postMessage({
    type: "failed",
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});