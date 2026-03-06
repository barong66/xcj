package clickhouse

import (
	"context"
	"fmt"
	"math"
	"time"

	ch "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

// Reader provides read access to ClickHouse analytics data.
type Reader struct {
	conn driver.Conn
}

// NewReader creates a new ClickHouse reader connection.
func NewReader(clickhouseURL string) (*Reader, error) {
	opts, err := ch.ParseDSN(clickhouseURL)
	if err != nil {
		return nil, fmt.Errorf("clickhouse reader: parse dsn: %w", err)
	}

	conn, err := ch.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("clickhouse reader: open: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := conn.Ping(ctx); err != nil {
		return nil, fmt.Errorf("clickhouse reader: ping: %w", err)
	}

	return &Reader{conn: conn}, nil
}

// Ping checks the ClickHouse connection.
func (r *Reader) Ping(ctx context.Context) error {
	return r.conn.Ping(ctx)
}

// Close shuts down the connection.
func (r *Reader) Close() error {
	return r.conn.Close()
}

// VideoStat holds aggregated stats for a single video from ClickHouse events.
type VideoStat struct {
	VideoID     int64   `json:"video_id"`
	Impressions uint64  `json:"impressions"`
	Clicks      uint64  `json:"clicks"`
	CTR         float64 `json:"ctr"`
}

// VideoStatsResult holds the full paginated response.
type VideoStatsResult struct {
	Stats      []VideoStat `json:"stats"`
	Total      uint64      `json:"total"`
	Page       int         `json:"page"`
	PerPage    int         `json:"per_page"`
	TotalPages int         `json:"total_pages"`
}

// GetVideoStats queries ClickHouse for aggregated video impression/click stats.
// Returns stats for all videos that have at least 1 impression or click.
func (r *Reader) GetVideoStats(ctx context.Context, sortBy, sortDir string, page, perPage int) (*VideoStatsResult, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 24
	}

	// Validate sort field.
	allowedSorts := map[string]string{
		"impressions": "impressions",
		"clicks":      "clicks",
		"ctr":         "ctr",
		"views":       "impressions", // alias
	}
	sortColumn, ok := allowedSorts[sortBy]
	if !ok {
		sortColumn = "impressions"
	}
	if sortDir != "asc" {
		sortDir = "desc"
	}

	// Count total unique videos with events.
	var total uint64
	err := r.conn.QueryRow(ctx, `
		SELECT COUNT(DISTINCT video_id)
		FROM events
		WHERE event_type IN ('feed_impression', 'feed_click', 'click', 'profile_thumb_impression', 'profile_thumb_click')
		  AND video_id > 0
	`).Scan(&total)
	if err != nil {
		return nil, fmt.Errorf("clickhouse reader: count: %w", err)
	}

	offset := (page - 1) * perPage

	// Query aggregated stats.
	query := fmt.Sprintf(`
		SELECT
			video_id,
			countIf(event_type IN ('feed_impression', 'profile_thumb_impression')) AS impressions,
			countIf(event_type IN ('feed_click', 'click', 'profile_thumb_click')) AS clicks,
			if(impressions > 0, round(clicks * 100.0 / impressions, 2), 0) AS ctr
		FROM events
		WHERE event_type IN ('feed_impression', 'feed_click', 'click', 'profile_thumb_impression', 'profile_thumb_click')
		  AND video_id > 0
		GROUP BY video_id
		ORDER BY %s %s
		LIMIT %d OFFSET %d
	`, sortColumn, sortDir, perPage, offset)

	rows, err := r.conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("clickhouse reader: query stats: %w", err)
	}
	defer rows.Close()

	var stats []VideoStat
	for rows.Next() {
		var s VideoStat
		if err := rows.Scan(&s.VideoID, &s.Impressions, &s.Clicks, &s.CTR); err != nil {
			return nil, fmt.Errorf("clickhouse reader: scan stat: %w", err)
		}
		stats = append(stats, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse reader: rows: %w", err)
	}

	if stats == nil {
		stats = []VideoStat{}
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))

	return &VideoStatsResult{
		Stats:      stats,
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: totalPages,
	}, nil
}

// FeedCTRStat holds aggregated feed impression/click data for ranking.
type FeedCTRStat struct {
	VideoID     int64
	Impressions int64
	Clicks      int64
}

