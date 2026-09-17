WITH moved_deals AS (
  UPDATE "deals"
  SET
    "stage" = 'in_funding',
    "updated_at" = now()
  WHERE "stage" = 'going_to_funding'
  RETURNING "id", "lead_id"
)
INSERT INTO "activity_log" (
  "user_id",
  "lead_id",
  "deal_id",
  "action",
  "entity_type",
  "entity_id",
  "details"
)
SELECT
  NULL,
  "lead_id",
  "id",
  'stage_changed',
  'deal',
  "id"::text,
  jsonb_build_object(
    'from', 'going_to_funding',
    'to', 'in_funding',
    'user', 'System',
    'userId', NULL,
    'timestamp', now(),
    'message', 'Stage merged: Going to Funding → In Funding'
  )
FROM moved_deals;

ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_stage_check";
ALTER TABLE "deals"
  ADD CONSTRAINT "deals_stage_check"
  CHECK ("stage" IN (
    'waiting_on_app',
    'information_needed',
    'submitted',
    'approved',
    'in_funding',
    'funded',
    'declined',
    'dead',
    'hold_on'
  ));