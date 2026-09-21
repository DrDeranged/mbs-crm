DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'role'
      AND column_default IS DISTINCT FROM '''pending''::text'
  ) THEN
    ALTER TABLE users
      ALTER COLUMN role SET DEFAULT 'pending';
  END IF;
END $$;