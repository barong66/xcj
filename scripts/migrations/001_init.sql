-- ============================================
-- Traforama Video Aggregator — PostgreSQL Schema
-- Migration 001: Initial schema
-- ============================================

-- Sites (multi-site support)
CREATE TABLE sites (
    id          SERIAL PRIMARY KEY,
    slug        VARCHAR(64) UNIQUE NOT NULL,       -- e.g. "blondes-tube", "fitness-clips"
    domain      VARCHAR(255) UNIQUE,                -- e.g. "blondestube.com"
    name        VARCHAR(255) NOT NULL,
    config      JSONB NOT NULL DEFAULT '{}',        -- theme, featured categories, etc.
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Categories
CREATE TABLE categories (
    id          SERIAL PRIMARY KEY,
    slug        VARCHAR(128) UNIQUE NOT NULL,       -- e.g. "blonde", "brunette", "fitness"
    name        VARCHAR(255) NOT NULL,
    parent_id   INT REFERENCES categories(id),      -- optional hierarchy
    is_active   BOOLEAN NOT NULL DEFAULT true,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_slug ON categories(slug);

-- Countries
CREATE TABLE countries (
    id          SERIAL PRIMARY KEY,
    code        CHAR(2) UNIQUE NOT NULL,            -- ISO 3166-1 alpha-2
    name        VARCHAR(128) NOT NULL
);

-- Site ↔ Category mapping (which categories appear on which site)
CREATE TABLE site_categories (
    site_id     INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    sort_order  INT NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, category_id)
);

-- Source accounts (Twitter/Instagram channels)
CREATE TABLE accounts (
    id              SERIAL PRIMARY KEY,
    platform        VARCHAR(16) NOT NULL CHECK (platform IN ('twitter', 'instagram')),
    username        VARCHAR(128) NOT NULL,
    platform_id     VARCHAR(128),                   -- Twitter user ID, Instagram pk
    display_name    VARCHAR(255),
    avatar_url      TEXT,
    follower_count  INT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    is_paid         BOOLEAN NOT NULL DEFAULT false,  -- paid promotion channel
    paid_until      TIMESTAMPTZ,
    last_parsed_at  TIMESTAMPTZ,
    parse_errors    INT NOT NULL DEFAULT 0,
    max_videos      INT DEFAULT NULL,               -- per-account limit (NULL = use global default)
    country_id      INT REFERENCES countries(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (platform, username)
);
CREATE INDEX idx_accounts_platform ON accounts(platform);
CREATE INDEX idx_accounts_active ON accounts(is_active) WHERE is_active = true;
CREATE INDEX idx_accounts_paid ON accounts(is_paid) WHERE is_paid = true;
CREATE INDEX idx_accounts_last_parsed ON accounts(last_parsed_at);

-- Videos
CREATE TABLE videos (
    id              BIGSERIAL PRIMARY KEY,
    account_id      INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    platform        VARCHAR(16) NOT NULL CHECK (platform IN ('twitter', 'instagram')),
    platform_id     VARCHAR(128) NOT NULL,           -- tweet ID / IG media ID
    original_url    TEXT NOT NULL,                    -- link to original post
    title           TEXT,                             -- extracted or generated title
    description     TEXT,
    duration_sec    INT,                              -- video duration in seconds
    thumbnail_url   TEXT,                             -- URL in our R2 storage
    preview_url     TEXT,                             -- 5-sec preview clip URL in R2
    width           INT,
    height          INT,
    country_id      INT REFERENCES countries(id),

    -- AI categorization
    ai_categories   JSONB,                           -- raw AI response for debugging
    ai_processed_at TIMESTAMPTZ,

    -- Cached counters (updated periodically from ClickHouse)
    view_count      BIGINT NOT NULL DEFAULT 0,
    click_count     BIGINT NOT NULL DEFAULT 0,

    -- Promotion
    is_promoted     BOOLEAN NOT NULL DEFAULT false,
    promoted_until  TIMESTAMPTZ,
    promotion_weight INT NOT NULL DEFAULT 0,          -- higher = more visible

    -- Status
    is_active       BOOLEAN NOT NULL DEFAULT true,
    published_at    TIMESTAMPTZ,                      -- when originally posted on platform
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (platform, platform_id)
);
CREATE INDEX idx_videos_account ON videos(account_id);
CREATE INDEX idx_videos_active ON videos(is_active, published_at DESC) WHERE is_active = true;
CREATE INDEX idx_videos_popular ON videos(is_active, click_count DESC) WHERE is_active = true;
CREATE INDEX idx_videos_country ON videos(country_id);
CREATE INDEX idx_videos_promoted ON videos(is_promoted, promotion_weight DESC) WHERE is_promoted = true;
CREATE INDEX idx_videos_platform_id ON videos(platform, platform_id);
CREATE INDEX idx_videos_published ON videos(published_at DESC);
CREATE INDEX idx_videos_created ON videos(created_at DESC);

-- Video ↔ Category mapping
CREATE TABLE video_categories (
    video_id    BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    confidence  REAL NOT NULL DEFAULT 1.0,            -- AI confidence score 0..1
    PRIMARY KEY (video_id, category_id)
);
CREATE INDEX idx_video_categories_cat ON video_categories(category_id);

-- Video ↔ Site mapping (which videos appear on which site)
CREATE TABLE site_videos (
    site_id     INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    video_id    BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    is_featured BOOLEAN NOT NULL DEFAULT false,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (site_id, video_id)
);
CREATE INDEX idx_site_videos_site ON site_videos(site_id, added_at DESC);

-- Parse queue (for tracking parsing jobs)
CREATE TABLE parse_queue (
    id          BIGSERIAL PRIMARY KEY,
    account_id  INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    status      VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error       TEXT,
    videos_found INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_parse_queue_status ON parse_queue(status, created_at);

-- Updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sites_updated BEFORE UPDATE ON sites FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_videos_updated BEFORE UPDATE ON videos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
