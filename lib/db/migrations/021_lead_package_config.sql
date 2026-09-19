-- Retain a lead's most recently chosen lender-package configuration.
-- This is deliberately additive; migration 020 is already part of history.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS package_config jsonb;