const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const test = require("node:test");
process.env.BASE_PATH = "/mbs-crm-mobile/";
const { createServer, resolveStaticFile } = require("./serve");

test("static paths stay within the build root", () => {
  assert.equal(resolveStaticFile("/assets/app.js").status, 200);
  assert.equal(resolveStaticFile("/../package.json").status, 403);
  assert.equal(resolveStaticFile("/%2e%2e/package.json").status, 403);
  assert.equal(resolveStaticFile("/bad%").status, 400);
  assert.equal(resolveStaticFile("/bad%00path").status, 400);
});

test("base-path health endpoint supports GET and HEAD", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();

  for (const method of ["GET", "HEAD"]) {
    const response = await new Promise((resolve, reject) => {
      const request = http.request(
        { hostname: "127.0.0.1", port, path: "/mbs-crm-mobile/status", method },
        resolve,
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(response.statusCode, 200);
    response.resume();
  }
});

test("production server answers root, mounted root, and status promptly after spawn", async (t) => {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const { port } = reservation.address();
  await new Promise((resolve, reject) => {
    reservation.close((error) => (error ? reject(error) : resolve()));
  });

  const startedAt = performance.now();
  const child = spawn(process.execPath, [path.join(__dirname, "serve.js")], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      BASE_PATH: "/mbs-crm-mobile/",
    },
    stdio: "ignore",
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  });

  const requestStatus = (requestPath) =>
    new Promise((resolve, reject) => {
      const request = http.get(
        { hostname: "127.0.0.1", port, path: requestPath, timeout: 1500 },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.resume();
          response.once("end", () =>
            resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString("utf-8") }),
          );
        },
      );
      request.once("error", reject);
      request.once("timeout", () => request.destroy(new Error("Request timed out")));
    });

  const paths = ["/mbs-crm-mobile/", "/", "/status"];
  let responses;
  let requestError;
  const deadline = startedAt + 1000;
  while (performance.now() < deadline) {
    try {
      responses = await Promise.all(paths.map(requestStatus));
      break;
    } catch (error) {
      requestError = error;
      if (child.exitCode !== null || child.signalCode !== null) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  const elapsedMs = performance.now() - startedAt;
  assert.deepEqual(
    responses?.map(({ statusCode }) => statusCode),
    [200, 200, 200],
    `production server should answer ${paths.join(", ")} within 1000 ms from spawn; last request error: ${
      requestError?.message ?? "none"
    }`,
  );
  assert.match(responses[0].body, /Preview this app on your phone/);
  assert.match(responses[1].body, /Preview this app on your phone/);
  t.diagnostic(`production spawn-to-200 for ${paths.join(", ")}: ${elapsedMs.toFixed(1)} ms`);
});