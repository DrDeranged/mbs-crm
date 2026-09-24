ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS voice_greeting_audio_path TEXT,
  ADD COLUMN IF NOT EXISTS voice_after_hours_greeting_audio_path TEXT,
  ADD COLUMN IF NOT EXISTS voice_priority_rep_ids INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS missed_call_text_back_enabled BOOLEAN NOT NULL DEFAULT false;