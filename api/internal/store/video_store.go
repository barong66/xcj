package store

import (
	"context"
	"fmt"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xcj/videosite-api/internal/model"
)

type VideoStore struct {
	pool *pgxpool.Pool
}

func NewVideoStore(pool *pgxpool.Pool) *VideoStore {
	return &VideoStore{pool: pool}
}

// List returns a paginated, filtered, and sorted list of videos for a site.
func (s *VideoStore) List(ctx context.Context, params model.VideoListParams) (*model.VideoListResult, error) {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.PerPage < 1 || params.PerPage > 100 {
		params.PerPage = 24
	}

	var (
		conditions []string
		args       []interface{}
		argIdx     int
	)

	nextArg := func(val interface{}) string {
		argIdx++
		args = append(args, val)
		return fmt.Sprintf("$%d", argIdx)
	}

	conditions = append(conditions, "sv.site_id = "+nextArg(params.SiteID))
	conditions = append(conditions, "v.is_active = true")

	if params.CategoryID != nil {
		conditions = append(conditions, "vc.category_id = "+nextArg(*params.CategoryID))
	}

	if params.CountryID != nil {
		conditions = append(conditions, "v.country_id = "+nextArg(*params.CountryID))
	}

	whereClause := "WHERE " + strings.Join(conditions, " AND ")

	joinClause := "JOIN site_videos sv ON sv.video_id = v.id"
	if params.CategoryID != nil {
		joinClause += " JOIN video_categories vc ON vc.video_id = v.id"
	}

	// Count total matching records.
	countQuery := fmt.Sprintf("SELECT COUNT(DISTINCT v.id) FROM videos v %s %s", joinClause, whereClause)
	var total int64
	if err := s.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("video_store: count: %w", err)
	}

	// Build ORDER BY clause.
	var orderBy string
	switch params.Sort {
	case "popular":
		orderBy = "ORDER BY v.view_count DESC, v.id DESC"
	case "random":
		orderBy = "ORDER BY RANDOM()"
	case "promoted":
		orderBy = "ORDER BY v.is_promoted DESC, v.promotion_weight DESC, v.view_count DESC"
	default: // "recent"
		orderBy = "ORDER BY v.published_at DESC NULLS LAST, v.created_at DESC"
	}

	offset := (params.Page - 1) * params.PerPage

	selectQuery := fmt.Sprintf(`
		SELECT DISTINCT v.id, v.account_id, v.platform, v.platform_id, v.original_url,
			COALESCE(v.title,''), COALESCE(v.description,''), v.duration_sec, COALESCE(v.thumbnail_lg_url, v.thumbnail_url, ''), COALESCE(v.preview_url,''),
			v.width, v.height, v.country_id, v.view_count, v.click_count,
			v.is_active, v.is_promoted, v.promoted_until, v.promotion_weight,
			v.published_at, v.created_at
		FROM videos v %s %s %s
		LIMIT %s OFFSET %s
	`, joinClause, whereClause, orderBy, nextArg(params.PerPage), nextArg(offset))

	rows, err := s.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("video_store: list: %w", err)
	}
	defer rows.Close()

	videos := make([]model.Video, 0)
	for rows.Next() {
		var v model.Video
		if err := rows.Scan(
			&v.ID, &v.AccountID, &v.Platform, &v.PlatformID, &v.OriginalURL,
			&v.Title, &v.Description, &v.DurationSec, &v.ThumbnailURL, &v.PreviewURL,
			&v.Width, &v.Height, &v.CountryID, &v.ViewCount, &v.ClickCount,
			&v.IsActive, &v.IsPromoted, &v.PromotedUntil, &v.PromotionWeight,
			&v.PublishedAt, &v.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("video_store: scan: %w", err)
		}
		videos = append(videos, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("video_store: rows: %w", err)
	}

	// Load categories for each video.
	if err := s.loadCategories(ctx, videos); err != nil {
		return nil, err
	}

	// Load accounts for each video.
	if err := s.loadAccounts(ctx, videos); err != nil {
		return nil, err
	}

	totalPages := int(math.Ceil(float64(total) / float64(params.PerPage)))

	return &model.VideoListResult{
		Videos:     videos,
		Total:      total,
		Page:       params.Page,
		PerPage:    params.PerPage,
		TotalPages: totalPages,
	}, nil
}

