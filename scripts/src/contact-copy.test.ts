import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const forbidden = [
  "555-" + "0000",
  "1800" + "5550000", // The retired number can also appear in tel: links.
  "mybusiness" + "solutions.com",
  "support" + "@",
];

function isFixture(file: string): boolean {
  return /(^|\/)(fixtures|__fixtures__|test-fixtures)\//i.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(file);
}

function violations(file: string, text: string): string[] {
  return text.split(/\r?\n/).flatMap((line, index) => {
    // The package name in the lockfile is not a contact address.
    const content = file === "pnpm-lock.yaml"
      ? line.replaceAll("source-map-" + "support" + "@", "")
      : line;
    return forbidden.some((term) => content.toLowerCase().includes(term))
      ? [`${file}:${index + 1}`]
      : [];
  });
}

test("repository contact copy contains no retired contact strings outside test fixtures", () => {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repoRoot,
  }).toString("utf8").split("\0").filter(Boolean);
  const findings: string[] = [];
  for (const file of files) {
    if (isFixture(file)) continue;
    const bytes = readFileSync(path.join(repoRoot, file));
    if (bytes.includes(0)) continue; // Binary assets are not editable contact copy.
    findings.push(...violations(file, bytes.toString("utf8")));
  }
  assert.deepEqual(findings, [], `Retired contact copy at: ${findings.join(", ")}`);
});

test("contact guard catches retired email, domain, and phone in ordinary source", () => {
  for (const term of forbidden) {
    assert.deepEqual(violations("src/contact.ts", `const contact = "${term}";`), ["src/contact.ts:1"]);
  }
  assert.equal(isFixture("src/contact.test.ts"), true);
  assert.equal(isFixture("lib/__fixtures__/contact.sql"), true);
  assert.deepEqual(violations("pnpm-lock.yaml", "  source-map-" + "support@0.5.21:"), []);
});