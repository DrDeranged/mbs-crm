import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";

type QueryResult = { rows?: unknown[] };
type Executor = {
  execute(query: unknown): Promise<QueryResult>;
};
type Database = Executor & {
  transaction<T>(callback: (tx: Executor) => Promise<T>): Promise<T>;
};

export type MigrationFile = {
  name: string;
  id: string;
  checksum: string;
  sql: string;
};

export type MigrationStatus = MigrationFile & {
  status: "applied" | "pending" | "mismatch";
  appliedAt?: string;
  appliedChecksum?: string;
  detectedAsApplied?: boolean;
  supersededAt?: string;
};

export type MigrationReport = {
  applied: string[];
  detected: string[];
  skipped: string[];
  pending: string[];
  mismatches: Array<{ name: string; expected: string; actual: string }>;
  failed: { name: string; error: string } | null;
  migrations: MigrationStatus[];
};

export type MigrationSqlAnalysis = {
  createdTables: string[];
  referencedTables: string[];
  createdBeforeReferencedTables: string[];
  operations: Array<{ kind: "create" | "reference"; table: string }>;
};

type SqlToken = { value: string; quoted?: boolean } |
  { kind: "dollar"; tag: string; body: string } | "(" | ")" | ";" | "," | ".";
const tokenValue = (token: SqlToken | undefined): string | undefined =>
  token && typeof token !== "string" && "value" in token ? token.value : undefined;
const isWordToken = (token: SqlToken | undefined): token is { value: string; quoted?: boolean } =>
  Boolean(token && typeof token !== "string" && "value" in token);

function lexMigrationSql(text: string): SqlToken[] | null {
  const out: SqlToken[] = [];
  let i = 0;
  const word = (c: string) => /[A-Za-z0-9_$]/.test(c);
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "-" && text[i + 1] === "-") {
      i += 2; while (i < text.length && text[i] !== "\n") i++; continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2; let closed = false;
      while (i < text.length) {
        if (text[i] === "*" && text[i + 1] === "/") { i += 2; closed = true; break; }
        i++;
      }
      if (!closed) return null;
      continue;
    }
    if (c === "'" || (c.toLowerCase() === "e" && text[i + 1] === "'")) {
      if (c.toLowerCase() === "e") i++;
      i++;
      let closed = false;
      while (i < text.length) {
        if (text[i] === "\\") { if (++i >= text.length) return null; i++; continue; }
        if (text[i] === "'") {
          if (text[i + 1] === "'") { i += 2; continue; }
          i++; closed = true; break;
        }
        i++;
      }
      if (!closed) return null;
      continue;
    }
    if (c === '"') {
      i++; let value = ""; let closed = false;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { value += '"'; i += 2; continue; }
          i++; closed = true; break;
        }
        value += text[i++];
      }
      if (!closed) return null;
      out.push({ value, quoted: true }); continue;
    }
    if (c === "$") {
      const tag = text.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        const end = text.indexOf(tag, i + tag.length);
        if (end < 0) return null;
        out.push({ kind: "dollar", tag, body: text.slice(i + tag.length, end) });
        i = end + tag.length; continue;
      }
      // A bare dollar is not meaningful to the conservative analyzer.
      if (!word(text[i + 1] ?? "")) { i++; continue; }
    }
    if (c === "(" || c === ")" || c === ";" || c === "," || c === ".") {
      out.push(c); i++; continue;
    }
    if (word(c)) {
      let value = c; i++;
      while (i < text.length && word(text[i])) value += text[i++];
      out.push({ value: value.toLowerCase() }); continue;
    }
    // Operators and punctuation in expressions are harmless; retain neither.
    i++;
  }
  return out;
}

function normalizedRelation(tokens: SqlToken[], start: number): { name?: string; next: number; schema?: string } {
  const first = tokens[start];
  if (!first || typeof first === "string") {
    return { next: start };
  }
  if (!isWordToken(first)) return { next: start };
  const name = first.value;
  if (tokens[start + 1] === ".") {
    const second = tokens[start + 2];
    if (!isWordToken(second)) return { next: start };
    return { name: second.value, schema: name, next: start + 3 };
  }
  return { name, next: start + 1 };
}

