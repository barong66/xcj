package clickhouse

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strings"
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
			AND video_id IN ?
		GROUP BY video_id
	`, videoIDs)
	if err != nil {
		slog.Error("clickhouse: get banner stats", "error", err, "video_count", len(videoIDs))
		return result, nil
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

// AccountDayStat holds one day of funnel metrics for a single account.
type AccountDayStat struct {
	Date             string  `json:"date"`
	ProfileViews     uint64  `json:"profile_views"`
	InstagramClicks  uint64  `json:"instagram_clicks"`
	PaidSiteClicks   uint64  `json:"paid_site_clicks"`
	VideoClicks      uint64  `json:"video_clicks"`
	ThumbImpressions uint64  `json:"thumb_impressions"`
	UniqueSessions   uint64  `json:"unique_sessions"`
	AvgSessionSec    float64 `json:"avg_session_sec"`
}

// AccountFunnelResult wraps daily stats with summary totals.
type AccountFunnelResult struct {
	Days    []AccountDayStat `json:"days"`
	Summary AccountDayStat   `json:"summary"`
}

// GetAccountFunnelStats returns per-day funnel stats for a single account.
func (r *Reader) GetAccountFunnelStats(ctx context.Context, accountID int64, days int) (*AccountFunnelResult, error) {
	// Main funnel query.
	rows, err := r.conn.Query(ctx, `
		SELECT
			toDate(created_at) AS day,
			countIf(event_type = 'profile_view') AS profile_views,
			countIf(event_type = 'social_click' AND source_page IN ('social:instagram', 'social:twitter')) AS instagram_clicks,
			countIf(event_type = 'social_click' AND source_page NOT IN ('social:instagram', 'social:twitter', '')) AS paid_site_clicks,
			countIf(event_type = 'profile_thumb_click') AS video_clicks,
			countIf(event_type = 'profile_thumb_impression') AS thumb_impressions,
			COUNT(DISTINCT session_id) AS unique_sessions
		FROM events
		WHERE account_id = ?
			AND created_at > now() - toIntervalDay(?)
			AND event_type IN ('profile_view', 'social_click', 'profile_thumb_click', 'profile_thumb_impression')
		GROUP BY day
		ORDER BY day DESC
	`, accountID, days)
	if err != nil {
		return nil, fmt.Errorf("clickhouse reader: account funnel: %w", err)
	}
	defer rows.Close()

	dayMap := make(map[string]*AccountDayStat)
	var dayList []AccountDayStat

	for rows.Next() {
		var s AccountDayStat
		var day time.Time
		if err := rows.Scan(&day, &s.ProfileViews, &s.InstagramClicks, &s.PaidSiteClicks, &s.VideoClicks, &s.ThumbImpressions, &s.UniqueSessions); err != nil {
			return nil, fmt.Errorf("clickhouse reader: scan account funnel: %w", err)
		}
		s.Date = day.Format("2006-01-02")
		dayList = append(dayList, s)
		dayMap[s.Date] = &dayList[len(dayList)-1]
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse reader: account funnel rows: %w", err)
	}

	// Session duration sub-query.
	durRows, err := r.conn.Query(ctx, `
		SELECT
			toDate(min_ts) AS day,
			avg(duration) AS avg_session_sec
		FROM (
			SELECT
				session_id,
				min(created_at) AS min_ts,
				dateDiff('second', min(created_at), max(created_at)) AS duration
			FROM events
			WHERE account_id = ?
				AND session_id != ''
				AND created_at > now() - toIntervalDay(?)
			GROUP BY session_id
			HAVING duration > 0 AND duration < 7200
		)
		GROUP BY day
		ORDER BY day DESC
	`, accountID, days)
	if err != nil {
		slog.Error("clickhouse: account session duration", "error", err, "account_id", accountID)
	} else {
		defer durRows.Close()
		for durRows.Next() {
			var day time.Time
			var avgSec float64
			if err := durRows.Scan(&day, &avgSec); err != nil {
				continue
			}
			dateStr := day.Format("2006-01-02")
			if ds, ok := dayMap[dateStr]; ok {
				ds.AvgSessionSec = math.Round(avgSec*10) / 10
			}
		}
	}

	// Compute summary.
	var summary AccountDayStat
	var totalDur float64
	var durCount int
	for _, d := range dayList {
		summary.ProfileViews += d.ProfileViews
		summary.InstagramClicks += d.InstagramClicks
		summary.PaidSiteClicks += d.PaidSiteClicks
		summary.VideoClicks += d.VideoClicks
		summary.ThumbImpressions += d.ThumbImpressions
		summary.UniqueSessions += d.UniqueSessions
		if d.AvgSessionSec > 0 {
			totalDur += d.AvgSessionSec
			durCount++
		}
	}
	if durCount > 0 {
		summary.AvgSessionSec = math.Round(totalDur/float64(durCount)*10) / 10
	}

	if dayList == nil {
		dayList = []AccountDayStat{}
	}

	return &AccountFunnelResult{
		Days:    dayList,
		Summary: summary,
	}, nil
}

// ─── Performance Metrics ─────────────────────────────────────────────────────

// PerfSummary holds performance metrics grouped by device/browser.
type PerfSummary struct {
	DeviceType      string  `json:"device_type"`
	Browser         string  `json:"browser"`
	TotalEvents     uint64  `json:"total_events"`
	AvgImageLoadMs  float64 `json:"avg_image_load_ms"`
	AvgRenderMs     float64 `json:"avg_render_ms"`
	AvgDwellTimeMs  float64 `json:"avg_dwell_time_ms"`
	P95ImageLoadMs  float64 `json:"p95_image_load_ms"`
	P95RenderMs     float64 `json:"p95_render_ms"`
	ViewabilityRate float64 `json:"viewability_rate"`
}

// GetPerfSummary returns banner performance metrics grouped by device type and browser.
func (r *Reader) GetPerfSummary(ctx context.Context, days int) ([]PerfSummary, error) {
	rows, err := r.conn.Query(ctx, `
		SELECT
			device_type,
			browser,
			count() AS total_events,
			avg(image_load_ms) AS avg_image_load_ms,
			avg(render_ms) AS avg_render_ms,
			avg(dwell_time_ms) AS avg_dwell_time_ms,
			quantile(0.95)(image_load_ms) AS p95_image_load_ms,
			quantile(0.95)(render_ms) AS p95_render_ms,
			if(total_events > 0, countIf(is_viewable = 1) * 100.0 / total_events, 0) AS viewability_rate
		FROM banner_perf
		WHERE created_at >= now() - toIntervalDay(?)
		GROUP BY device_type, browser
		ORDER BY total_events DESC
	`, days)
	if err != nil {
		return nil, fmt.Errorf("clickhouse reader: perf summary: %w", err)
	}
	defer rows.Close()

	var result []PerfSummary
	for rows.Next() {
		var s PerfSummary
		if err := rows.Scan(&s.DeviceType, &s.Browser, &s.TotalEvents, &s.AvgImageLoadMs, &s.AvgRenderMs, &s.AvgDwellTimeMs, &s.P95ImageLoadMs, &s.P95RenderMs, &s.ViewabilityRate); err != nil {
			return nil, fmt.Errorf("clickhouse reader: scan perf summary: %w", err)
		}
		result = append(result, s)
	}
	if result == nil {
		result = []PerfSummary{}
	}
	return result, rows.Err()
}

// DeviceBreakdown holds event counts by device/OS/browser.
type DeviceBreakdown struct {
	DeviceType string  `json:"device_type"`
	OS         string  `json:"os"`
	Browser    string  `json:"browser"`
	Events     uint64  `json:"events"`
	Clicks     uint64  `json:"clicks"`
	CTR        float64 `json:"ctr"`
}

// GetDeviceBreakdown returns banner impression/click stats grouped by device, OS, browser.
func (r *Reader) GetDeviceBreakdown(ctx context.Context, days int) ([]DeviceBreakdown, error) {
	rows, err := r.conn.Query(ctx, `
		SELECT
			device_type,
			os,
			browser,
			countIf(event_type = 'banner_impression') AS events,
			countIf(event_type = 'banner_click') AS clicks,
			if(events > 0, round(clicks * 100.0 / events, 2), 0) AS ctr
		FROM events
		WHERE created_at >= now() - toIntervalDay(?)
			AND event_type IN ('banner_impression', 'banner_click')
			AND device_type != ''
		GROUP BY device_type, os, browser
		ORDER BY events DESC
		LIMIT 50
	`, days)
	if err != nil {
		return nil, fmt.Errorf("clickhouse reader: device breakdown: %w", err)
	}
	defer rows.Close()

	var result []DeviceBreakdown
	for rows.Next() {
		var s DeviceBreakdown
		if err := rows.Scan(&s.DeviceType, &s.OS, &s.Browser, &s.Events, &s.Clicks, &s.CTR); err != nil {
			return nil, fmt.Errorf("clickhouse reader: scan device breakdown: %w", err)
		}
		result = append(result, s)
	}
	if result == nil {
		result = []DeviceBreakdown{}
	}
	return result, rows.Err()
}

// ReferrerStat holds traffic stats by referrer domain.
type ReferrerStat struct {
	ReferrerDomain string  `json:"referrer_domain"`
	Impressions    uint64  `json:"impressions"`
	Clicks         uint64  `json:"clicks"`
	CTR            float64 `json:"ctr"`
}

// GetReferrerStats returns banner impression/click stats grouped by referrer domain.
func (r *Reader) GetReferrerStats(ctx context.Context, days int) ([]ReferrerStat, error) {
	rows, err := r.conn.Query(ctx, `
		SELECT
			domain(referrer) AS referrer_domain,
			countIf(event_type = 'banner_impression') AS impressions,
			countIf(event_type = 'banner_click') AS clicks,
			if(impressions > 0, round(clicks * 100.0 / impressions, 2), 0) AS ctr
		FROM events
		WHERE created_at >= now() - toIntervalDay(?)
			AND event_type IN ('banner_impression', 'banner_click')
			AND referrer != ''
		GROUP BY referrer_domain
		HAVING referrer_domain != ''
		ORDER BY impressions DESC
		LIMIT 50
	`, days)
	if err != nil {
		return nil, fmt.Errorf("clickhouse reader: referrer stats: %w", err)
	}
	defer rows.Close()

	var result []ReferrerStat
	for rows.Next() {
		var s ReferrerStat
		if err := rows.Scan(&s.ReferrerDomain, &s.Impressions, &s.Clicks, &s.CTR); err != nil {
			return nil, fmt.Errorf("clickhouse reader: scan referrer stat: %w", err)
		}
		result = append(result, s)
	}
	if result == nil {
		result = []ReferrerStat{}
	}
	return result, rows.Err()
}

// ─── Traffic Explorer ────────────────────────────────────────────────────────

// allowedDimensions maps user-facing dimension names to ClickHouse column expressions.
var allowedDimensions = map[string]string{
	"date":         "toString(toDate(created_at))",
	"source":       "source",
	"referrer":     "domain(referrer)",
	"country":      "country",
	"device_type":  "device_type",
	"os":           "os",
	"browser":      "browser",
	"event_type":   "event_type",
	"utm_source":   "utm_source",
	"utm_medium":   "utm_medium",
	"utm_campaign": "utm_campaign",
}

var allowedTrafficSorts = map[string]string{
	"total_events":    "total_events",
	"impressions":     "impressions",
	"clicks":          "clicks",
	"profile_views":   "profile_views",
	"conversions":     "conversions",
	"unique_sessions": "unique_sessions",
	"ctr":             "ctr",
	"conversion_rate": "conversion_rate",
	"dimension1":      "dimension1",
	"dimension2":      "dimension2",
}

var allowedFilterColumns = map[string]string{
	"source":       "source",
	"country":      "country",
	"device_type":  "device_type",
	"os":           "os",
	"browser":      "browser",
	"event_type":   "event_type",
	"utm_source":   "utm_source",
	"utm_medium":   "utm_medium",
	"utm_campaign": "utm_campaign",
	"referrer":     "domain(referrer)",
}

// TrafficStatsParams holds validated query parameters for the traffic explorer.
type TrafficStatsParams struct {
	GroupBy  string
	GroupBy2 string
	Days     int
	Filters  map[string]string
	SortBy   string
	SortDir  string
}

// TrafficStatsRow represents one row in the traffic explorer results.
type TrafficStatsRow struct {
	Dimension1     string  `json:"dimension1"`
	Dimension2     string  `json:"dimension2,omitempty"`
	TotalEvents    uint64  `json:"total_events"`
	Impressions    uint64  `json:"impressions"`
	Clicks         uint64  `json:"clicks"`
	ProfileViews   uint64  `json:"profile_views"`
	Conversions    uint64  `json:"conversions"`
	UniqueSessions uint64  `json:"unique_sessions"`
	CTR            float64 `json:"ctr"`
	ConversionRate float64 `json:"conversion_rate"`
}

// TrafficStatsResult holds rows and summary.
type TrafficStatsResult struct {
	Rows     []TrafficStatsRow `json:"rows"`
	Summary  TrafficStatsRow   `json:"summary"`
	GroupBy  string            `json:"group_by"`
	GroupBy2 string            `json:"group_by2,omitempty"`
	Days     int               `json:"days"`
}

// GetTrafficStats queries ClickHouse with dynamic GROUP BY and filters.
func (r *Reader) GetTrafficStats(ctx context.Context, p TrafficStatsParams) (*TrafficStatsResult, error) {
	dim1Expr, ok := allowedDimensions[p.GroupBy]
	if !ok {
		return nil, fmt.Errorf("invalid group_by: %s", p.GroupBy)
	}

	selectCols := fmt.Sprintf("%s AS dimension1", dim1Expr)
	groupCols := "dimension1"
	hasSecondary := false

	if p.GroupBy2 != "" {
		dim2Expr, ok := allowedDimensions[p.GroupBy2]
		if !ok {
			return nil, fmt.Errorf("invalid group_by2: %s", p.GroupBy2)
		}
		selectCols += fmt.Sprintf(", %s AS dimension2", dim2Expr)
		groupCols += ", dimension2"
		hasSecondary = true
	}

	whereParts := []string{"created_at > now() - toIntervalDay(?)"}
	args := []interface{}{p.Days}

	for filterName, filterVal := range p.Filters {
		col, ok := allowedFilterColumns[filterName]
		if !ok {
			continue
		}
		whereParts = append(whereParts, fmt.Sprintf("%s = ?", col))
		args = append(args, filterVal)
	}

	whereClause := strings.Join(whereParts, " AND ")

	sortCol := "total_events"
	if sc, ok := allowedTrafficSorts[p.SortBy]; ok {
		sortCol = sc
	}
	sortDir := "DESC"
	if p.SortDir == "asc" {
		sortDir = "ASC"
	}

	query := fmt.Sprintf(`
		SELECT
			%s,
			count() AS total_events,
			countIf(event_type IN ('feed_impression', 'profile_thumb_impression', 'banner_impression')) AS impressions,
			countIf(event_type IN ('feed_click', 'click', 'profile_thumb_click', 'banner_click')) AS clicks,
			countIf(event_type = 'profile_view') AS profile_views,
			countIf(event_type IN ('social_click', 'content_click')) AS conversions,
			uniq(session_id) AS unique_sessions,
			if(impressions > 0, round(clicks * 100.0 / impressions, 2), 0) AS ctr,
			if(clicks > 0, round(conversions * 100.0 / clicks, 2), 0) AS conversion_rate
		FROM events
		WHERE %s
		GROUP BY %s
		ORDER BY %s %s
		LIMIT 500
	`, selectCols, whereClause, groupCols, sortCol, sortDir)

	rows, err := r.conn.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse reader: traffic stats: %w", err)
	}
	defer rows.Close()

	var result []TrafficStatsRow
	for rows.Next() {
		var row TrafficStatsRow
		var scanArgs []interface{}
		scanArgs = append(scanArgs, &row.Dimension1)
		if hasSecondary {
			scanArgs = append(scanArgs, &row.Dimension2)
		}
		scanArgs = append(scanArgs, &row.TotalEvents, &row.Impressions, &row.Clicks,
			&row.ProfileViews, &row.Conversions, &row.UniqueSessions, &row.CTR, &row.ConversionRate)

		if err := rows.Scan(scanArgs...); err != nil {
			return nil, fmt.Errorf("clickhouse reader: scan traffic stat: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse reader: traffic stats rows: %w", err)
	}
	if result == nil {
		result = []TrafficStatsRow{}
	}

	// Compute summary.
	var summary TrafficStatsRow
	for _, row := range result {
		summary.TotalEvents += row.TotalEvents
		summary.Impressions += row.Impressions
		summary.Clicks += row.Clicks
		summary.ProfileViews += row.ProfileViews
		summary.Conversions += row.Conversions
		summary.UniqueSessions += row.UniqueSessions
	}
	if summary.Impressions > 0 {
		summary.CTR = math.Round(float64(summary.Clicks)*10000/float64(summary.Impressions)) / 100
	}
	if summary.Clicks > 0 {
		summary.ConversionRate = math.Round(float64(summary.Conversions)*10000/float64(summary.Clicks)) / 100
	}

	return &TrafficStatsResult{
		Rows:     result,
		Summary:  summary,
		GroupBy:  p.GroupBy,
		GroupBy2: p.GroupBy2,
		Days:     p.Days,
	}, nil
}

// DimensionValues holds distinct values for a single dimension.
type DimensionValues struct {
	Dimension string   `json:"dimension"`
	Values    []string `json:"values"`
}

// GetTrafficDimensions returns distinct values for filterable dimensions.
func (r *Reader) GetTrafficDimensions(ctx context.Context, days int) ([]DimensionValues, error) {
	dims := []struct {
		name string
		expr string
	}{
		{"source", "source"},
		{"country", "country"},
		{"device_type", "device_type"},
		{"os", "os"},
		{"browser", "browser"},
		{"event_type", "event_type"},
		{"utm_source", "utm_source"},
		{"utm_medium", "utm_medium"},
		{"utm_campaign", "utm_campaign"},
	}

	var result []DimensionValues
	for _, d := range dims {
		query := fmt.Sprintf(`
			SELECT DISTINCT %s AS val
			FROM events
			WHERE created_at > now() - toIntervalDay(?)
				AND %s != ''
			ORDER BY val
			LIMIT 100
		`, d.expr, d.expr)

		rows, err := r.conn.Query(ctx, query, days)
		if err != nil {
			slog.Error("clickhouse: get dimension values", "error", err, "dimension", d.name)
			result = append(result, DimensionValues{Dimension: d.name, Values: []string{}})
			continue
		}

		var vals []string
		for rows.Next() {
			var v string
			if err := rows.Scan(&v); err != nil {
				continue
			}
			vals = append(vals, v)
		}
		rows.Close()
		if vals == nil {
			vals = []string{}
		}
		result = append(result, DimensionValues{Dimension: d.name, Values: vals})
	}

	return result, nil
}
