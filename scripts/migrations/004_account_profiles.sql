-- 004_account_profiles.sql
-- Add profile fields for model pages: slug, bio, social_links.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS social_links JSONB NOT NULL DEFAULT '{}';

-- Populate slug from existing username (lowercase).
UPDATE accounts SET slug = LOWER(username) WHERE slug IS NULL;

-- Make slug unique after backfill.
ALTER TABLE accounts ADD CONSTRAINT accounts_slug_unique UNIQUE (slug);
