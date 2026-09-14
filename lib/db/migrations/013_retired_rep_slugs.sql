CREATE TABLE IF NOT EXISTS retired_rep_slugs (
  id serial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  replacement_slug text NOT NULL,
  user_id integer NOT NULL REFERENCES users(id),
  retired_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retired_rep_slugs_replacement_idx
  ON retired_rep_slugs (replacement_slug);
CREATE INDEX IF NOT EXISTS retired_rep_slugs_user_idx
  ON retired_rep_slugs (user_id);