-- ============================================
-- Traforama Video Aggregator — ClickHouse Schema
-- Run this against ClickHouse, NOT PostgreSQL
-- ============================================

-- Main events table (append-only, billions of rows)
CREATE TABLE IF NOT EXISTS events (
    -- Event info
    event_type      Enum8('view' = 1, 'click' = 2, 'hover' = 3, 'impression' = 4),
    event_time      DateTime,
    event_date      Date DEFAULT toDate(event_time),

    -- Content
    video_id        UInt64,
    account_id      UInt32,
    site_id         UInt16,
    category_ids    Array(UInt32),          -- video can have multiple categories
    country_id      UInt16,                 -- country of the video content
    platform        Enum8('twitter' = 1, 'instagram' = 2),

    -- User context
    visitor_hash    UInt64,                 -- hash of IP + User-Agent (no PII stored)
    visitor_country LowCardinality(String), -- GeoIP country code of the visitor
    visitor_city    LowCardinality(String), -- GeoIP city
    device_type     Enum8('desktop' = 1, 'mobile' = 2, 'tablet' = 3),
    referer_domain  LowCardinality(String),

    -- Page context
    source_page     Enum8('home' = 1, 'category' = 2, 'search' = 3, 'video' = 4, 'account' = 5),
    sort_type       Enum8('recent' = 1, 'popular' = 2, 'random' = 3, 'promoted' = 4),
    page_number     UInt16 DEFAULT 1,
    position        UInt16 DEFAULT 0        -- position on page (for CTR analysis)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (site_id, event_date, event_type, video_id)
TTL event_date + INTERVAL 12 MONTH
SETTINGS index_granularity = 8192;

-- ============================================
-- Materialized views for fast aggregations
-- ============================================

-- Daily video stats (for "popular" sorting)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_video_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (site_id, event_date, video_id)
AS SELECT
    site_id,
    event_date,
    video_id,
    countIf(event_type = 'view') AS views,
    countIf(event_type = 'click') AS clicks,
    countIf(event_type = 'hover') AS hovers,
    countIf(event_type = 'impression') AS impressions
FROM events
GROUP BY site_id, event_date, video_id;

-- Hourly video stats (for "trending" / hot content)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_video_hourly
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMMDD(event_hour)
ORDER BY (site_id, event_hour, video_id)
TTL event_hour + INTERVAL 7 DAY
AS SELECT
    site_id,
    toStartOfHour(event_time) AS event_hour,
    video_id,
    countIf(event_type = 'click') AS clicks,
    countIf(event_type = 'view') AS views
FROM events
GROUP BY site_id, event_hour, video_id;

-- Category stats per day (for category page ordering)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_category_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (site_id, event_date, category_id)
AS SELECT
    site_id,
    event_date,
    arrayJoin(category_ids) AS category_id,
    countIf(event_type = 'click') AS clicks,
    countIf(event_type = 'view') AS views
FROM events
GROUP BY site_id, event_date, category_id;

-- Account stats per day (for paid channel reporting)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_account_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (site_id, event_date, account_id)
AS SELECT
    site_id,
    event_date,
    account_id,
    countIf(event_type = 'impression') AS impressions,
    countIf(event_type = 'click') AS clicks,
    countIf(event_type = 'view') AS views
FROM events
GROUP BY site_id, event_date, account_id;

-- Visitor geo stats (for understanding audience)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_geo_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (site_id, event_date, visitor_country)
AS SELECT
    site_id,
    event_date,
    visitor_country,
    device_type,
    count() AS total_events,
    countIf(event_type = 'click') AS clicks,
    uniqExact(visitor_hash) AS unique_visitors
FROM events
GROUP BY site_id, event_date, visitor_country, device_type;
