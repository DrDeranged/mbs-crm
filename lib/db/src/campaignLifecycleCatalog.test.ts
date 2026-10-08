import assert from "node:assert/strict";
import test from "node:test";
import { campaignLifecycleColumnsPrepared, campaignLifecycleMigrationChecksum } from "./campaignLifecycleCatalog";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const column = (name: string) => ({
  column_name: name, data_type: "timestamp with time zone",
  is_nullable: "YES", column_default: null,
});
const prepared = (rows: unknown[]) => campaignLifecycleColumnsPrepared({
  execute: async () => ({ rows }),
});
test("070 ledger adoption is pinned to the complete immutable migration", async () => {
  const file = await readFile(new URL("../migrations/070_campaign_lifecycle.sql", import.meta.url));
  assert.equal(createHash("sha256").update(file).digest("hex"), campaignLifecycleMigrationChecksum);
});
test("prepared nullable timestamps permit DDL-free lifecycle adoption", async () => {
  assert.equal(await prepared([column("archived_at"), column("deleted_at")]), true);
});
test("missing lifecycle columns cannot be adopted", async () => {
  assert.equal(await prepared([column("archived_at")]), false);
  assert.equal(await prepared([]), false);
});
test("wrong timestamp type cannot be adopted", async () => {
  assert.equal(await prepared([{ ...column("archived_at"), data_type: "text" }, column("deleted_at")]), false);
});
test("unexpected lifecycle nullability cannot be adopted", async () => {
  assert.equal(await prepared([column("archived_at"), { ...column("deleted_at"), is_nullable: "NO" }]), false);
});
test("unexpected lifecycle default cannot be adopted", async () => {
  assert.equal(await prepared([{ ...column("archived_at"), column_default: "now()" }, column("deleted_at")]), false);
});
