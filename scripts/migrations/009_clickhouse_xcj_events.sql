-- ClickHouse migration: create events table in xcj database
-- The API connects to xcj database but events table was in default
-- This creates the correct schema matching what the Go API actually inserts

CREATE TABLE IF NOT EXISTS xcj.events (
    site_id       Int64,
    video_id      Int64,
    event_type    LowCardinality(String),
    session_id    String DEFAULT '',
    user_agent    String DEFAULT '',
    ip            String DEFAULT '',
    referrer      String DEFAULT '',
    extra         String DEFAULT '',
    created_at    DateTime DEFAULT now(),
    account_id    Int64 DEFAULT 0,
    target_url    String DEFAULT '',
    source_page   String DEFAULT '',
    source        String DEFAULT ''
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (site_id, created_at, event_type, video_id)
TTL created_at + INTERVAL 12 MONTH
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW IF NOT EXISTS xcj.mv_banner_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, video_id)
AS SELECT
    toDate(created_at) AS event_date,
    video_id,
    countIf(event_type = 'banner_impression') AS impressions,
    countIf(event_type = 'banner_click') AS clicks
FROM xcj.events
WHERE event_type IN ('banner_impression', 'banner_click')
GROUP BY event_date, video_id;
