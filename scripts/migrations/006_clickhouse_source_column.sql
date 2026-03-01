-- 006: Add source column for ad traffic tracking
ALTER TABLE events ADD COLUMN IF NOT EXISTS source String DEFAULT '';