// GetFeedCTRStats queries ClickHouse for feed impression/click counts per video
// over the last 7 days. Used by the cron job to compute Bayesian CTR scores.
func (r *Reader) GetFeedCTRStats(ctx context.Context) ([]FeedCTRStat, error) {
	rows, err := r.conn.Query(ctx, `
		SELECT
			video_id,
			toInt64(countIf(event_type = 'feed_impression')) AS impressions,
			toInt64(countIf(event_type = 'feed_click')) AS clicks
		FROM events
		WHERE event_type IN ('feed_impression', 'feed_click')
			AND created_at > now() - INTERVAL 7 DAY
			AND video_id > 0
		GROUP BY video_id
	`)
	if err != nil {
		return nil, fmt.Errorf("clickhouse reader: feed ctr stats: %w", err)
	}
	defer rows.Close()

	var stats []FeedCTRStat
	for rows.Next() {
		var s FeedCTRStat
		if err := rows.Scan(&s.VideoID, &s.Impressions, &s.Clicks); err != nil {
			return nil, fmt.Errorf("clickhouse reader: scan feed ctr: %w", err)
		}
		stats = append(stats, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse reader: feed ctr rows: %w", err)
	}

	return stats, nil
}

// BannerStat holds per-video banner impression/hover/click stats.
type BannerStat struct {
	VideoID     int64   `json:"video_id"`
	Impressions uint64  `json:"impressions"`
	Hovers      uint64  `json:"hovers"`
	Clicks      uint64  `json:"clicks"`
	CTR         float64 `json:"ctr"`
}

// GetBannerStats queries ClickHouse for banner stats grouped by video_id.
func (r *Reader) GetBannerStats(ctx context.Context, videoIDs []int64) (map[int64]BannerStat, error) {
	result := make(map[int64]BannerStat, len(videoIDs))
	if len(videoIDs) == 0 {
		return result, nil
	}

	rows, err := r.conn.Query(ctx, `
		SELECT
			video_id,
			countIf(event_type = 'banner_impression') AS impressions,
			countIf(event_type = 'banner_hover') AS hovers,
			countIf(event_type = 'banner_click') AS clicks,
			if(impressions > 0, round(clicks * 100.0 / impressions, 2), 0) AS ctr
		FROM events
		WHERE event_type IN ('banner_impression', 'banner_hover', 'banner_click')
			AND video_id IN (?)
		GROUP BY video_id
	`, videoIDs)
	if err != nil {
		return result, nil // gracefully return empty on error
	}
	defer rows.Close()

	for rows.Next() {
		var s BannerStat
		if err := rows.Scan(&s.VideoID, &s.Impressions, &s.Hovers, &s.Clicks, &s.CTR); err != nil {
			continue
		}
		result[s.VideoID] = s
	}
	return result, nil
}

// BannerFunnelStat holds the full funnel for a traffic source.
type BannerFunnelStat struct {
	Source      string  `json:"source"`
	Impressions uint64  `json:"impressions"`
	Hovers      uint64  `json:"hovers"`
	Clicks      uint64  `json:"clicks"`
	Landings    uint64  `json:"landings"`
	Conversions uint64  `json:"conversions"`
	CTR         float64 `json:"ctr"`
	ConvRate    float64 `json:"conv_rate"`
}

// GetBannerFunnelStats returns full funnel stats grouped by traffic source for the last N days.
func (r *Reader) GetBannerFunnelStats(ctx context.Context, days int) ([]BannerFunnelStat, error) {
	rows, err := r.conn.Query(ctx, `
		SELECT
			source,
			countIf(event_type = 'banner_impression') AS impressions,
			countIf(event_type = 'banner_hover') AS hovers,
			countIf(event_type = 'banner_click') AS clicks,
			countIf(event_type = 'ad_landing') AS landings,
			countIf(event_type IN ('social_click', 'content_click')) AS conversions,
			if(impressions > 0, round(clicks * 100.0 / impressions, 2), 0) AS ctr,
			if(clicks > 0, round(conversions * 100.0 / clicks, 2), 0) AS conv_rate
		FROM events
		WHERE source != ''
			AND event_type IN ('banner_impression', 'banner_hover', 'banner_click', 'ad_landing', 'social_click', 'content_click')
			AND created_at > now() - toIntervalDay(?)
		GROUP BY source
		ORDER BY impressions DESC
	`, days)
	if err != nil {
		return nil, fmt.Errorf("clickhouse reader: banner funnel stats: %w", err)
	}
	defer rows.Close()

	var stats []BannerFunnelStat
	for rows.Next() {
		var s BannerFunnelStat
		if err := rows.Scan(&s.Source, &s.Impressions, &s.Hovers, &s.Clicks, &s.Landings, &s.Conversions, &s.CTR, &s.ConvRate); err != nil {
			return nil, fmt.Errorf("clickhouse reader: scan funnel stat: %w", err)
		}
		stats = append(stats, s)
	}
	if stats == nil {
		stats = []BannerFunnelStat{}
	}
	return stats, rows.Err()
}

// GetTotalStats returns overall site stats: total impressions, clicks, and CTR.
type TotalSiteStats struct {
	TotalImpressions uint64  `json:"total_impressions"`
	TotalClicks      uint64  `json:"total_clicks"`
	TotalCTR         float64 `json:"total_ctr"`
	UniqueVideos     uint64  `json:"unique_videos"`
}

func (r *Reader) GetTotalStats(ctx context.Context) (*TotalSiteStats, error) {
	var stats TotalSiteStats
	err := r.conn.QueryRow(ctx, `
		SELECT
			countIf(event_type IN ('feed_impression', 'profile_thumb_impression')) AS total_impressions,
			countIf(event_type IN ('feed_click', 'click', 'profile_thumb_click')) AS total_clicks,
			if(total_impressions > 0, round(total_clicks * 100.0 / total_impressions, 2), 0) AS total_ctr,
			COUNT(DISTINCT video_id) AS unique_videos
		FROM events
		WHERE event_type IN ('feed_impression', 'feed_click', 'click', 'profile_thumb_impression', 'profile_thumb_click')
		  AND video_id > 0
	`).Scan(&stats.TotalImpressions, &stats.TotalClicks, &stats.TotalCTR, &stats.UniqueVideos)
	if err != nil {
		return nil, fmt.Errorf("clickhouse reader: total stats: %w", err)
	}
	return &stats, nil
}
