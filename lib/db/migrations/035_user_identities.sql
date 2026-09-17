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