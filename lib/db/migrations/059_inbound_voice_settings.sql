ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS voice_hours_start TEXT NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS voice_hours_end TEXT NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS voice_business_days INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::INTEGER[],
  ADD COLUMN IF NOT EXISTS voice_holidays TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS voice_greeting TEXT NOT NULL DEFAULT 'Thanks for calling My Business Solutions. Please leave your name, business name, and phone number, and a representative will call you back within one business day.',
  ADD COLUMN IF NOT EXISTS voice_after_hours_greeting TEXT NOT NULL DEFAULT 'Thanks for calling My Business Solutions. Our office is currently closed. Please leave your name, business name, and phone number, and we''ll return your call the next business day.',
  ADD COLUMN IF NOT EXISTS voice_routing_mode TEXT NOT NULL DEFAULT 'assigned-rep-first',
  ADD COLUMN IF NOT EXISTS voicemail_recipients TEXT[] NOT NULL DEFAULT ARRAY['funding@my-business-solutions.com']::TEXT[];

ALTER TABLE users ADD COLUMN IF NOT EXISTS forwarding_number TEXT;

UPDATE users
SET forwarding_number = CASE lower(trim(name))
  WHEN 'nate ford' THEN '+16022455425'
  WHEN 'manny yosipov' THEN '+19173996578'
  WHEN 'ray davis' THEN '+16197485908'
  WHEN 'calvin tuon' THEN '+17146977039'
  ELSE forwarding_number
END
WHERE forwarding_number IS NULL
  AND lower(trim(name)) IN ('nate ford', 'manny yosipov', 'ray davis', 'calvin tuon');