function isPublicRelation(relation: { name?: string; schema?: string }): boolean {
  if (!relation.name) return false;
  if (relation.schema === "pg_catalog" || relation.schema === "information_schema") return false;
  if (relation.schema) return relation.schema === "public";
  return !relation.name.startsWith("pg_");
}

/** Conservative, side-effect-free SQL dependency analysis for migration rehearsal. */
export function analyzeMigrationSql(sqlText: string): MigrationSqlAnalysis {
  const tokens = lexMigrationSql(sqlText);
  if (!tokens) throw new Error("malformed SQL (unterminated comment, string, identifier, or dollar body)");
  const created = new Set<string>();
  const referenced = new Set<string>();
  const createdBeforeReferenced = new Set<string>();
  const operations: Array<{ kind: "create" | "reference"; table: string }> = [];
  const ctes = new Set<string>();
  // CTE parsing is deliberately structural. Looking for "name AS" with a
  // regexp mistakes ordinary subqueries and misses WITH RECURSIVE and column
  // lists. Parse every WITH (including nested ones) and skip balanced bodies.
  for (let i = 0; i < tokens.length; i++) {
    if (tokenValue(tokens[i]) !== "with") continue;
    const previous = tokens[i - 1];
    const beforePrevious = tokens[i - 2];
    const queryBoundary = i === 0 || previous === ";" ||
      (previous === "(" && (beforePrevious === undefined || new Set([
        "select", "from", "join", "where", "exists", "in", "as", "union", "all",
      ]).has(tokenValue(beforePrevious) ?? "")));
    // PostgreSQL type syntax ("timestamp with time zone", etc.) contains the
    // word WITH but is not a CTE. Only a statement/query boundary can start one.
    if (!queryBoundary) continue;
    let at = i + 1;
    if (tokenValue(tokens[at]) === "recursive") at++;
    let found = false;
    while (at < tokens.length) {
      const name = tokens[at];
      if (!isWordToken(name)) throw new Error("malformed WITH CTE name");
      ctes.add(name.value); found = true; at++;
      if (tokens[at] === "(") {
        let depth = 1; at++;
        while (at < tokens.length && depth) {
          if (tokens[at] === "(") depth++;
          else if (tokens[at] === ")") depth--;
          at++;
        }
        if (depth) throw new Error("malformed WITH CTE column list");
      }
      if (tokenValue(tokens[at]) !== "as" || tokens[at + 1] !== "(") {
        throw new Error("malformed WITH CTE (expected AS (...))");
      }
      at += 2;
      let depth = 1;
      while (at < tokens.length && depth) {
        if (tokens[at] === "(") depth++;
        else if (tokens[at] === ")") depth--;
        at++;
      }
      if (depth) throw new Error("malformed WITH CTE body");
      if (tokens[at] !== ",") break;
      at++;
    }
    if (!found) throw new Error("malformed WITH");
  }
  const refKeywords = new Set(["from", "join", "references", "into", "update", "delete"]);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!isWordToken(token)) continue;
    const keyword = token.value;
    if (keyword === "do" && (i === 0 || tokens[i - 1] === ";")) {
      const body = tokens[i + 1];
      if (body && typeof body !== "string" && "kind" in body && body.kind === "dollar") {
        if (/\bexecute\b/i.test(body.body) || /\b(?:format|quote_ident)\s*\(/i.test(body.body)) {
          throw new Error("unsupported dynamic SQL analysis in DO body");
        }
        let embedded: MigrationSqlAnalysis;
        try { embedded = analyzeMigrationSql(body.body); }
        catch (error) { throw new Error(`unsupported DO body analysis: ${safeMigrationAnalysisError(error)}`); }
        for (const operation of embedded.operations) {
          operations.push(operation);
          (operation.kind === "create" ? created : referenced).add(operation.table);
        }
      }
      continue;
    }
    const prior = tokens[i - 1];
    const prior2 = tokens[i - 2];
    if (keyword === "create" && tokenValue(tokens[i + 1]) === "table") {
      let at = i + 2;
      if (tokenValue(tokens[at]) === "if") at += 3;
      const rel = normalizedRelation(tokens, at);
      if (!isPublicRelation(rel) || !rel.name) throw new Error(`unsupported or non-public CREATE TABLE near ${rel.name ?? "unknown"}`);
      created.add(rel.name);
      operations.push({ kind: "create", table: rel.name });
      continue;
    }
    if (keyword === "alter" && tokenValue(tokens[i + 1]) === "table") {
      const rel = normalizedRelation(tokens, i + 2);
      if (!isPublicRelation(rel) || !rel.name) throw new Error("unsupported or non-public ALTER TABLE");
      referenced.add(rel.name);
      operations.push({ kind: "reference", table: rel.name });
      if (created.has(rel.name)) createdBeforeReferenced.add(rel.name);
      continue;
    }
    const indexOn = keyword === "on" && (() => {
      for (let lookback = 1; lookback <= 8 && i - lookback >= 0; lookback++) {
        const candidate = tokens[i - lookback];
        if (candidate === ";") break;
        if (tokenValue(candidate) === "index") return true;
      }
      return false;
    })();
    if (indexOn) {
      const rel = normalizedRelation(tokens, i + 1);
       if (isPublicRelation(rel) && rel.name && !ctes.has(rel.name)) {
         referenced.add(rel.name);
         operations.push({ kind: "reference", table: rel.name });
         if (created.has(rel.name)) createdBeforeReferenced.add(rel.name);
       }
      continue;
    }
    if (!refKeywords.has(keyword)) continue;
    // "ON DELETE SET NULL" is a constraint action, not DELETE FROM DML.
    if (keyword === "delete" && tokenValue(tokens[i + 1]) !== "from") continue;
    const rel = normalizedRelation(tokens, i + 1);
    if (!rel.name || rel.name === "select" || ctes.has(rel.name)) continue;
    // FROM function(...) and JOIN (subquery) are deliberately ignored.
    if (tokens[i + 1] === "(") continue;
    if (isPublicRelation(rel) && rel.name !== "information_schema" && rel.name !== "pg_catalog") {
      referenced.add(rel.name);
      operations.push({ kind: "reference", table: rel.name });
      if (created.has(rel.name)) createdBeforeReferenced.add(rel.name);
    }
  }
  return {
    createdTables: [...created],
    referencedTables: [...referenced],
    createdBeforeReferencedTables: [...createdBeforeReferenced],
    operations,
  };
}

