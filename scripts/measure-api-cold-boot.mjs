import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

const entry = resolve(process.argv[2] || "artifacts/api-server/dist/index.mjs");
const label = process.argv[3] || "candidate";
const port = Number(process.env.COLD_BOOT_PORT || 24321);
const started = performance.now();
const child = spawn(process.execPath, ["--enable-source-maps", entry], {
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "production",
    DISABLE_BACKGROUND_JOBS: "true",
    MIGRATE_ON_BOOT: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let first200Ms = null;
let listenerMs = null;
let applicationReadyMs = null;
let maxProbeMs = 0;
let successfulProbes = 0;
let failedProbes = 0;
let failedAfterFirst200 = 0;
let output = "";
let exited = false;
child.once("exit", () => { exited = true; });
child.stdout.on("data", (buffer) => {
  output += buffer.toString();
  if (listenerMs === null && output.includes('"event":"api_startup_listener_ready"')) {
    listenerMs = performance.now() - started;
  }
  if (applicationReadyMs === null && output.includes('"event":"api_application_ready"')) {
    applicationReadyMs = performance.now() - started;
  }
});
child.stderr.on("data", (buffer) => { output += buffer.toString(); });
try {
  const deadline = started + 90_000;
  let readyProbes = 0;
  while (!exited && performance.now() < deadline) {
    const probeStarted = performance.now();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api`, {
        signal: AbortSignal.timeout(300),
      });
      await response.text();
      maxProbeMs = Math.max(maxProbeMs, performance.now() - probeStarted);
      if (response.status === 200) {
        first200Ms ??= performance.now() - started;
        successfulProbes++;
      } else {
        failedProbes++;
        if (first200Ms !== null) failedAfterFirst200++;
      }
    } catch {
      maxProbeMs = Math.max(maxProbeMs, performance.now() - probeStarted);
      failedProbes++;
      if (first200Ms !== null) failedAfterFirst200++;
    }
    if (applicationReadyMs !== null && ++readyProbes >= 5) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  console.log(JSON.stringify({
    label, entry,
    first200Ms: first200Ms === null ? null : Math.round(first200Ms),
    listenerMs: listenerMs === null ? null : Math.round(listenerMs),
    applicationReadyMs: applicationReadyMs === null ? null : Math.round(applicationReadyMs),
    maxProbeMs: Math.round(maxProbeMs),
    successfulProbes, failedProbes, failedAfterFirst200,
  }, null, 2));
  if (first200Ms === null || applicationReadyMs === null) {
    console.error(output.slice(-5000));
    process.exitCode = 1;
  }
} finally {
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 16_000);
  if (!exited) await new Promise((resolve) => child.once("exit", resolve));
  clearTimeout(timer);
}