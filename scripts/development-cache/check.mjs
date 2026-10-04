// Checks cache ownership plus the actual lazy-page dependency requests.
// Optional argument: the running development server's origin.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { loadConfigFromFile } from "../../artifacts/mbs-crm/node_modules/vite/dist/node/index.js";

const configFile = resolve("artifacts/mbs-crm/vite.config.ts");
const serve = await loadConfigFromFile({ command: "serve", mode: "development" }, configFile);
const build = await loadConfigFromFile({ command: "build", mode: "production" }, configFile);
assert.ok(serve && build);
assert.notEqual(serve.config.cacheDir, build.config.cacheDir, "Builds must not own the live optimized-dependency cache");
assert.ok(serve.config.optimizeDeps.include.includes("recharts"));
assert.ok(serve.config.optimizeDeps.include.includes("date-fns"));
console.log("PASS: development/build caches are separate; dashboard dependencies are prebundled.");

if (process.argv[2]) {
  const origin = new URL(process.argv[2]);
  const page = await fetch(new URL("/src/pages/dashboard.tsx", origin));
  assert.equal(page.status, 200, "Dashboard module must load");
  const source = await page.text();
  for (const dependency of ["recharts", "date-fns"]) {
    const path = [...source.matchAll(/from\s+["']([^"']+)["']/g)]
      .map(match => match[1]).find(path => path.includes(`/deps/${dependency}.js`));
    assert.ok(path, `${dependency} must be in the transformed dashboard module`);
    const response = await fetch(new URL(path, origin));
    assert.equal(response.status, 200, `${dependency}: ${response.statusText}`);
    assert.match(response.headers.get("content-type") ?? "", /javascript/);
    console.log(`PASS: live dashboard ${dependency} module returns JavaScript, not 504.`);
  }
}