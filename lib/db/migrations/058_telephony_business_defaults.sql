ALTER TABLE company_settings
  ALTER COLUMN voice_caller_id SET DEFAULT '+19088608507',
  ALTER COLUMN sms_sender_number SET DEFAULT '+19088608507';

UPDATE company_settings
SET voice_caller_id = COALESCE(voice_caller_id, '+19088608507'),
    sms_sender_number = COALESCE(sms_sender_number, '+19088608507')
WHERE voice_caller_id IS NULL
   OR sms_sender_number IS NULL;