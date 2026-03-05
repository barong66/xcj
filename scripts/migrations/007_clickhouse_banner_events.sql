-- Add banner event types to the Enum8
ALTER TABLE events MODIFY COLUMN event_type Enum8(
    'view' = 1, 'click' = 2, 'hover' = 3, 'impression' = 4,
    'banner_impression' = 5, 'banner_click' = 6,
    'profile_thumb_click' = 7
);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_banner_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, video_id, account_id)
AS SELECT
    toDate(event_time) AS event_date,
    video_id,
    account_id,
    countIf(event_type = 'banner_impression') AS impressions,
    countIf(event_type = 'banner_click') AS clicks
FROM events
WHERE event_type IN ('banner_impression', 'banner_click')
GROUP BY event_date, video_id, account_id;
