CREATE TABLE IF NOT EXISTS notification_delivery_claims (
  id serial PRIMARY KEY,
  user_id integer NOT NULL
    CONSTRAINT notification_delivery_claims_user_id_users_id_fk
    REFERENCES users(id) ON DELETE CASCADE,
  event text NOT NULL,
  scope_key text NOT NULL,
  period_key text NOT NULL,
  notification_id integer
    CONSTRAINT notification_delivery_claims_notification_id_notifications_id_fk
    REFERENCES notifications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_delivery_claims_unique
  ON notification_delivery_claims(user_id, event, scope_key, period_key);