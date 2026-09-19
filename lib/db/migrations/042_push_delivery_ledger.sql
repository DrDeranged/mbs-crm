CREATE TABLE IF NOT EXISTS push_delivery_attempts (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id integer REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'pruned')),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  error_message text
);
CREATE INDEX IF NOT EXISTS push_delivery_attempts_status_time_idx
  ON push_delivery_attempts(status, attempted_at);
CREATE INDEX IF NOT EXISTS push_delivery_attempts_user_idx
  ON push_delivery_attempts(user_id);