function safeMigrationAnalysisError(error: unknown): string {
  return error instanceof Error ? error.message : "malformed embedded SQL";
}

const formatMigrationError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message;
};

export function formatSchemaBootLine(report: Pick<MigrationReport, "pending" | "mismatches" | "migrations">): string {
  const pending = [
    ...report.pending,
    ...report.mismatches.map(({ name }) => `${name} (checksum mismatch)`),
  ];
  if (pending.length > 0) return `SCHEMA PENDING: ${pending.join(", ")}`;
  const applied = report.migrations.filter((migration) => migration.status === "applied").length;
  return `schema OK (${applied} applied)`;
}

/**
 * The boot runner uses a separate line from the admin/status dry-run output:
 * this describes only what this boot applied, while the total is the number
 * of numbered migration files discovered in the bundle.
 */
export function formatSchemaSuccessLine(report: Pick<MigrationReport, "applied" | "migrations">): string {
  return `schema OK — applied ${report.applied.length} (${report.applied.join(", ")}), ${report.migrations.length} total`;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The first path is used by the API bundle (build.mjs copies the SQL files
 * next to the bundle). The latter paths keep this package useful on its own
 * in development and in migration tests.
 */
const defaultMigrationDirectories = [
  path.resolve(moduleDir, "migrations"),
  path.resolve(moduleDir, "../migrations"),
  path.resolve(moduleDir, "../../lib/db/migrations"),
];

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && (error as { code?: unknown }).code) {
    return String((error as { code?: unknown }).code);
  }
  return "cause" in error
    ? errorCode((error as { cause?: unknown }).cause)
    : undefined;
}

async function findMigrationDirectory(directory?: string): Promise<string> {
  if (directory) return directory;
  for (const candidate of defaultMigrationDirectories) {
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      // Try the next layout.
    }
  }
  throw new Error("Migration directory was not found");
}

