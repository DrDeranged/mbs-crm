ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "gm_split_pct" integer NOT NULL DEFAULT 100;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deals_gm_split_pct_check'
      AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE "deals"
      ADD CONSTRAINT "deals_gm_split_pct_check" CHECK ("gm_split_pct" BETWEEN 0 AND 100);
  END IF;
END $$;