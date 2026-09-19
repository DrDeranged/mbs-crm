import assert from "node:assert/strict";
import test from "node:test";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  applicationsTable,
  notificationSettingsTable,
  schemaMigrationsTable,
} from "./schema/index";

const describeColumns = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => ({
    name: column.name,
    type: column.getSQLType(),
    notNull: column.notNull,
    primary: column.primary,
    default: column.default instanceof SQL
      ? new PgDialect().sqlToQuery(column.default).sql
      : column.default,
  }));

test("schema migrations model preserves the production ledger definition", () => {
  assert.deepEqual(describeColumns(schemaMigrationsTable), [
    { name: "name", type: "text", notNull: true, primary: true, default: undefined },
    { name: "applied_at", type: "timestamp with time zone", notNull: true, primary: false, default: "now()" },
    { name: "checksum", type: "text", notNull: true, primary: false, default: undefined },
    { name: "failed_at", type: "timestamp with time zone", notNull: false, primary: false, default: undefined },
    { name: "error", type: "text", notNull: false, primary: false, default: undefined },
    { name: "superseded_by", type: "text", notNull: false, primary: false, default: undefined },
    { name: "superseded_at", type: "timestamp with time zone", notNull: false, primary: false, default: undefined },
  ]);
});

test("notification settings model matches migration 041", () => {
  assert.deepEqual(describeColumns(notificationSettingsTable), [
    { name: "user_id", type: "integer", notNull: true, primary: true, default: undefined },
    { name: "push_enabled", type: "boolean", notNull: true, primary: false, default: false },
    { name: "updated_at", type: "timestamp with time zone", notNull: true, primary: false, default: "now()" },
  ]);
  const foreignKeys = getTableConfig(notificationSettingsTable).foreignKeys;
  assert.equal(foreignKeys.length, 1);
  const reference = foreignKeys[0].reference();
  assert.deepEqual(reference.columns.map((column) => column.name), ["user_id"]);
  assert.deepEqual(reference.foreignColumns.map((column) => column.name), ["id"]);
  assert.equal(foreignKeys[0].onDelete, "cascade");
});

test("applications model preserves migration 045 columns and check constraint", () => {
  const config = getTableConfig(applicationsTable);
  const columns = new Map(config.columns.map((column) => [column.name, column]));
  assert.equal(columns.get("equipment_category")?.getSQLType(), "text");
  assert.equal(columns.get("equipment_category")?.notNull, false);
  assert.equal(columns.get("is_homeowner")?.getSQLType(), "boolean");
  assert.equal(columns.get("is_homeowner")?.notNull, false);

  const constraint = config.checks.find(
    (checkConstraint) => checkConstraint.name === "applications_equipment_category_check",
  );
  assert.ok(constraint);
  const sql = new PgDialect().sqlToQuery(constraint.value).sql;
  for (const value of ["vocational", "otr_truck", "trailer", "construction", "other"]) {
    assert.match(sql, new RegExp(`'${value}'`));
  }
});