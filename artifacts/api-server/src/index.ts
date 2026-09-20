import { createServer } from "node:http";
import { createStartupGate } from "./lib/startupGate";

const rawPort = process.env["PORT"];
if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const startupGate = createStartupGate();
const server = createServer(startupGate.handler);
let stopBackgroundJobs: (() => void) | null = null;
let disposeRuntime: (() => Promise<void>) | null = null;
let shuttingDown = false;
let initialization: Promise<void> | null = null;

server.once("error", (error) => {
  console.error(JSON.stringify({
    level: "fatal",
    event: "api_listen_failed",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exit(1);
});

server.listen(port, () => {
  console.info(JSON.stringify({
    level: "info",
    event: "api_startup_listener_ready",
    port,
  }));

  initialization = import("./runtime")
    .then(async ({ initializeRuntime }) => {
      const runtime = await initializeRuntime();
      stopBackgroundJobs = runtime.stopBackgroundJobs;
      disposeRuntime = runtime.dispose;
      if (shuttingDown) {
        return;
      }
      startupGate.activate(runtime.listener);
      console.info(JSON.stringify({
        level: "info",
        event: "api_application_ready",
        port,
      }));
    })
    .catch((error) => {
      startupGate.fail();
      console.error(JSON.stringify({
        level: "fatal",
        event: "api_initialization_failed",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }));

      // The failed gate remains available briefly for diagnostics, then the
      // process exits so the deployment supervisor can restart or roll back
      // instead of leaving a permanently unavailable instance alive.
      setTimeout(() => {
        if (shuttingDown) return;
        server.close(() => process.exit(1));
        setTimeout(() => process.exit(1), 5_000).unref();
      }, 1_000).unref();
    });
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ level: "info", event: "api_shutdown", signal }));

  const forcedExit = setTimeout(() => {
    console.error(JSON.stringify({ level: "fatal", event: "api_forced_exit" }));
    process.exit(1);
  }, 15_000).unref();

  // Stop accepting traffic before dependencies begin shutting down. Existing
  // requests drain through Node's normal server.close behavior.
  const serverClosed = new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

  await initialization?.catch(() => undefined);
  stopBackgroundJobs?.();
  await serverClosed;
  await disposeRuntime?.();
  clearTimeout(forcedExit);
  console.info(JSON.stringify({ level: "info", event: "api_http_server_closed" }));
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));