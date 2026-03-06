-- ClickHouse migration: enhanced banner funnel analytics
-- Adds hovers + source dimension to mv_banner_daily
-- Adds new mv_banner_conversions for full funnel by source

-- Drop old materialized view (cannot ALTER MV in ClickHouse)
DROP VIEW IF EXISTS xcj.mv_banner_daily;

-- Recreate with hovers and source dimension
CREATE MATERIALIZED VIEW IF NOT EXISTS xcj.mv_banner_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, video_id, source)
AS SELECT
    toDate(created_at) AS event_date,
    video_id,
    source,
    countIf(event_type = 'banner_impression') AS impressions,
    countIf(event_type = 'banner_hover') AS hovers,
    countIf(event_type = 'banner_click') AS clicks
FROM xcj.events
WHERE event_type IN ('banner_impression', 'banner_hover', 'banner_click')
GROUP BY event_date, video_id, source;

-- Full conversion funnel aggregation by source
CREATE MATERIALIZED VIEW IF NOT EXISTS xcj.mv_banner_conversions
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, source, event_type)
AS SELECT
    toDate(created_at) AS event_date,
    source,
    event_type,
    count() AS total_events
FROM xcj.events
WHERE source != ''
  AND event_type IN (
    'banner_impression', 'banner_hover', 'banner_click',
    'ad_landing', 'social_click', 'content_click', 'profile_view'
  )
GROUP BY event_date, source, event_type;