export async function discoverMigrations(directory?: string): Promise<MigrationFile[]> {
  const migrationDirectory = await findMigrationDirectory(directory);
  const names = (await readdir(migrationDirectory))
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort((a, b) => {
      const numberA = Number(a.match(/^\d+/)?.[0] ?? 0);
      const numberB = Number(b.match(/^\d+/)?.[0] ?? 0);
      return numberA - numberB || a.localeCompare(b);
    });

  return Promise.all(
    names.map(async (name) => {
      const contents = await readFile(path.join(migrationDirectory, name), "utf8");
      return {
        name,
        id: name.replace(/\.sql$/i, ""),
        checksum: createHash("sha256").update(contents).digest("hex"),
        sql: contents,
      };
    }),
  );
}

async function tableAndColumns(
  executor: Executor,
  table: string,
  columns: string[],
): Promise<boolean> {
  const tableResult = await executor.execute(sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = ${table}
  `);
  if (!tableResult.rows?.length) return false;
  if (columns.length === 0) return true;

  const columnResult = await executor.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ${table}
      AND column_name IN (${sql.join(columns.map((column) => sql`${column}`), sql`, `)})
  `);
  const present = new Set(
    (columnResult.rows ?? []).map((row) =>
      String((row as Record<string, unknown>).column_name),
    ),
  );
  return columns.every((column) => present.has(column));
}

/**
 * These are deliberately conservative markers. A migration is only seeded
 * into the ledger when all of its durable schema changes are already present.
 * In particular, 018 must not be replayed: it contains lender rule backfills
 * that should never overwrite changes made after the original rollout.
 */
async function schemaShowsMigrationApplied(
  executor: Executor,
  migration: MigrationFile,
): Promise<boolean> {
  const n = Number(migration.name.match(/^\d+/)?.[0]);
  const markers: Record<number, [string, string[]][]> = {
    1: [["credit_pulls", []], ["credit_compliance_log", []]],
    2: [["users", ["slug"]]],
    3: [["deals", []], ["activity_log", ["deal_id"]]],
    4: [["deals", ["intended_rep_slug"]]],
    5: [["company_settings", ["include_admins_in_round_robin", "round_robin_cursor"]]],
    6: [["drip_sequences", ["created_by"]]],
    7: [["company_settings", ["stale_threshold_days"]]],
    8: [["company_settings", ["email_sending_enabled", "bulk_email_per_minute"]]],
    9: [["email_sends", ["failure_reason"]]],
    10: [["email_webhook_events", []], ["leads", []]],
    11: [["email_rate_slots", []]],
    12: [["applications", ["signature_method", "signature_signed_at"]]],
    13: [["retired_rep_slugs", []]],
    14: [["applications", [
      "business_type", "annual_revenue", "business_start_date",
      "years_under_current_ownership", "business_description", "est_credit_score",
      "timeline_funds_needed", "year_make_model", "trucks_in_fleet",
      "down_payment_amount", "secondary_owner_name", "secondary_owner_email",
      "secondary_owner_address", "secondary_owner_ssn_encrypted",
      "secondary_owner_dob", "secondary_owner_ownership_pct", "secondary_owner_cell",
      "secondary_owner_est_credit_score",
    ]]],
    15: [["applications", ["consent_text_version"]]],
    16: [["users", ["title"]]],
    17: [["deals", ["notes", "gm_split_pct"]]],
    18: [["lenders", [
      "restricted_industries", "prohibited_industries", "min_monthly_revenue",
      "restricted_industry_min_monthly_revenue", "startup_min_credit_score",
      "startup_max_time_in_business_months", "startup_max_amount",
      "min_industry_experience_months", "requires_financial_statements",
      "trucking_rules", "industry_time_in_business_overrides",
      "program_eligibility_rules",
    ]], ["applications", ["has_financial_statements", "has_factoring", "industry_experience_months"]]],
    19: [["documents", ["category"]]],
    34: [["applications", ["sms_consent", "sms_consent_at", "sms_consent_ip"]]],
    35: [
      ["user_identities", ["user_id", "clerk_id", "email", "provider", "linked_at"]],
      ["users", ["merged_into_user_id"]],
      ["admin_audit_log", ["actor_user_id", "action", "entity_type", "entity_id", "details", "created_at"]],
    ],
  };
  const required = markers[n];
  if (!required) return false;
  for (const [table, columns] of required) {
    if (!(await tableAndColumns(executor, table, columns))) return false;
  }
  return true;
}

