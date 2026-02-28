-- Add per-account max_videos limit.
-- NULL = use global default from parser settings.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS max_videos INT DEFAULT NULL;