// GetByID returns a single video by its ID, including categories and account info.
func (s *VideoStore) GetByID(ctx context.Context, id int64) (*model.Video, error) {
	var v model.Video
	err := s.pool.QueryRow(ctx, `
		SELECT v.id, v.account_id, v.platform, v.platform_id, v.original_url,
			COALESCE(v.title,''), COALESCE(v.description,''), v.duration_sec, COALESCE(v.thumbnail_lg_url, v.thumbnail_url, ''), COALESCE(v.preview_url,''),
			v.width, v.height, v.country_id, v.view_count, v.click_count,
			v.is_active, v.is_promoted, v.promoted_until, v.promotion_weight,
			v.published_at, v.created_at
		FROM videos v
		WHERE v.id = $1 AND v.is_active = true
	`, id).Scan(
		&v.ID, &v.AccountID, &v.Platform, &v.PlatformID, &v.OriginalURL,
		&v.Title, &v.Description, &v.DurationSec, &v.ThumbnailURL, &v.PreviewURL,
		&v.Width, &v.Height, &v.CountryID, &v.ViewCount, &v.ClickCount,
		&v.IsActive, &v.IsPromoted, &v.PromotedUntil, &v.PromotionWeight,
		&v.PublishedAt, &v.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("video_store: get by id: %w", err)
	}

	// Load categories.
	videos := []model.Video{v}
	if err := s.loadCategories(ctx, videos); err != nil {
		return nil, err
	}
	v.Categories = videos[0].Categories

	// Load account.
	account, err := s.loadAccount(ctx, v.AccountID)
	if err != nil {
		return nil, err
	}
	v.Account = account

	return &v, nil
}

// Search performs a text search on video title and description.
func (s *VideoStore) Search(ctx context.Context, siteID int64, query string, page, perPage int) (*model.VideoListResult, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 24
	}

	tsQuery := strings.Join(strings.Fields(query), " & ")
	offset := (page - 1) * perPage

	var total int64
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT v.id)
		FROM videos v
		JOIN site_videos sv ON sv.video_id = v.id
		WHERE sv.site_id = $1
			AND v.is_active = true
			AND (
				to_tsvector('english', v.title || ' ' || v.description) @@ to_tsquery('english', $2)
				OR v.title ILIKE '%' || $3 || '%'
			)
	`, siteID, tsQuery, query).Scan(&total)
	if err != nil {
		return nil, fmt.Errorf("video_store: search count: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT v.id, v.account_id, v.platform, v.platform_id, v.original_url,
			COALESCE(v.title,''), COALESCE(v.description,''), v.duration_sec, COALESCE(v.thumbnail_lg_url, v.thumbnail_url, ''), COALESCE(v.preview_url,''),
			v.width, v.height, v.country_id, v.view_count, v.click_count,
			v.is_active, v.is_promoted, v.promoted_until, v.promotion_weight,
			v.published_at, v.created_at
		FROM videos v
		JOIN site_videos sv ON sv.video_id = v.id
		WHERE sv.site_id = $1
			AND v.is_active = true
			AND (
				to_tsvector('english', v.title || ' ' || v.description) @@ to_tsquery('english', $2)
				OR v.title ILIKE '%' || $3 || '%'
			)
		ORDER BY v.view_count DESC
		LIMIT $4 OFFSET $5
	`, siteID, tsQuery, query, perPage, offset)
	if err != nil {
		return nil, fmt.Errorf("video_store: search: %w", err)
	}
	defer rows.Close()

	videos := make([]model.Video, 0)
	for rows.Next() {
		var v model.Video
		if err := rows.Scan(
			&v.ID, &v.AccountID, &v.Platform, &v.PlatformID, &v.OriginalURL,
			&v.Title, &v.Description, &v.DurationSec, &v.ThumbnailURL, &v.PreviewURL,
			&v.Width, &v.Height, &v.CountryID, &v.ViewCount, &v.ClickCount,
			&v.IsActive, &v.IsPromoted, &v.PromotedUntil, &v.PromotionWeight,
			&v.PublishedAt, &v.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("video_store: search scan: %w", err)
		}
		videos = append(videos, v)
	}

	if err := s.loadCategories(ctx, videos); err != nil {
		return nil, err
	}

	// Load accounts for each video.
	if err := s.loadAccounts(ctx, videos); err != nil {
		return nil, err
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))

	return &model.VideoListResult{
		Videos:     videos,
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: totalPages,
	}, nil
}

