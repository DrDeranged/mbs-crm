ALTER TABLE company_settings
  ALTER COLUMN voice_business_days SET DEFAULT '{1,2,3,4,5}',
  ALTER COLUMN voice_holidays SET DEFAULT '{}',
  ALTER COLUMN voicemail_recipients SET DEFAULT '{"funding@my-business-solutions.com"}';