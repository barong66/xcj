-- 005_clickhouse_profile_events.sql
-- Add columns for profile page analytics.
-- event_type is String so new event types (feed_impression, feed_click,
-- profile_view, etc.) work without schema changes.

ALTER TABLE events ADD COLUMN IF NOT EXISTS account_id UInt64 DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS target_url String DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_page String DEFAULT '';
