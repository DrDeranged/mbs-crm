import { getTableName, is, Table } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema/index";

type ColumnRow = {
  table_name: string;
  column_name: string;
  sql_type: string;
  is_nullable: boolean;
  has_default: boolean;
  default_expression: string | null;
};

type IndexRow = {
  table_name: string;
  index_name: string;
  is_unique: boolean;
  columns: string[];
  predicate: string | null;
  method: string;
  included_columns: string[];
};

type CheckRow = { table_name: string; constraint_name: string; definition: string };
type ForeignKeyRow = {
  table_name: string;
  columns: string[];
  foreign_table: string;
  foreign_columns: string[];
  on_delete: string;
  on_update: string;
};
type KeyRow = { table_name: string; constraint_type: "p" | "u"; columns: string[] };

const normalizeType = (value: string) =>
  value
    .replace(/^serial$/, "integer")
    .replace(/^timestamp without time zone$/, "timestamp")
    .replace(/^timestamp with time zone$/, "timestamp with time zone")
    .replace(/^character varying(?:\(\d+\))?$/, "varchar")
    .replace(/,\s+/g, ",")
    .replace(/\s+/g, " ")
    .trim();

const normalizeSql = (value: string | null | undefined) =>
  (value ?? "")
    .toLowerCase()
    .replace(/"/g, "")
    .replace(/::text/g, "")
    .replace(/\b[a-z_][a-z0-9_]*\./g, "")
    .replace(/trim\(both from ([^)]+)\)/g, "trim($1)")
    .replace(/\s+/g, " ")
    .replace(/^\((.*)\)$/s, "$1")
    .trim();

const asStringArray = (value: string[] | string) =>
  Array.isArray(value)
    ? value
    : value.slice(1, -1).split(",").filter(Boolean).map((item) => item.replace(/^"|"$/g, ""));

const normalizeDefault = (value: unknown, sqlType?: string) => {
  if (sqlType === "serial") return "serial";
  if (value == null) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "object" && "queryChunks" in value) {
    return normalizeDefault(new PgDialect().sqlToQuery(value as never).sql);
  }
  if (typeof value !== "string") return JSON.stringify(value);
  const normalized = value
    .toLowerCase()
    .replace(/^nextval\(.*\)$/, "serial")
    .replace(/::[a-z0-9_[\] ]+$/g, "")
    .replace(/^'(.*)'$/s, "$1")
    .trim();
  if (normalized === "{}" && sqlType?.endsWith("[]")) return "[]";
  return normalized;
};