// loadCategories batch-loads categories for a slice of videos.
func (s *VideoStore) loadCategories(ctx context.Context, videos []model.Video) error {
	if len(videos) == 0 {
		return nil
	}

	ids := make([]int64, len(videos))
	idxMap := make(map[int64]int, len(videos))
	for i, v := range videos {
		ids[i] = v.ID
		idxMap[v.ID] = i
		videos[i].Categories = []model.VideoCategory{}
	}

	rows, err := s.pool.Query(ctx, `
		SELECT vc.video_id, vc.category_id, c.slug, c.name, vc.confidence
		FROM video_categories vc
		JOIN categories c ON c.id = vc.category_id
		WHERE vc.video_id = ANY($1)
		ORDER BY vc.confidence DESC
	`, ids)
	if err != nil {
		return fmt.Errorf("video_store: load categories: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var videoID int64
		var vc model.VideoCategory
		if err := rows.Scan(&videoID, &vc.CategoryID, &vc.Slug, &vc.Name, &vc.Confidence); err != nil {
			return fmt.Errorf("video_store: scan category: %w", err)
		}
		if idx, ok := idxMap[videoID]; ok {
			videos[idx].Categories = append(videos[idx].Categories, vc)
		}
	}

	return rows.Err()
}

// loadAccounts batch-loads accounts for a slice of videos.
func (s *VideoStore) loadAccounts(ctx context.Context, videos []model.Video) error {
	if len(videos) == 0 {
		return nil
	}

	// Collect unique account IDs.
	accountIDs := make([]int64, 0)
	seen := make(map[int64]bool)
	for _, v := range videos {
		if !seen[v.AccountID] {
			seen[v.AccountID] = true
			accountIDs = append(accountIDs, v.AccountID)
		}
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, platform, username, COALESCE(display_name,''), COALESCE(avatar_url,''), is_paid, created_at
		FROM accounts WHERE id = ANY($1)
	`, accountIDs)
	if err != nil {
		return fmt.Errorf("video_store: load accounts: %w", err)
	}
	defer rows.Close()

	accountMap := make(map[int64]*model.Account)
	for rows.Next() {
		var a model.Account
		if err := rows.Scan(&a.ID, &a.Platform, &a.Username, &a.DisplayName, &a.AvatarURL, &a.IsPaid, &a.CreatedAt); err != nil {
			return fmt.Errorf("video_store: scan account: %w", err)
		}
		accountMap[a.ID] = &a
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("video_store: accounts rows: %w", err)
	}

	for i := range videos {
		if acc, ok := accountMap[videos[i].AccountID]; ok {
			videos[i].Account = acc
		}
	}

	return nil
}

func (s *VideoStore) loadAccount(ctx context.Context, accountID int64) (*model.Account, error) {
	var a model.Account
	err := s.pool.QueryRow(ctx, `
		SELECT id, platform, username, COALESCE(display_name,''), COALESCE(avatar_url,''), is_paid, created_at
		FROM accounts WHERE id = $1
	`, accountID).Scan(
		&a.ID, &a.Platform, &a.Username, &a.DisplayName,
		&a.AvatarURL, &a.IsPaid, &a.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("video_store: load account: %w", err)
	}
	return &a, nil
}
