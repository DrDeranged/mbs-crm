ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "title" text;

UPDATE "users"
SET "title" = CASE "email"
  WHEN 'rahmare@my-business-solutions.com' THEN 'REGIONAL SALES DIRECTOR – WEST'
  WHEN 'ray@my-business-solutions.com' THEN 'REGIONAL SALES DIRECTOR – WEST'
  WHEN 'nate@my-business-solutions.com' THEN 'CHIEF EXECUTIVE OFFICER'
  WHEN 'calvin@my-business-solutions.com' THEN 'VP OF BUSINESS DEVELOPMENT'
END
WHERE "title" IS NULL
  AND "email" IN (
    'rahmare@my-business-solutions.com',
    'ray@my-business-solutions.com',
    'nate@my-business-solutions.com',
    'calvin@my-business-solutions.com'
  );