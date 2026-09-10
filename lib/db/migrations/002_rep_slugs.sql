ALTER TABLE users ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS users_slug_unique ON users (slug) WHERE slug IS NOT NULL;
-- Stable initial handles; subsequent users with the same first name receive a last initial.
WITH candidates AS (
  SELECT id, lower(regexp_replace(split_part(trim(coalesce(name, 'user-' || id::text)), ' ', 1), '[^a-zA-Z0-9]+', '', 'g')) AS base,
         lower(left(split_part(trim(coalesce(name, '')), ' ', 2), 1)) AS initial
  FROM users WHERE slug IS NULL
), numbered AS (
  SELECT id, base, initial, row_number() OVER (PARTITION BY base ORDER BY id) AS n
  FROM candidates
)
UPDATE users u SET slug = CASE WHEN NULLIF(base, '') IS NULL THEN 'user-' || u.id::text
                              WHEN n = 1 THEN base ELSE base || COALESCE(initial, '') || n::text END
FROM numbered WHERE u.id = numbered.id;