type LedgerEntry = {
  checksum: string;
  appliedAt?: string;
  failedAt?: string;
  error?: string;
  supersededAt?: string;
};

async function readLedger(executor: Executor): Promise<Map<string, LedgerEntry>> {
  try {
    const result = await executor.execute(sql`
      SELECT name, checksum, applied_at, failed_at, error, superseded_at
      FROM schema_migrations
      ORDER BY name
    `);
    return new Map(
      (result.rows ?? []).map((row) => {
        const record = row as Record<string, unknown>;
        return [
          String(record.name),
          {
            checksum: String(record.checksum),
            appliedAt: record.applied_at ? new Date(String(record.applied_at)).toISOString() : undefined,
            failedAt: record.failed_at ? new Date(String(record.failed_at)).toISOString() : undefined,
            error: record.error ? String(record.error) : undefined,
            supersededAt: record.superseded_at ? new Date(String(record.superseded_at)).toISOString() : undefined,
          },
        ];
      }),
    );
  } catch (error) {
    // Legacy ledgers predate failure metadata. A dry run must remain
    // read-only, so retry the narrow historical projection instead of ALTERing.
    if (errorCode(error) === "42703") {
      const result = await executor.execute(sql`
        SELECT name, checksum, applied_at
        FROM schema_migrations
        ORDER BY name
      `);
      return new Map(
        (result.rows ?? []).map((row) => {
          const record = row as Record<string, unknown>;
          return [
            String(record.name),
            {
              checksum: String(record.checksum),
              appliedAt: record.applied_at ? new Date(String(record.applied_at)).toISOString() : undefined,
            },
          ];
        }),
      );
    }
    if (errorCode(error) === "42P01") return new Map();
    throw error;
  }
}

async function recordMigrationFailure(database: Executor, migration: MigrationFile, error: string): Promise<void> {
  await database.execute(sql`
    INSERT INTO schema_migrations (name, checksum, failed_at, error)
    VALUES (${migration.id}, ${migration.checksum}, now(), ${error})
    ON CONFLICT (name) DO UPDATE SET
      checksum = EXCLUDED.checksum, failed_at = EXCLUDED.failed_at,
      error = EXCLUDED.error, superseded_at = NULL
  `);
}

async function recordMigrationSuperseded(database: Executor, migration: MigrationFile, error: string): Promise<string> {
  const supersededAt = new Date().toISOString();
  await database.execute(sql`
    UPDATE schema_migrations
    SET checksum = ${migration.checksum}, applied_at = now(),
        superseded_at = ${supersededAt}, error = ${error}
    WHERE name IN (${migration.id}, ${migration.name})
  `);
  return supersededAt;
}

function isAlreadyExistsMigrationError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "42710" || code === "42P07" || code === "42701"
    || /already exists/i.test(formatMigrationError(error));
}

