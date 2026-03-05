-- Partial index for dynamic banner serving (fast lookup by size).
CREATE INDEX IF NOT EXISTS idx_banners_serve ON banners(width, height) WHERE is_active = true;
