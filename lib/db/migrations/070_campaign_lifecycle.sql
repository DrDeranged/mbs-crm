-- Archive and deleted-draft tombstones retain every send, result and audit row.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
