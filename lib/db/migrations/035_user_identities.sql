CREATE TABLE IF NOT EXISTS user_identities (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clerk_id text NOT NULL UNIQUE,
  email text NOT NULL,
  provider text NOT NULL DEFAULT 'clerk',
  linked_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO user_identities (user_id, clerk_id, email, provider, linked_at)
SELECT id, clerk_id, email, 'clerk', COALESCE(updated_at, created_at, now())
FROM users
WHERE clerk_id IS NOT NULL
ON CONFLICT (clerk_id) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS merged_into_user_id integer REFERENCES users(id);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id serial PRIMARY KEY,
  actor_user_id integer NOT NULL REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_entity_idx ON admin_audit_log(entity_type, entity_id);