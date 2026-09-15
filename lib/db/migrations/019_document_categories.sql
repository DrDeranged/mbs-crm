-- Backfill only when introducing the column. Re-running this migration must
-- never overwrite categories selected by users after its first execution.
DO $$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'documents' AND column_name = 'category'
) THEN
ALTER TABLE "documents"
  ADD COLUMN "category" text NOT NULL DEFAULT 'other';

UPDATE "documents"
SET "category" = CASE
  WHEN "file_key" ~ '/documents/bankstatement-' THEN 'bank_statement'
  WHEN "file_key" ~ '/documents/signed-application-[^/]*[.]html$' THEN 'signed_application'
  ELSE 'other'
END;

END IF;
END $$;

ALTER TABLE "documents"
  DROP CONSTRAINT IF EXISTS "documents_category_check";

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_category_check"
  CHECK ("category" IN (
    'bank_statement',
    'invoice_quote',
    'drivers_license',
    'tax_return',
    'signed_application',
    'other'
  ));