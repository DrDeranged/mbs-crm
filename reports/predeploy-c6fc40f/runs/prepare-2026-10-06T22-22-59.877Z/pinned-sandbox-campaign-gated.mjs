import { createServer, request } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const root = "/tmp/predeploy-c6fc40f-source";
const require = createRequire(join(root, "artifacts/api-server/package.json"));
const { clerkClient } = require("@clerk/express");
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "pipe" });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr?.toString().slice(-1200)}`);
}

export async function startSandbox({ build = true, webRoot, staffNames, port = Number(process.env.VISUAL_SANDBOX_PORT ?? 4320) } = {}) {
  if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) throw new Error("Test Clerk credentials required.");
  if (!process.env.DATABASE_URL) throw new Error("Development database required.");
  const publicRoot = webRoot ?? join(root, "artifacts/mbs-crm/dist/public");
  if (!build && !existsSync(join(publicRoot, "index.html"))) {
    throw new Error("Frozen web build is unavailable. Rebuild it from the recorded baseline revision before collecting evidence.");
  }
  const databaseName = `visual_refresh_fixture_${process.pid}_${Date.now()}`;
  const databaseUrl = new URL(process.env.DATABASE_URL);
  databaseUrl.pathname = `/${databaseName}`;
  const directory = await mkdtemp(join(tmpdir(), "mbs-visual-"));
  const users = [];
  let api, server, databaseCreated = false;
  const cleanup = { clerkUsersDeleted: 0, databaseDropped: false, tempDirectoryRemoved: false };
  async function close() {
    const cleanupErrors = [];
    if (server) await new Promise(resolve => server.close(error => { if (error) cleanupErrors.push(error); resolve(); }));
    if (api) {
      api.kill("SIGTERM");
      await Promise.race([new Promise(resolve => api.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
      if (api.exitCode === null) api.kill("SIGKILL");
    }
    for (const user of users) {
      try {
        await clerkClient.users.deleteUser(user.id);
        cleanup.clerkUsersDeleted++;
      } catch (error) { cleanupErrors.push(error); }
    }
    try {
      if (databaseCreated) {
        run("dropdb", ["--if-exists", "--force", `--maintenance-db=${process.env.DATABASE_URL}`, databaseName]);
        databaseCreated = false;
        cleanup.databaseDropped = true;
      }
    } catch (error) { cleanupErrors.push(error); }
    try {
      await rm(directory, { recursive: true, force: true });
      cleanup.tempDirectoryRemoved = !existsSync(directory);
    } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length) console.error(`Fixture cleanup had ${cleanupErrors.length} recoverable error(s).`);
  }
  try {
    if (build) {
      const buildEnv = { ...process.env, PORT: String(port), BASE_PATH: "/", NODE_ENV: "production" };
      run("pnpm", ["--filter", "@workspace/api-server", "run", "build"], buildEnv);
      run("pnpm", ["--filter", "@workspace/mbs-crm", "run", "build"], buildEnv);
    }
    run("createdb", [`--maintenance-db=${process.env.DATABASE_URL}`, databaseName]);
    databaseCreated = true;
    const schema = join(directory, "schema.sql");
    run("pg_dump", [`--dbname=${process.env.DATABASE_URL}`, "--schema-only", "--no-owner", "--no-privileges", `--file=${schema}`]);
    run("psql", [`--dbname=${databaseUrl}`, "--set=ON_ERROR_STOP=on", `--file=${schema}`]);
    for (const [index, role] of ["admin", "manager", "rep"].entries()) {
      const displayName = staffNames?.[index] ?? "Visual Fixture";
      const user = await clerkClient.users.createUser({
        firstName: displayName.split(" ")[0], lastName: displayName.split(" ").slice(1).join(" "),
        emailAddress: [`visual-${role}-${Date.now()}@example.com`], skipPasswordRequirement: true,
      });
      users.push(user);
      run("psql", [`--dbname=${databaseUrl}`, "--set=ON_ERROR_STOP=on", "--command",
        `INSERT INTO users(id,clerk_id,name,email,role,is_active,slug) VALUES (${index + 1},'${user.id}','${displayName}','fixture-${role}@example.invalid','${role}',true,'fixture-${role}');`]);
    }
    run("psql", [`--dbname=${databaseUrl}`, "--set=ON_ERROR_STOP=on", "--command", `
      INSERT INTO leads(id,first_name,last_name,email,phone,company_name,application_type,status,assigned_rep_id,requested_amount,credit_score,lead_score,lead_source,created_at,updated_at,last_activity_at)
      VALUES (1,'Synthetic','Contact','contact@example.invalid','+12025550123','Fixture Equipment LLC','equipment','contacted',3,125000,720,82,'manual','2026-09-15','2026-09-15','2026-09-15'),
      (2,'Sample','Applicant','sample@example.invalid','+12025550124','Fixture Services LLC','working_capital','new_lead',3,75000,680,65,'referral','2026-09-15','2026-09-15','2026-09-15');
      INSERT INTO deals(id,lead_id,deal_name,stage,amount,approx_gm,assigned_to,created_at,updated_at)
      VALUES (1,1,'Synthetic equipment financing','waiting_on_app',125000,7500,3,'2026-09-15','2026-09-15'),
      (2,2,'Synthetic working capital','approved',75000,4000,3,'2026-09-15','2026-09-15'),
      (3,1,'Manager-only access fixture','waiting_on_app',125000,7500,2,'2026-09-15','2026-09-15'),
      (4,NULL,'Unlinked deal action fixture','waiting_on_app',50000,3000,2,'2026-09-15','2026-09-15');
      INSERT INTO lenders(name,program_types,min_amount,max_amount,min_credit_score,accepted_industries,min_time_in_business_months,accepted_states,max_existing_positions,priority_weight,is_active,partner_type,submission_method)
      VALUES ('Visual Fixture Match Partner',ARRAY['working_capital','equipment'],1000,1000000,500,ARRAY[]::text[],0,ARRAY[]::text[],10,10,true,'direct_lender','portal');
      INSERT INTO email_templates(name,subject,body_html,program_type,created_by,is_active)
      VALUES ('Visual Refresh Synthetic Template','Synthetic test message','<p>Synthetic fixture content for approval testing.</p>','working_capital',1,true);
      SELECT setval(pg_get_serial_sequence('users','id'),3);
      SELECT setval(pg_get_serial_sequence('leads','id'),2);
      SELECT setval(pg_get_serial_sequence('deals','id'),2);
      SELECT setval(pg_get_serial_sequence('deals','id'),4);
    `]);
    // Keep development authentication only. Remove live delivery, storage,
    // provider and AI credentials from the child; never log their values.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(TWILIO_|SENDGRID_|VAPID_|AI_INTEGRATIONS_|OPENAI_|ANTHROPIC_|SENTRY_|PRIVATE_OBJECT_|PUBLIC_OBJECT_|DEFAULT_OBJECT_|GOOGLE_|GCLOUD_|GCP_)/.test(key)));
    Object.assign(env, {
      DATABASE_URL: databaseUrl.toString(), ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      NODE_ENV: "production", PORT: String(port + 1), DISABLE_BACKGROUND_JOBS: "true", MIGRATE_ON_BOOT: "false",
    });
    Object.assign(env, { VISUAL_FIXTURE_STORAGE_DIR: join(directory, "storage"), DEFAULT_OBJECT_STORAGE_BUCKET_ID: "fixture-bucket" });
    // Pin the compiled API so another verification command cannot replace its
    // lazily imported chunks while this isolated fixture is running.
    const apiSnapshot = join(directory, "api");
    await cp(process.env.PREDEPLOY_FROZEN_API_DIST ?? join(root, "artifacts/api-server/dist"), apiSnapshot, { recursive: true });
    await symlink(join(root, "artifacts/api-server/node_modules"), join(directory, "node_modules"), "dir");
    api = spawn("node", ["--import", "./scripts/visual-refresh/storage-register.mjs", join(apiSnapshot, "index.mjs")], { cwd: root, env, stdio: "ignore" });
    let ready = false;
    for (let attempt = 0; attempt < 240; attempt++) {
      if (api.exitCode !== null) throw new Error("Isolated API exited during startup.");
      try {
        const response = await fetch(`http://127.0.0.1:${port + 1}/api/healthz`);
        if (response.ok && (await response.json()).phase === "ready") { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error("Isolated API startup timed out.");
    server = createServer((req, res) => {
      if (req.url?.startsWith("/api/")) {
        // Defense in depth: never allow a fixture test to trigger live delivery.
        const actionUrl = new URL(req.url, "http://fixture.local");
        const launchPost = /^\/api\/campaigns\/\d+\/launch$/.test(actionUrl.pathname) && req.method === "POST";
        if (/\/twilio\/(?:call|sms)|\/email\/send|\/credit\/pull/.test(actionUrl.pathname) && req.method !== "GET") {
          res.writeHead(403, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "External delivery prohibited by test runner" }));
        }
        if (launchPost) {
          let gate = null, transport = null, provider = null;
          try { gate = JSON.parse(readFileSync(process.env.FOCUSED_LAUNCH_GATE_FILE, "utf8")); } catch {}
          try { transport = JSON.parse(readFileSync(process.env.FOCUSED_SENDGRID_READY_PATH, "utf8")); } catch {}
          try { provider = JSON.parse(readFileSync(process.env.FOCUSED_PROVIDER_READY_PATH, "utf8")); } catch {}
          const allowed = gate?.path === actionUrl.pathname && gate?.remaining > 0
            && transport?.ready === true && transport?.inboundParseSecretUnset === true
            && provider?.ready === true && provider?.status === 202;
          if (!allowed) {
            res.writeHead(403, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Launch is restricted to Campaign 5's synthetic 13-recipient fixture with local 202 transport capture" }));
          }
          gate.remaining--; gate.lastConsumedAt = new Date().toISOString();
          writeFileSync(process.env.FOCUSED_LAUNCH_GATE_FILE, JSON.stringify(gate, null, 2) + String.fromCharCode(10));
        }
        const upstream = request({
          hostname: "127.0.0.1", port: port + 1, path: req.url, method: req.method,
          headers: { ...req.headers, host: `127.0.0.1:${port + 1}`, "x-forwarded-host": `127.0.0.1:${port}`, "x-forwarded-proto": "http" },
        }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
        upstream.on("error", () => { res.writeHead(502); res.end("Isolated API unavailable"); });
        req.pipe(upstream);
        return;
      }
      const relative = decodeURIComponent(req.url?.split("?")[0] ?? "/").replace(/^\/+/, "");
      const candidate = resolve(publicRoot, relative || "index.html");
      const file = candidate.startsWith(publicRoot + "/") && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(publicRoot, "index.html");
      res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" })[extname(file)] ?? "application/octet-stream");
      const stream = createReadStream(file);
      stream.on("error", () => {
        if (!res.headersSent) res.writeHead(500);
        res.end("Fixture build asset unavailable");
      });
      stream.pipe(res);
    });
    await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
    return {
      url: `http://127.0.0.1:${port}`, close, storageDirectory: join(directory, "storage"),
      cleanupReport: () => ({ ...cleanup }),
      seedFixture(sql) {
        // Deliberately narrow fixture-only INSERTs into the disposable clone.
        // No DDL, updates, deletes, arbitrary queries, or caller-selected DB URL.
        const tuple = "\\([a-z0-9_@.+\\-:', ]+\\)";
        const safeInsert = new RegExp(`^\\s*INSERT\\s+INTO\\s+(?:public\\.)?(users|leads|deals)\\s*\\([a-z0-9_,\\s]+\\)\\s*VALUES\\s*${tuple}(?:\\s*,\\s*${tuple})*\\s*RETURNING\\s+id\\s*;?\\s*$`, "i");
        if (!safeInsert.test(sql)) throw new Error("Fixture seed must be literal INSERT tuples into users, leads, or deals with RETURNING id.");
        const result = spawnSync("psql", [`--dbname=${databaseUrl}`, "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=on", "--command", sql], { encoding: "utf8" });
        if (result.status !== 0) throw new Error("Synthetic fixture seed failed.");
        return result.stdout.trim();
      },
      query(sql) {
        if (!/^\s*SELECT\b/i.test(sql)) throw new Error("Evidence queries must be read-only SELECTs.");
        const result = spawnSync("psql", [`--dbname=${databaseUrl}`, "--no-psqlrc", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=on", "--command", sql], { encoding: "utf8" });
        if (result.status !== 0) throw new Error("Synthetic evidence query failed.");
        return result.stdout.trim();
      },
      async login(page, role = "admin") {
        const user = users[["admin", "manager", "rep"].indexOf(role)];
        const { token } = await clerkClient.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 120 });
        await page.goto(`http://127.0.0.1:${port}/sign-in`);
        await page.waitForFunction(() => window.Clerk?.loaded, { timeout: 30000 });
        await page.evaluate(async ticket => {
          const result = await window.Clerk.client.signIn.create({ strategy: "ticket", ticket });
          if (result.status !== "complete") throw new Error("Synthetic login incomplete.");
          await window.Clerk.setActive({ session: result.createdSessionId });
        }, token);
        await page.waitForTimeout(300);
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}