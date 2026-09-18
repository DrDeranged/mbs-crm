import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const apiPort = Number(process.env.SMOKE_API_PORT ?? 4311);
const port = Number(process.env.SMOKE_PORT ?? 4310);
const webRoot = join(root, "artifacts/mbs-crm/dist/public");
const baseDatabaseUrl = process.env.DATABASE_URL;

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

if (!baseDatabaseUrl) throw new Error("DATABASE_URL is required for built-app smoke");
const buildEnv = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
  BASE_PATH: "/",
};
run("pnpm", ["--filter", "@workspace/api-server", "run", "build"], buildEnv);
run("pnpm", ["--filter", "@workspace/mbs-crm", "run", "build"], buildEnv);

const smokeDatabaseName = `migration_rehearsal_smoke_${process.pid}_${Date.now()}`;
const smokeDatabaseUrl = new URL(baseDatabaseUrl);
smokeDatabaseUrl.pathname = `/${smokeDatabaseName}`;
let smokeDatabaseDropped = false;
function dropSmokeDatabase(): void {
  if (smokeDatabaseDropped) return;
  smokeDatabaseDropped = true;
  run(
    "dropdb",
    ["--if-exists", "--force", `--maintenance-db=${baseDatabaseUrl}`, smokeDatabaseName],
    process.env,
  );
}
run("createdb", [`--maintenance-db=${baseDatabaseUrl}`, smokeDatabaseName], process.env);
try {
  run("psql", [
    `--dbname=${smokeDatabaseUrl.toString()}`,
    "--set=ON_ERROR_STOP=on",
    `--file=${join(root, "lib/db/schema-ci-baseline/000_pre_runner_schema.sql")}`,
  ], process.env);
  run(
    "pnpm",
    ["--filter", "@workspace/scripts", "exec", "tsx", "../lib/db/src/migrationRehearsalRunner.ts"],
    {
      ...process.env,
      MIGRATION_REHEARSAL_DATABASE_URL: smokeDatabaseUrl.toString(),
    },
  );
  run("psql", [
    `--dbname=${smokeDatabaseUrl.toString()}`,
    "--set=ON_ERROR_STOP=on",
    "--command=INSERT INTO users (clerk_id, name, email, role, is_active, slug) VALUES ('smoke_nate', 'Nate', 'smoke-nate@example.invalid', 'rep', true, 'nate');",
  ], process.env);
} catch (error) {
  dropSmokeDatabase();
  throw error;
}

const api = spawn("node", ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(apiPort),
    DISABLE_BACKGROUND_JOBS: "true",
    MIGRATE_ON_BOOT: "false",
    DATABASE_URL: smokeDatabaseUrl.toString(),
  },
  stdio: "inherit",
});

let stopping = false;
api.once("exit", (code, signal) => {
  if (stopping) return;
  if (code !== null && code !== 0) {
    console.error(`Built API exited before smoke tests (${code})`);
    void shutdown(code);
    return;
  }
  if (signal) {
    console.error(`Built API exited before smoke tests (${signal})`);
    void shutdown(1);
  }
});

async function waitForApi(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/healthz`);
      if (response.ok) return;
    } catch {
      // The built server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Built API did not become healthy within 60 seconds");
}

function proxy(req: IncomingMessage, res: ServerResponse) {
  const upstream = httpRequest(
    {
      hostname: "127.0.0.1",
      port: apiPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${apiPort}`,
        "x-forwarded-host": `127.0.0.1:${port}`,
        "x-forwarded-proto": "http",
      },
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on("error", (error) => {
    res.statusCode = 502;
    res.end(String(error));
  });
  req.pipe(upstream);
}

const server = createServer((req, res) => {
  if (req.url?.startsWith("/api/")) return proxy(req, res);
  const requested = decodeURIComponent(req.url?.split("?")[0] ?? "/");
  const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
  const candidate = normalize(join(webRoot, relative));
  const file = candidate.startsWith(webRoot) && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(webRoot, "index.html");
  const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".woff2": "font/woff2",
  };
  res.setHeader("Content-Type", contentTypes[extname(file)] ?? "application/octet-stream");
  createReadStream(file).on("error", () => { res.statusCode = 404; res.end(); }).pipe(res);
});

const shutdown = async (exitCode = 0) => {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  api.kill("SIGTERM");
  dropSmokeDatabase();
  process.exit(exitCode);
};
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
process.on("uncaughtException", (error) => {
  console.error(error);
  api.kill("SIGTERM");
  dropSmokeDatabase();
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  api.kill("SIGTERM");
  dropSmokeDatabase();
  process.exit(1);
});
await waitForApi();
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});