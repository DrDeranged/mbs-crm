ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS sms_consent boolean NOT NULL DEFAULT false;
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS sms_consent_at timestamp;
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS sms_consent_ip text;
ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_sms_consent_evidence_check;
ALTER TABLE applications
  ADD CONSTRAINT applications_sms_consent_evidence_check
  CHECK (
    (sms_consent = false AND sms_consent_at IS NULL AND sms_consent_ip IS NULL)
    OR (sms_consent = true AND sms_consent_at IS NOT NULL AND sms_consent_ip IS NOT NULL)
  );