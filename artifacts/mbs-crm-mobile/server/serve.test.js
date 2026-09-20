const assert = require("node:assert/strict");
const http = require("node:http");
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