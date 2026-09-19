CREATE TABLE IF NOT EXISTS push_subscriptions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  failed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_unique ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS notification_settings (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN (
    'new_application', 'new_lead_assigned', 'lead_replied',
    'submission_status_changed', 'task_due', 'stale_lead'
  )),
  enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, event)
);