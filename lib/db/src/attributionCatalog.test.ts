import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAttributionSql } from "./attributionCatalog";

test("catalog comparison preserves logical grouping and literal case", () => {
  assert.notEqual(normalizeAttributionSql("CHECK ((a OR b) AND c)"), normalizeAttributionSql("CHECK (a OR (b AND c))"));
  assert.notEqual(normalizeAttributionSql("DEFAULT 'pending'::text"), normalizeAttributionSql("DEFAULT 'PENDING'::text"));
  assert.equal(normalizeAttributionSql('CREATE INDEX "i" ON public."t" USING btree ("c")'),
    normalizeAttributionSql("create index i on t using btree(c)"));
  assert.equal(normalizeAttributionSql("nextval('public.t_id_seq'::regclass)"),
    normalizeAttributionSql("nextval('t_id_seq'::regclass)"));
});
