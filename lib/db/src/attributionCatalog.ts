import { sql } from "drizzle-orm";

type Executor = { execute(query: unknown): Promise<{ rows?: unknown[] }> };
type Column = [string, string, string, boolean, string?];
const columns: Column[] = [
  ["campaigns", "tracking_since", "timestamp with time zone", true],
  ["campaign_recipients", "sent_at", "timestamp with time zone", true],
  ["email_sends", "reply_token_digest", "text", true],
  ["email_sends", "original_reply_to", "text", true],
  ["leads", "referred_by_lead_id", "integer", true],
  ["leads", "referred_at", "timestamp without time zone", true],
  ["deals", "referred_by_lead_id", "integer", true],
];
const tableColumns: Record<string, Array<[string, string, boolean, string?]>> = {
  campaign_engagement: [
    ["id", "integer", false, "serial"], ["campaign_id", "integer", false],
    ["launch_id", "integer", true], ["lead_id", "integer", false],
    ["email_send_id", "integer", true], ["kind", "text", false],
    ["source_key", "text", true], ["evidence", "jsonb", true],
    ["occurred_at", "timestamp with time zone", false, "now()"],
  ],
  campaign_replies: [
    ["id", "integer", false, "serial"], ["campaign_id", "integer", false],
    ["lead_id", "integer", false], ["email_send_id", "integer", false],
    ["dedupe_key", "text", false], ["from_email", "text", false],
    ["subject", "text", false], ["body_text", "text", false],
    ["attachments", "jsonb", false, "'[]'::jsonb"], ["forward_to", "text", false],
    ["forward_status", "text", false, "'pending'::text"],
    ["failure_reason", "text", true], ["received_at", "timestamp with time zone", false, "now()"],
    ["forwarded_at", "timestamp with time zone", true],
  ],
  campaign_call_attributions: [
    ["id", "integer", false, "serial"], ["call_sid", "text", false],
    ["lead_id", "integer", true], ["campaign_id", "integer", true],
    ["original_at", "timestamp with time zone", false], ["reason", "text", false],
  ],
};
for (const [table, entries] of Object.entries(tableColumns)) {
  for (const entry of entries) columns.push([table, ...entry]);
}

