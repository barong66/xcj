-- ClickHouse migration 012: banner performance metrics
-- Adds device/browser/geo columns to events, creates banner_perf table,
-- and materialized views for performance and device breakdown aggregation

-- ============================================================================
-- 1. Add new columns to xcj.events (device, browser, geo, UTM)
-- ============================================================================

ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS browser LowCardinality(String) DEFAULT '';
ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS os LowCardinality(String) DEFAULT '';
ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS device_type LowCardinality(String) DEFAULT '';
ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS screen_width UInt16 DEFAULT 0;
ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS screen_height UInt16 DEFAULT 0;
ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS viewport_width UInt16 DEFAULT 0;
ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS viewport_height UInt16 DEFAULT 0;
ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS language LowCardinality(String) DEFAULT '';
ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS connection_type LowCardinality(String) DEFAULT '';
ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS page_url String DEFAULT '';
ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS country LowCardinality(String) DEFAULT '';
ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS utm_source String DEFAULT '';
ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS utm_medium String DEFAULT '';
ALTER TABLE xcj.events ADD COLUMN IF NOT EXISTS utm_campaign String DEFAULT '';

-- ============================================================================
-- 2. Create xcj.banner_perf table for performance metrics
-- ============================================================================

CREATE TABLE IF NOT EXISTS xcj.banner_perf (
    banner_id UInt64,
    video_id UInt64,
    account_id UInt64,
    site_id UInt16,
    -- Performance timings
    image_load_ms UInt16,
    render_ms UInt16,
    time_to_visible_ms UInt32,
    dwell_time_ms UInt32,
    hover_duration_ms UInt16,
    is_viewable UInt8,
    -- User context
    browser LowCardinality(String),
    os LowCardinality(String),
    device_type LowCardinality(String),
    screen_width UInt16,
    screen_height UInt16,
    connection_type LowCardinality(String),
    country LowCardinality(String),
    -- Meta
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (site_id, banner_id, created_at)
TTL created_at + INTERVAL 6 MONTH;

-- ============================================================================
-- 3. Materialized view: daily banner performance aggregation
--    Uses AggregatingMergeTree with state functions for correct merging
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS xcj.mv_banner_perf_daily
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, banner_id, device_type)
TTL event_date + INTERVAL 12 MONTH
AS SELECT
    toDate(created_at) AS event_date,
    banner_id,
    device_type,
    countState() AS total_events,
    avgState(image_load_ms) AS avg_image_load_ms,
    avgState(render_ms) AS avg_render_ms,
    avgState(dwell_time_ms) AS avg_dwell_time_ms,
    quantileState(0.95)(image_load_ms) AS p95_image_load_ms,
    quantileState(0.95)(render_ms) AS p95_render_ms,
    sumState(toUInt64(is_viewable)) AS viewable_count
FROM xcj.banner_perf
GROUP BY event_date, banner_id, device_type;

-- ============================================================================
-- 4. Materialized view: daily device/browser breakdown of events
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS xcj.mv_events_device_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_type, device_type, browser, os)
TTL event_date + INTERVAL 12 MONTH
AS SELECT
    toDate(created_at) AS event_date,
    event_type,
    device_type,
    browser,
    os,
    count() AS total_events
FROM xcj.events
GROUP BY event_date, event_type, device_type, browser, os;
