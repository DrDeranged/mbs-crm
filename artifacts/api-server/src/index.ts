import { createServer } from "node:http";
import { Worker } from "node:worker_threads";
import { createStartupGate } from "./lib/startupGate";
import { createRuntimeProxy } from "./lib/runtimeProxy";
import { trackWorkerLifecycle } from "./lib/workerLifecycle";

const port = Number(process.env["PORT"]);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
const gate = createStartupGate();
const server = createServer(gate.handler);
let worker: Worker | undefined;
let lifecycle: ReturnType<typeof trackWorkerLifecycle> | undefined;
let shuttingDown = false;
let failureScheduled = false;

function fail(error: string, stack?: string): void {
  if (shuttingDown || failureScheduled) return;
  failureScheduled = true;
  gate.fail();
  console.error(JSON.stringify({ level: "fatal", event: "api_initialization_failed", error, stack }));
  // Leave diagnostic endpoints briefly reachable, then let the supervisor
  // restart. Never accept business traffic when initialization failed.
  setTimeout(() => void shutdown("initialization_failed", 1), 1000).unref();
}

server.once("error", (error) => {
  console.error(JSON.stringify({ level: "fatal", event: "api_listen_failed", error: error.message }));
  process.exit(1);
});
server.listen(port, "0.0.0.0", () => {
  console.info(JSON.stringify({ level: "info", event: "api_startup_listener_ready", port }));
  // The parent imports no application/DB/configuration graph. Parsing and
  // evaluating that graph in another isolate cannot stall liveness requests.
  worker = new Worker(new URL("./runtime-worker.mjs", import.meta.url));
  lifecycle = trackWorkerLifecycle(worker);
  worker.on("message", (message: { type: string; port?: number; error?: string; stack?: string }) => {
    if (message.type === "ready" && !shuttingDown && message.port) {
      gate.activate(createRuntimeProxy(message.port));
      console.info(JSON.stringify({ level: "info", event: "api_application_ready", port }));
    } else if (message.type === "failed") {
      fail(message.error ?? "Runtime initialization failed", message.stack);
    }
  });
  worker.on("error", (error) => {
    fail(error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack : undefined);
  });
  worker.on("exit", (code) => {
    if (!shuttingDown) fail(`Runtime worker exited unexpectedly (${code})`);
  });
});

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ level: "info", event: "api_shutdown", signal }));
  const forcedExit = setTimeout(() => process.exit(1), 15_000).unref();
  // Drain the public proxy before disposing the worker's dependencies.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await lifecycle?.shutdown();
  clearTimeout(forcedExit);
  process.exit(exitCode);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));