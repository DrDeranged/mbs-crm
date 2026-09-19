ALTER TABLE notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_pkey;
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS id serial;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'notification_preferences'::regclass
      AND conname = 'notification_preferences_pkey'
  ) THEN
    ALTER TABLE notification_preferences
      ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_user_event_unique
  ON notification_preferences(user_id, event);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notification_settings'::regclass AND conname = 'notification_settings_user_id_fkey') THEN
    ALTER TABLE notification_settings RENAME CONSTRAINT notification_settings_user_id_fkey TO notification_settings_user_id_users_id_fk;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'push_subscriptions'::regclass AND conname = 'push_subscriptions_user_id_fkey') THEN
    ALTER TABLE push_subscriptions RENAME CONSTRAINT push_subscriptions_user_id_fkey TO push_subscriptions_user_id_users_id_fk;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'push_delivery_attempts'::regclass AND conname = 'push_delivery_attempts_user_id_fkey') THEN
    ALTER TABLE push_delivery_attempts RENAME CONSTRAINT push_delivery_attempts_user_id_fkey TO push_delivery_attempts_user_id_users_id_fk;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'push_delivery_attempts'::regclass AND conname = 'push_delivery_attempts_subscription_id_fkey') THEN
    ALTER TABLE push_delivery_attempts RENAME CONSTRAINT push_delivery_attempts_subscription_id_fkey TO push_delivery_attempts_subscription_id_push_subscriptions_id_fk;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notification_preferences'::regclass AND conname = 'notification_preferences_user_id_fkey') THEN
    ALTER TABLE notification_preferences RENAME CONSTRAINT notification_preferences_user_id_fkey TO notification_preferences_user_id_users_id_fk;
  END IF;
END $$;