export function __testMissingRelation(error: unknown): string | undefined {
  const seen = new Set<object>();
  const queue: unknown[] = [error];
  while (queue.length) {
    const current = queue.shift();
    if (typeof current !== "object" || current === null) continue;
    if (seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : undefined;
    if (!code || code === "42P01") {
      const schema = typeof record.schema === "string" ? record.schema : undefined;
      const table = typeof record.table === "string"
        ? record.table
        : typeof record.relation === "string" ? record.relation : undefined;
      if (table) return schema
        ? `"${schema.replaceAll('"', '""')}"."${table.replaceAll('"', '""')}"`
        : table;
      const message = typeof record.message === "string" ? record.message : "";
      const match = message.match(/relation\s+((?:"[^"]+"\.)?"[^"]+?"|[a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)\s+does not exist/i);
      if (match) return match[1];
    }
    if (typeof record.cause === "object" && record.cause !== null) queue.push(record.cause);
  }
  return undefined;
}

function relationName(value: string): string {
  return value.split(".").map((part) => {
    const trimmed = part.trim();
    return trimmed.startsWith('"')
      ? trimmed.slice(1, -1).replaceAll('""', '"')
      : trimmed.toLowerCase();
  }).join(".");
}

function topLevelStatements(sqlText: string): string[] | null {
  const masked = sqlText.split("");
  const statements: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < sqlText.length; i++) {
    const char = sqlText[i];
    if (char === "-" && sqlText[i + 1] === "-") {
      const end = sqlText.indexOf("\n", i + 2);
      if (end < 0) break;
      for (let index = i; index < end; index++) masked[index] = " ";
      i = end;
      continue;
    }
    if (char === "/" && sqlText[i + 1] === "*") {
      const commentStart = i;
      let level = 1;
      i += 2;
      while (i < sqlText.length && level) {
        if (sqlText[i] === "/" && sqlText[i + 1] === "*") { level++; i++; }
        else if (sqlText[i] === "*" && sqlText[i + 1] === "/") { level--; i++; }
        i++;
      }
      if (level) return null;
      for (let index = commentStart; index < i; index++) {
        if (sqlText[index] !== "\n") masked[index] = " ";
      }
      continue;
    }
    if (char === "'") {
      const prefix = i > 0 ? sqlText[i - 1] : "";
      const escapeString = prefix === "e" || prefix === "E";
      if (/[A-Za-z_]/.test(prefix) && !escapeString) return null;
      let closed = false;
      for (i++; i < sqlText.length; i++) {
        if (escapeString && sqlText[i] === "\\") {
          if (i + 1 >= sqlText.length) return null;
          i++;
          continue;
        }
        if (sqlText[i] !== "'") continue;
        if (sqlText[i + 1] === "'") { i++; continue; }
        closed = true;
        break;
      }
      if (!closed) return null;
      continue;
    }
    if (char === '"') {
      let closed = false;
      for (i++; i < sqlText.length; i++) {
        if (sqlText[i] !== '"') continue;
        if (sqlText[i + 1] === '"') { i++; continue; }
        closed = true;
        break;
      }
      if (!closed) return null;
      continue;
    }
    if (char === "$") {
      const dollar = sqlText.slice(i).match(/^\$[A-Za-z_][\w]*\$|^\$\$/)?.[0];
      if (dollar) {
        const end = sqlText.indexOf(dollar, i + dollar.length);
        if (end < 0) return null;
        i = end + dollar.length - 1;
        continue;
      }
      if (/[A-Za-z0-9_]/.test(sqlText[i + 1] ?? "")) return null;
    }
    if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      if (depth < 0) return null;
    } else if (char === ";" && depth === 0) {
      statements.push(masked.slice(start, i).join(""));
      start = i + 1;
    }
  }
  if (depth !== 0) return null;
  statements.push(masked.slice(start).join(""));
  return statements;
}

export function __testCreatedRelations(sqlText: string): string[] | null {
  const statements = topLevelStatements(sqlText);
  if (!statements) return null;
  const relations: string[] = [];
  const identifier = `((?:"(?:[^"]|"")+"|[A-Za-z_][\\w$]*)(?:\\s*\\.\\s*(?:"(?:[^"]|"")+"|[A-Za-z_][\\w$]*))?)`;
  const create = new RegExp(`^\\s*CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier}\\s*\\(`, "i");
  for (const statement of statements) {
    const match = statement.match(create);
    if (match) relations.push(match[1].replace(/\s*\.\s*/g, "."));
  }
  return relations;
}

function creatorForRelation(
  relation: string,
  pending: MigrationFile[],
  currentIndex: number,
  applied: Set<string>,
): MigrationFile | null | undefined {
  const creators = pending.filter((candidate, index) =>
    index > currentIndex
      && !applied.has(candidate.id)
      // A migration that mutates the ledger is a recovery/finalization
      // migration, not a safe prerequisite to move ahead of its slot.
      && !/\bschema_migrations\b/i.test(candidate.sql)
      && __testCreatedRelations(candidate.sql)?.some((created) => relationName(created) === relationName(relation)));
  return creators.length === 1 ? creators[0] : creators.length === 0 ? null : undefined;
}

function emptyReport(): MigrationReport {
  return {
    applied: [],
    detected: [],
    skipped: [],
    pending: [],
    mismatches: [],
    failed: null,
    migrations: [],
  };
}

export async function runMigrations(options: {
  db?: Database;
  migrationsDir?: string;
  dryRun?: boolean;
  allowDependencyReordering?: boolean;
} = {}): Promise<MigrationReport> {
  if (!options.db) {
    throw new Error("A database executor is required to run migrations");
  }
  const database = options.db;
  const migrations = await discoverMigrations(options.migrationsDir);
  const report = emptyReport();

  if (!options.dryRun) {
    await database.execute(sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now(),
        checksum text NOT NULL,
        failed_at timestamptz,
        error text,
        superseded_by text,
        superseded_at timestamptz
      )
    `);
    await database.execute(sql`
      ALTER TABLE schema_migrations
        ADD COLUMN IF NOT EXISTS failed_at timestamptz,
        ADD COLUMN IF NOT EXISTS error text,
        ADD COLUMN IF NOT EXISTS superseded_by text,
        ADD COLUMN IF NOT EXISTS superseded_at timestamptz
    `);
  }
  const ledger = await readLedger(database);

  // Do the complete first-boot reconciliation before running any migration.
  // This matters for databases created before the ledger was introduced: all
  // durable schema markers must be inspected and seeded before a later
  // pending migration is allowed to run.
  const pendingMigrations: MigrationFile[] = [];
  for (const migration of migrations) {
    const ledgerEntry = ledger.get(migration.id) ?? ledger.get(migration.name);
    if (ledgerEntry) {
      // Provenance is authoritative: never retry or supersede a row whose
      // recorded checksum is not the checksum of the discovered file.
      if (ledgerEntry.checksum !== migration.checksum) {
        report.mismatches.push({
          name: migration.name,
          expected: ledgerEntry.checksum,
          actual: migration.checksum,
        });
        report.migrations.push({
          ...migration,
          status: "mismatch",
          appliedAt: ledgerEntry.appliedAt,
          appliedChecksum: ledgerEntry.checksum,
        });
        break;
      } else if (ledgerEntry.supersededAt) {
          report.skipped.push(migration.name);
          report.migrations.push({ ...migration, status: "applied", appliedAt: ledgerEntry.appliedAt,
            appliedChecksum: ledgerEntry.checksum, detectedAsApplied: true, supersededAt: ledgerEntry.supersededAt });
        } else if (ledgerEntry.failedAt || ledgerEntry.error) {
          const priorError = ledgerEntry.error ?? "Migration previously failed";
          if (options.dryRun) {
            report.pending.push(migration.name);
            report.migrations.push({ ...migration, status: "pending", appliedAt: ledgerEntry.appliedAt,
              appliedChecksum: ledgerEntry.checksum });
            report.failed = { name: migration.name, error: priorError };
            break;
          }
          try {
            await database.transaction(async (tx) => {
              await tx.execute(sql.raw(migration.sql));
              await tx.execute(sql`
                UPDATE schema_migrations SET checksum = ${migration.checksum}, applied_at = now(),
                  failed_at = NULL, error = NULL, superseded_at = NULL
                WHERE name IN (${migration.id}, ${migration.name})
              `);
            });
            report.applied.push(migration.name);
            report.pending = report.pending.filter((name) => name !== migration.name);
            report.migrations.push({ ...migration, status: "applied" });
            continue;
          } catch (retryError) {
            if (!isAlreadyExistsMigrationError(retryError)) {
              report.pending.push(migration.name);
              report.migrations.push({ ...migration, status: "pending" });
              report.failed = { name: migration.name, error: formatMigrationError(retryError) };
              await recordMigrationFailure(database, migration, report.failed.error);
              break;
            }
            const supersededAt = await recordMigrationSuperseded(database, migration, formatMigrationError(retryError));
            report.skipped.push(migration.name);
            report.pending = report.pending.filter((name) => name !== migration.name);
            report.migrations.push({ ...migration, status: "applied", detectedAsApplied: true, supersededAt });
            continue;
          }
      } else {
        report.skipped.push(migration.name);
        report.migrations.push({
          ...migration,
          status: "applied",
          appliedAt: ledgerEntry.appliedAt,
          appliedChecksum: ledgerEntry.checksum,
        });
      }
      continue;
    }

    let detected: boolean;
    try {
      detected = await schemaShowsMigrationApplied(database, migration);
    } catch (error) {
      report.pending.push(migration.name);
      report.migrations.push({ ...migration, status: "pending" });
      report.failed = {
        name: migration.name,
        error: formatMigrationError(error),
      };
      break;
    }
    if (detected) {
      report.detected.push(migration.name);
      report.skipped.push(migration.name);
      report.migrations.push({ ...migration, status: "applied", detectedAsApplied: true });
      if (!options.dryRun) {
        try {
          await database.transaction(async (tx) => {
            await tx.execute(sql`
              INSERT INTO schema_migrations (name, checksum)
              VALUES (${migration.id}, ${migration.checksum})
            `);
          });
        } catch (error) {
          report.failed = {
            name: migration.name,
            error: formatMigrationError(error),
          };
          break;
        }
      }
      continue;
    }

    report.pending.push(migration.name);
    report.migrations.push({ ...migration, status: "pending" });
    pendingMigrations.push(migration);
  }

  // A reconciliation failure must not allow any pending migration collected
  // before it to run: the first-boot phase is all-or-nothing.
  if (report.failed) return report;
  // Likewise, a checksum mismatch is a provenance blocker. Do not execute
  // pending files collected before the mismatched ledger row.
  if (report.mismatches.length > 0) return report;

  const appliedOutOfOrder = new Set<string>();
  for (let migrationIndex = 0; migrationIndex < pendingMigrations.length; migrationIndex++) {
    const migration = pendingMigrations[migrationIndex];
    if (appliedOutOfOrder.has(migration.id)) continue;
    if (options.dryRun) continue;

    let retriedAfterDependency = false;
    while (true) {
    try {
      await database.transaction(async (tx) => {
        await tx.execute(sql.raw(migration.sql));
        await tx.execute(sql`
          INSERT INTO schema_migrations (name, checksum)
          VALUES (${migration.id}, ${migration.checksum})
        `);
      });
      report.applied.push(migration.name);
      report.pending = report.pending.filter((name) => name !== migration.name);
      const status = report.migrations.find((entry) => entry.name === migration.name);
      if (status) {
        status.status = "applied";
        status.appliedChecksum = migration.checksum;
      }
      break;
    } catch (error) {
      if (!retriedAfterDependency && __testMissingRelation(error)) {
        const creator = creatorForRelation(__testMissingRelation(error)!, pendingMigrations, migrationIndex, appliedOutOfOrder);
        if (creator && options.allowDependencyReordering !== false) {
          try {
            await database.transaction(async (tx) => {
              await tx.execute(sql.raw(creator.sql));
              await tx.execute(sql`
                INSERT INTO schema_migrations (name, checksum)
                VALUES (${creator.id}, ${creator.checksum})
              `);
            });
            appliedOutOfOrder.add(creator.id);
            report.applied.push(creator.name);
            report.pending = report.pending.filter((name) => name !== creator.name);
            const creatorStatus = report.migrations.find((entry) => entry.name === creator.name);
            if (creatorStatus) {
              creatorStatus.status = "applied";
              creatorStatus.appliedChecksum = creator.checksum;
            }
            retriedAfterDependency = true;
            continue;
          } catch (creatorError) {
            report.failed = { name: creator.name, error: formatMigrationError(creatorError) };
            await recordMigrationFailure(database, creator, report.failed.error);
            break;
          }
        }
      }
      report.failed = {
        name: migration.name,
        error: formatMigrationError(error),
      };
      await recordMigrationFailure(database, migration, report.failed.error);
      break;
    }
    }
    if (report.failed) break;
  }

  return report;
}

export async function getMigrationStatus(options: {
  db?: Database;
  migrationsDir?: string;
} = {}): Promise<MigrationReport> {
  return runMigrations({ ...options, dryRun: true });
}