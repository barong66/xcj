CREATE MATERIALIZED VIEW IF NOT EXISTS mv_banner_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, video_id, account_id)
AS SELECT
    toDate(created_at) AS event_date,
    video_id,
    account_id,
    countIf(event_type = 'banner_impression') AS impressions,
    countIf(event_type = 'banner_click') AS clicks
FROM events
WHERE event_type IN ('banner_impression', 'banner_click')
GROUP BY event_date, video_id, account_id;