const checkSignature = (value: string) => {
  const normalized = normalizeSql(value).replace(/^check\s*\(/, "").replace(/\)+$/g, "");
  const strings = [...normalized.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
  if (strings.length) return `strings:${strings.join(",")}`;
  const numbers = [...normalized.matchAll(/\b\d+\b/g)].map((match) => match[0]);
  return `numbers:${numbers.join(",")}`;
};

const modelTables = new Map<string, ReturnType<typeof getTableConfig>>();
for (const value of Object.values(schema)) {
  if (!is(value, Table)) continue;
  const config = getTableConfig(value);
  modelTables.set(config.name, config);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the read-only schema drift check");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
const mismatches: string[] = [];

try {
  await client.query("BEGIN READ ONLY");

  const columns = await client.query<ColumnRow>(`
    SELECT
      c.relname AS table_name,
      a.attname AS column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS sql_type,
      NOT a.attnotnull AS is_nullable,
      ad.adbin IS NOT NULL AS has_default,
      pg_get_expr(ad.adbin, ad.adrelid) AS default_expression
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum
  `);

  const indexes = await client.query<IndexRow>(`
    SELECT
      t.relname AS table_name,
      i.relname AS index_name,
      x.indisunique AS is_unique,
      ARRAY(
        SELECT pg_get_indexdef(x.indexrelid, key_position, true)
        FROM generate_series(1, x.indnkeyatts) AS key_position
        ORDER BY key_position
      ) AS columns,
      pg_get_expr(x.indpred, x.indrelid) AS predicate,
      access_method.amname AS method,
      CASE WHEN x.indnatts > x.indnkeyatts THEN ARRAY(
        SELECT pg_get_indexdef(x.indexrelid, included_position, true)
        FROM generate_series(x.indnkeyatts + 1, x.indnatts) AS included_position
        ORDER BY included_position
      ) ELSE ARRAY[]::text[] END AS included_columns
    FROM pg_index x
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_am access_method ON access_method.oid = i.relam
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_constraint con ON con.conindid = x.indexrelid
    WHERE n.nspname = 'public'
      AND con.oid IS NULL
    ORDER BY t.relname, i.relname
  `);

  const checks = await client.query<CheckRow>(`
    SELECT c.relname AS table_name, con.conname AS constraint_name,
      pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND con.contype = 'c'
    ORDER BY c.relname, con.conname
  `);

  const foreignKeys = await client.query<ForeignKeyRow>(`
    SELECT
      source.relname AS table_name,
      array_agg(source_column.attname ORDER BY keys.ordinality) AS columns,
      target.relname AS foreign_table,
      array_agg(target_column.attname ORDER BY keys.ordinality) AS foreign_columns,
      CASE fk_constraint.confdeltype
        WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set null'
        WHEN 'd' THEN 'set default'
        WHEN 'r' THEN 'restrict'
        ELSE 'no action'
      END AS on_delete,
      CASE fk_constraint.confupdtype
        WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set null'
        WHEN 'd' THEN 'set default'
        WHEN 'r' THEN 'restrict'
        ELSE 'no action'
      END AS on_update
    FROM pg_constraint fk_constraint
    JOIN pg_class source ON source.oid = fk_constraint.conrelid
    JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
    JOIN pg_class target ON target.oid = fk_constraint.confrelid
    JOIN unnest(fk_constraint.conkey, fk_constraint.confkey) WITH ORDINALITY
      AS keys(source_number, target_number, ordinality) ON true
    JOIN pg_attribute source_column
      ON source_column.attrelid = source.oid AND source_column.attnum = keys.source_number
    JOIN pg_attribute target_column
      ON target_column.attrelid = target.oid AND target_column.attnum = keys.target_number
    WHERE namespace.nspname = 'public' AND fk_constraint.contype = 'f'
    GROUP BY source.relname, target.relname, fk_constraint.oid, fk_constraint.confdeltype
    ORDER BY source.relname, fk_constraint.oid
  `);

  const keys = await client.query<KeyRow>(`
    SELECT
      table_class.relname AS table_name,
      key_constraint.contype AS constraint_type,
      array_agg(column_attribute.attname ORDER BY key_columns.ordinality) AS columns
    FROM pg_constraint key_constraint
    JOIN pg_class table_class ON table_class.oid = key_constraint.conrelid
    JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
    JOIN unnest(key_constraint.conkey) WITH ORDINALITY AS key_columns(number, ordinality) ON true
    JOIN pg_attribute column_attribute
      ON column_attribute.attrelid = table_class.oid
      AND column_attribute.attnum = key_columns.number
    WHERE namespace.nspname = 'public' AND key_constraint.contype IN ('p', 'u')
    GROUP BY table_class.relname, key_constraint.oid, key_constraint.contype
    ORDER BY table_class.relname, key_constraint.oid
  `);

  const actualColumns = new Map<string, Map<string, ColumnRow>>();
  for (const column of columns.rows) {
    const table = actualColumns.get(column.table_name) ?? new Map<string, ColumnRow>();
    table.set(column.column_name, column);
    actualColumns.set(column.table_name, table);
  }

  for (const tableName of [...modelTables.keys()].sort()) {
    const config = modelTables.get(tableName)!;
    const actual = actualColumns.get(tableName);
    if (!actual) {
      mismatches.push(`${tableName}: table is missing from the applied database`);
      continue;
    }

    const modelColumnNames = new Set(config.columns.map((column) => column.name));
    for (const column of config.columns) {
      const databaseColumn = actual.get(column.name);
      if (!databaseColumn) {
        mismatches.push(`${tableName}.${column.name}: model column is missing from the applied database`);
        continue;
      }
      const modelType = normalizeType(column.getSQLType());
      const databaseType = normalizeType(databaseColumn.sql_type);
      if (modelType !== databaseType) {
        mismatches.push(`${tableName}.${column.name}: type model=${modelType} database=${databaseType}`);
      }
      if (column.notNull === databaseColumn.is_nullable) {
        mismatches.push(
          `${tableName}.${column.name}: nullability model=${column.notNull ? "NOT NULL" : "NULL"} database=${databaseColumn.is_nullable ? "NULL" : "NOT NULL"}`,
        );
      }
      if (column.hasDefault !== databaseColumn.has_default) {
        mismatches.push(
          `${tableName}.${column.name}: default presence model=${column.hasDefault} database=${databaseColumn.has_default}`,
        );
      } else if (column.hasDefault) {
        const modelDefault = normalizeDefault(column.default, column.getSQLType());
        const databaseDefault = normalizeDefault(databaseColumn.default_expression, column.getSQLType());
        if (modelDefault !== databaseDefault) {
          mismatches.push(
            `${tableName}.${column.name}: default model=${modelDefault || "<none>"} database=${databaseDefault || "<none>"}`,
          );
        }
      }
    }
    for (const columnName of [...actual.keys()].sort()) {
      if (!modelColumnNames.has(columnName)) {
        mismatches.push(`${tableName}.${columnName}: applied database column is missing from the model`);
      }
    }

    const dialect = new PgDialect();
    const modelIndexes = new Map(config.indexes.map((entry) => {
      const index = entry.config;
      const indexColumns = index.columns.map((column) => {
        const indexedColumn = column as { name?: string; indexConfig?: { order?: string } };
        const name = indexedColumn.name ?? dialect.sqlToQuery(column as never).sql;
        const order = indexedColumn.indexConfig?.order === "desc" ? " DESC" : "";
        return normalizeSql(`${name}${order}`);
      });
      const predicate = index.where ? normalizeSql(dialect.sqlToQuery(index.where).sql) : "";
      return [
        index.name!,
        {
          unique: index.unique,
          columns: indexColumns,
          predicate,
          method: index.method ?? "btree",
          includedColumns: [],
        },
      ] as const;
    }));
    const databaseIndexes = new Map(
      indexes.rows
        .filter((index) => index.table_name === tableName)
        .map((index) => [
          index.index_name,
          {
            unique: index.is_unique,
            columns: index.columns.map(normalizeSql),
            predicate: normalizeSql(index.predicate),
            method: index.method,
            includedColumns: asStringArray(index.included_columns).map(normalizeSql),
          },
        ]),
    );
    for (const [indexName, modelIndex] of modelIndexes) {
      const databaseIndex = databaseIndexes.get(indexName);
      if (!databaseIndex) {
        mismatches.push(`${tableName}.${indexName}: model index is missing from the applied database`);
      } else if (JSON.stringify(modelIndex) !== JSON.stringify(databaseIndex)) {
        mismatches.push(
          `${tableName}.${indexName}: index definition model=${JSON.stringify(modelIndex)} database=${JSON.stringify(databaseIndex)}`,
        );
      }
    }
    for (const indexName of [...databaseIndexes.keys()].sort()) {
      if (!modelIndexes.has(indexName)) {
        mismatches.push(`${tableName}.${indexName}: applied database index is missing from the model`);
      }
    }

    const modelChecks = new Map(config.checks.map((check) => [
      check.name,
      checkSignature(dialect.sqlToQuery(check.value).sql),
    ]));
    const databaseChecks = new Map(
      checks.rows
        .filter((check) => check.table_name === tableName)
        .map((check) => [check.constraint_name, checkSignature(check.definition)]),
    );
    for (const [checkName, signature] of modelChecks) {
      if (!databaseChecks.has(checkName)) {
        mismatches.push(`${tableName}.${checkName}: model check is missing from the applied database`);
      } else if (databaseChecks.get(checkName) !== signature) {
        mismatches.push(
          `${tableName}.${checkName}: check definition model=${signature} database=${databaseChecks.get(checkName)}`,
        );
      }
    }
    for (const checkName of databaseChecks.keys()) {
      if (!modelChecks.has(checkName)) {
        mismatches.push(`${tableName}.${checkName}: applied database check is missing from the model`);
      }
    }

    const serializeKey = (columns: string[]) => columns.join(",");
    const modelPrimaryKeys = new Set([
      ...config.columns.filter((column) => column.primary).map((column) => serializeKey([column.name])),
      ...config.primaryKeys.map((key) => serializeKey(key.columns.map((column) => column.name))),
    ]);
    const databasePrimaryKeys = new Set(
      keys.rows
        .filter((key) => key.table_name === tableName && key.constraint_type === "p")
        .map((key) => serializeKey(asStringArray(key.columns))),
    );
    for (const key of modelPrimaryKeys) {
      if (!databasePrimaryKeys.has(key)) mismatches.push(`${tableName}(${key}): model primary key is missing from the applied database`);
    }
    for (const key of databasePrimaryKeys) {
      if (!modelPrimaryKeys.has(key)) mismatches.push(`${tableName}(${key}): applied database primary key is missing from the model`);
    }

    const modelUniqueKeys = new Set([
      ...config.columns.filter((column) => column.isUnique).map((column) => serializeKey([column.name])),
      ...config.uniqueConstraints.map((key) => serializeKey(key.columns.map((column) => column.name))),
    ]);
    const databaseUniqueKeys = new Set(
      keys.rows
        .filter((key) => key.table_name === tableName && key.constraint_type === "u")
        .map((key) => serializeKey(asStringArray(key.columns))),
    );
    for (const key of modelUniqueKeys) {
      if (!databaseUniqueKeys.has(key)) mismatches.push(`${tableName}(${key}): model unique constraint is missing from the applied database`);
    }
    for (const key of databaseUniqueKeys) {
      if (!modelUniqueKeys.has(key)) mismatches.push(`${tableName}(${key}): applied database unique constraint is missing from the model`);
    }

    const serializeForeignKey = (
      columns: string[],
      foreignTable: string,
      foreignColumns: string[],
      onDelete: string,
      onUpdate: string,
    ) => `${columns.join(",")}->${foreignTable}(${foreignColumns.join(",")}) on delete ${onDelete} on update ${onUpdate}`;
    const modelForeignKeys = new Set(config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();
      return serializeForeignKey(
        reference.columns.map((column) => column.name),
        getTableName(reference.foreignTable),
        reference.foreignColumns.map((column) => column.name),
        foreignKey.onDelete ?? "no action",
        foreignKey.onUpdate ?? "no action",
      );
    }));
    const databaseForeignKeys = new Set(
      foreignKeys.rows
        .filter((foreignKey) => foreignKey.table_name === tableName)
        .map((foreignKey) => serializeForeignKey(
          asStringArray(foreignKey.columns),
          foreignKey.foreign_table,
          asStringArray(foreignKey.foreign_columns),
          foreignKey.on_delete,
          foreignKey.on_update,
        )),
    );
    for (const foreignKey of modelForeignKeys) {
      if (!databaseForeignKeys.has(foreignKey)) {
        mismatches.push(`${tableName}.${foreignKey}: model foreign key is missing from the applied database`);
      }
    }
    for (const foreignKey of databaseForeignKeys) {
      if (!modelForeignKeys.has(foreignKey)) {
        mismatches.push(`${tableName}.${foreignKey}: applied database foreign key is missing from the model`);
      }
    }
  }

  for (const tableName of [...actualColumns.keys()].sort()) {
    if (tableName !== "schema_migrations" && !modelTables.has(tableName)) {
      mismatches.push(`${tableName}: applied database table is missing from the model`);
    }
  }

  await client.query("ROLLBACK");
} finally {
  client.release();
  await pool.end();
}

if (mismatches.length) {
  console.error(`Schema drift detected (${mismatches.length} mismatch${mismatches.length === 1 ? "" : "es"}):`);
  for (const mismatch of mismatches) console.error(`- ${mismatch}`);
  process.exitCode = 1;
} else {
  console.log(`Schema model matches the applied database (${modelTables.size} tables checked).`);
}