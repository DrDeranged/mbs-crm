ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS voice_caller_id text,
  ADD COLUMN IF NOT EXISTS sms_sender_number text;