export const attributionForeignKeys: Array<[string, string, string, string]> = [
  ["leads", "referred_by_lead_id", "leads", "SET NULL"],
  ["deals", "referred_by_lead_id", "leads", "SET NULL"],
  ["campaign_engagement", "campaign_id", "campaigns", "CASCADE"],
  ["campaign_engagement", "launch_id", "campaign_launches", "SET NULL"],
  ["campaign_engagement", "lead_id", "leads", "CASCADE"],
  ["campaign_engagement", "email_send_id", "email_sends", "SET NULL"],
  ["campaign_replies", "campaign_id", "campaigns", "CASCADE"],
  ["campaign_replies", "lead_id", "leads", "CASCADE"],
  ["campaign_replies", "email_send_id", "email_sends", "CASCADE"],
  ["campaign_call_attributions", "lead_id", "leads", "SET NULL"],
  ["campaign_call_attributions", "campaign_id", "campaigns", "SET NULL"],
];
const constraints: Array<[string, string, string]> = [
  ["leads", "leads_referrer_check", "CHECK ((((referred_by_lead_id IS NULL) OR (referred_by_partner_id IS NULL)) AND ((referred_by_lead_id IS NULL) OR (referred_by_lead_id <> id))))"],
  ["deals", "deals_referrer_check", "CHECK ((((referred_by_lead_id IS NULL) OR (referred_by_partner_id IS NULL)) AND ((referred_by_lead_id IS NULL) OR (lead_id IS NULL) OR (referred_by_lead_id <> lead_id))))"],
  ["campaign_engagement", "campaign_engagement_kind_check", "CHECK ((kind = ANY (ARRAY['flyer_click'::text, 'inbound_call'::text, 'referral'::text])))"],
  ["campaign_replies", "campaign_replies_forward_check", "CHECK ((forward_status = ANY (ARRAY['pending'::text, 'dispatching'::text, 'forwarded'::text, 'failed'::text, 'uncertain'::text])))"],
];
for (const table of Object.keys(tableColumns)) constraints.push([table, `${table}_pkey`, "PRIMARY KEY (id)"]);
for (const [table, col, target, action] of attributionForeignKeys) {
  constraints.push([table, `${table}_${col}_${target}_id_fk`, `FOREIGN KEY (${col}) REFERENCES ${target}(id) ON DELETE ${action}`]);
}
const indexes: Array<[string, string, boolean, string]> = [
  ["email_sends", "email_sends_reply_token_uq", true, "reply_token_digest"],
  ["leads", "leads_referrer_lead_idx", false, "referred_by_lead_id"],
  ["leads", "leads_referrer_partner_idx", false, "referred_by_partner_id"],
  ["deals", "deals_referrer_lead_idx", false, "referred_by_lead_id"],
  ["campaign_engagement", "campaign_engagement_source_uq", true, "source_key"],
  ["campaign_engagement", "campaign_engagement_campaign_lead_idx", false, "campaign_id, lead_id, occurred_at"],
  ["campaign_replies", "campaign_replies_dedupe_uq", true, "dedupe_key"],
  ["campaign_replies", "campaign_replies_campaign_idx", false, "campaign_id, lead_id"],
  ["campaign_call_attributions", "campaign_call_attributions_sid_uq", true, "call_sid"],
];
for (const table of Object.keys(tableColumns)) indexes.push([table, `${table}_pkey`, true, "id"]);
export function normalizeAttributionSql(value: unknown): string {
  // Parentheses determine CHECK semantics; string-literal case is significant.
  return String(value ?? "").replace(/nextval\('public\./g, "nextval('")
    .replace(/'(?:''|[^'])*'|[^']+/g, part => part.startsWith("'") ? part
      : part.replace(/\bpublic\./g, "").replace(/[\s"]/g, "").toLowerCase());
}
const normalize = normalizeAttributionSql;

/** Exact catalog evidence, not an already-exists error or shallow table marker. */
export async function inspectAttributionCatalog(db: Executor): Promise<{ missing: string[]; conflicts: string[] }> {
  const missing: string[] = [], conflicts: string[] = [];
  const columnRows = (await db.execute(sql`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = 'public'
  `)).rows as Array<Record<string, unknown>> ?? [];
  const constraintRows = (await db.execute(sql`
    SELECT c.relname AS table_name, k.conname, k.convalidated, k.condeferrable,
      pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
  `)).rows as Array<Record<string, unknown>> ?? [];
  const indexRows = (await db.execute(sql`
    SELECT t.relname AS table_name, i.relname AS indexname, x.indisvalid, x.indisready,
      pg_get_indexdef(i.oid) AS definition
    FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'
  `)).rows as Array<Record<string, unknown>> ?? [];
  for (const [table, name, type, nullable, defaultValue] of columns) {
    const row = columnRows.find(r => r.table_name === table && r.column_name === name);
    const key = `${table}.${name}`;
    if (!row) { missing.push(`column ${key}`); continue; }
    const expectedDefault = defaultValue === "serial" ? `nextval('${table}_id_seq'::regclass)` : defaultValue ?? "";
    if (row.data_type !== type || (row.is_nullable === "YES") !== nullable
      || normalize(row.column_default) !== normalize(expectedDefault)) conflicts.push(`column ${key}`);
  }
  for (const [table, name, definition] of constraints) {
    const row = constraintRows.find(r => r.table_name === table && r.conname === name);
    if (!row) missing.push(`constraint ${table}.${name}`);
    else if (!row.convalidated || row.condeferrable || normalize(row.definition) !== normalize(definition)) conflicts.push(`constraint ${table}.${name}`);
  }
  for (const [table, col, target, action] of attributionForeignKeys) {
    const oldName = `${table}_${col}_fkey`;
    const old = constraintRows.find(r => r.table_name === table && r.conname === oldName);
    if (old && (constraintRows.some(r => r.table_name === table && r.conname === `${table}_${col}_${target}_id_fk`)
      || normalize(old.definition) !== normalize(`FOREIGN KEY (${col}) REFERENCES ${target}(id) ON DELETE ${action}`)
      || !old.convalidated || old.condeferrable)) conflicts.push(`legacy foreign key ${table}.${oldName}`);
  }
  for (const [table, name, unique, cols] of indexes) {
    const row = indexRows.find(r => r.table_name === table && r.indexname === name);
    if (!row) missing.push(`index ${name}`);
    else if (!row.indisvalid || !row.indisready || normalize(row.definition)
      !== normalize(`CREATE ${unique ? "UNIQUE " : ""}INDEX ${name} ON ${table} USING btree (${cols})`)) conflicts.push(`index ${name}`);
  }
  return { missing, conflicts };
}
