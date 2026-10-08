import { sql } from "drizzle-orm";

export const campaignLifecycleMigrationChecksum =
  "d65f9db85abef993f939e144a8a80819621c5d193051b280f7cc9f1212835937";

/** Verify the entire checksum-pinned 070 change before ledger-only adoption. */
export async function campaignLifecycleColumnsPrepared(executor: {
  execute(query: unknown): Promise<{ rows?: unknown[] }>;
}): Promise<boolean> {
  const result = await executor.execute(sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'campaigns'
      AND column_name IN ('archived_at', 'deleted_at')
  `);
  const columns = (result.rows ?? []) as Record<string, unknown>[];
  return ["archived_at", "deleted_at"].every(name => {
    const column = columns.find(row => row.column_name === name);
    return column?.data_type === "timestamp with time zone"
      && column.is_nullable === "YES" && column.column_default === null;
  });
}
