-- Additive ownership support for rep-created drip sequences.
-- Existing sequences intentionally retain NULL ownership and are read-only to reps.
ALTER TABLE drip_sequences
  ADD COLUMN IF NOT EXISTS created_by integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'drip_sequences_created_by_users_id_fk'
      AND conrelid = 'drip_sequences'::regclass
  ) THEN
    ALTER TABLE drip_sequences
      ADD CONSTRAINT drip_sequences_created_by_users_id_fk
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;