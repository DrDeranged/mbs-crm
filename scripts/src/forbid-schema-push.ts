import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type ScannedFile = { path: string; content: string };
export type ForbiddenSchemaPush = { path: string; line: number; text: string };

const kitCommand = ["drizzle", "kit"].join("-");
const apiFunction = ["push", "Schema"].join("");
const databaseScript = ["db", "push"].join(":");

const forbiddenPatterns = [
  new RegExp(`\\b${kitCommand}\\b[^\\r\\n;&|]*\\bpush\\b`, "i"),
  new RegExp(`\\b${databaseScript}\\b`, "i"),
  new RegExp(`\\b${apiFunction}\\b`),
  /\bpnpm\b[^\r\n;&|]*--filter\s+(?:"[^"]+"|'[^']+'|\S+)\s+(?:run\s+)?push(?:-force)?(?:\s|$)/i,
];

const allowedSchemaParityInspectionLines = new Set([
  `import { ${apiFunction} } from "${kitCommand}/api";`,
  `const diff = await ${apiFunction}(schema, database, ["public"], [...SCHEMA_PARITY_TABLE_FILTER]);`,
]);

function isAllowedSchemaParityInspection(file: string, text: string): boolean {
  return file === "lib/db/src/schemaCiCheck.ts"
    && allowedSchemaParityInspectionLines.has(text.trim());
}

const sourceOrConfigExtension = new Set([
  ".cjs", ".js", ".json", ".mjs", ".nix", ".sh", ".toml", ".ts", ".tsx", ".yaml", ".yml",
]);

export function shouldScanFile(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized);
  if (normalized.startsWith("node_modules/") || normalized.includes("/node_modules/")) return false;
  if (normalized.startsWith(".local/") || normalized.startsWith("attached_assets/") || normalized.startsWith("reports/")) return false;
  if (basename === ".replit" || basename === "replit.nix" || basename === "Procfile") return true;
  if (basename.startsWith("Dockerfile")) return true;
  return sourceOrConfigExtension.has(path.posix.extname(normalized));
}

export function findForbiddenSchemaPushes(files: ScannedFile[]): ForbiddenSchemaPush[] {
  const findings: ForbiddenSchemaPush[] = [];
  for (const file of files) {
    for (const [index, text] of file.content.split(/\r?\n/).entries()) {
      if (isAllowedSchemaParityInspection(file.path, text)) continue;
      if (forbiddenPatterns.some((pattern) => pattern.test(text))) {
        findings.push({ path: file.path, line: index + 1, text: text.trim() });
      }
    }
  }
  return findings;
}

async function trackedSourceAndConfigFiles(): Promise<ScannedFile[]> {
  const workspaceRoot = execFileSync(
    "git",
    ["rev-parse", "--show-toplevel"],
    { encoding: "utf8" },
  ).trim();
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: workspaceRoot, encoding: "utf8" },
  );
  const names = output.split("\0").filter(Boolean).filter(shouldScanFile);
  const files = await Promise.all(names.map(async (name): Promise<ScannedFile | null> => {
    try {
      return { path: name, content: await readFile(path.join(workspaceRoot, name), "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }));
  return files.filter((file): file is ScannedFile => file !== null);
}

export async function assertNoForbiddenSchemaPush(): Promise<void> {
  const findings = findForbiddenSchemaPushes(await trackedSourceAndConfigFiles());
  if (findings.length === 0) return;
  throw new Error([
    "Forbidden schema mutation command found; SQL migrations are the only schema path:",
    ...findings.map((finding) => `${finding.path}:${finding.line}: ${finding.text}`),
  ].join("\n"));
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  await assertNoForbiddenSchemaPush();
  console.log("Schema path guard passed");
}