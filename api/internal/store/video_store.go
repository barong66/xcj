package store

import (
	"context"
	"encoding/json"
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

	if params.ExcludeAccountID != nil {
		conditions = append(conditions, "v.account_id != "+nextArg(*params.ExcludeAccountID))
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
		SELECT v.id, v.account_id, v.platform, v.platform_id, v.original_url,
			COALESCE(v.title,''), COALESCE(v.description,''), v.duration_sec, COALESCE(v.thumbnail_lg_url, v.thumbnail_url, ''), COALESCE(v.preview_url,''),
			v.width, v.height, v.country_id, v.view_count, v.click_count,
			v.is_active, v.is_promoted, v.promoted_until, v.promotion_weight,
			v.published_at, v.created_at
		FROM videos v %s %s
		GROUP BY v.id
		%s
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
		SELECT id, platform, username, COALESCE(slug,''), COALESCE(display_name,''), COALESCE(avatar_url,''),
			COALESCE(social_links, '{}')::text::bytea, is_paid, created_at
		FROM accounts WHERE id = ANY($1)
	`, accountIDs)
	if err != nil {
		return fmt.Errorf("video_store: load accounts: %w", err)
	}
	defer rows.Close()

	accountMap := make(map[int64]*model.Account)
	for rows.Next() {
		var a model.Account
		var socialLinksJSON []byte
		if err := rows.Scan(&a.ID, &a.Platform, &a.Username, &a.Slug, &a.DisplayName, &a.AvatarURL, &socialLinksJSON, &a.IsPaid, &a.CreatedAt); err != nil {
			return fmt.Errorf("video_store: scan account: %w", err)
		}
		if len(socialLinksJSON) > 0 {
			_ = json.Unmarshal(socialLinksJSON, &a.SocialLinks)
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
	var socialLinksJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, platform, username, COALESCE(slug,''), COALESCE(display_name,''), COALESCE(avatar_url,''),
			COALESCE(social_links, '{}')::text::bytea, is_paid, created_at
		FROM accounts WHERE id = $1
	`, accountID).Scan(
		&a.ID, &a.Platform, &a.Username, &a.Slug, &a.DisplayName,
		&a.AvatarURL, &socialLinksJSON, &a.IsPaid, &a.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("video_store: load account: %w", err)
	}
	if len(socialLinksJSON) > 0 {
		_ = json.Unmarshal(socialLinksJSON, &a.SocialLinks)
	}
	return &a, nil
}

// ListIDs returns only video IDs for a site, ordered by recent. Used for ranking candidate selection.
func (s *VideoStore) ListIDs(ctx context.Context, siteID int64, limit int) ([]int64, error) {
	if limit < 1 || limit > 500 {
		limit = 200
	}

	rows, err := s.pool.Query(ctx, `
		SELECT v.id
		FROM videos v
		JOIN site_videos sv ON sv.video_id = v.id
		WHERE sv.site_id = $1 AND v.is_active = true
		ORDER BY v.published_at DESC NULLS LAST, v.created_at DESC
		LIMIT $2
	`, siteID, limit)
	if err != nil {
		return nil, fmt.Errorf("video_store: list ids: %w", err)
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("video_store: scan id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// GetByIDs returns full video objects for a list of IDs, preserving the input order.
func (s *VideoStore) GetByIDs(ctx context.Context, ids []int64) ([]model.Video, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	rows, err := s.pool.Query(ctx, `
		SELECT v.id, v.account_id, v.platform, v.platform_id, v.original_url,
			COALESCE(v.title,''), COALESCE(v.description,''), v.duration_sec, COALESCE(v.thumbnail_lg_url, v.thumbnail_url, ''), COALESCE(v.preview_url,''),
			v.width, v.height, v.country_id, v.view_count, v.click_count,
			v.is_active, v.is_promoted, v.promoted_until, v.promotion_weight,
			v.published_at, v.created_at
		FROM videos v
		WHERE v.id = ANY($1) AND v.is_active = true
	`, ids)
	if err != nil {
		return nil, fmt.Errorf("video_store: get by ids: %w", err)
	}
	defer rows.Close()

	videoMap := make(map[int64]model.Video, len(ids))
	for rows.Next() {
		var v model.Video
		if err := rows.Scan(
			&v.ID, &v.AccountID, &v.Platform, &v.PlatformID, &v.OriginalURL,
			&v.Title, &v.Description, &v.DurationSec, &v.ThumbnailURL, &v.PreviewURL,
			&v.Width, &v.Height, &v.CountryID, &v.ViewCount, &v.ClickCount,
			&v.IsActive, &v.IsPromoted, &v.PromotedUntil, &v.PromotionWeight,
			&v.PublishedAt, &v.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("video_store: scan by ids: %w", err)
		}
		videoMap[v.ID] = v
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("video_store: get by ids rows: %w", err)
	}

	// Preserve input order.
	videos := make([]model.Video, 0, len(ids))
	for _, id := range ids {
		if v, ok := videoMap[id]; ok {
			videos = append(videos, v)
		}
	}

	if err := s.loadCategories(ctx, videos); err != nil {
		return nil, err
	}
	if err := s.loadAccounts(ctx, videos); err != nil {
		return nil, err
	}

	return videos, nil
}

// ListIDsByCategories returns video IDs matching any of the given categories for a site.
func (s *VideoStore) ListIDsByCategories(ctx context.Context, siteID int64, categoryIDs []int64, excludeVideoID int64, limit int) ([]int64, error) {
	if len(categoryIDs) == 0 || limit < 1 {
		return nil, nil
	}

	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT v.id
		FROM videos v
		JOIN site_videos sv ON sv.video_id = v.id
		JOIN video_categories vc ON vc.video_id = v.id
		WHERE sv.site_id = $1
			AND vc.category_id = ANY($2)
			AND v.id != $3
			AND v.is_active = true
		LIMIT $4
	`, siteID, categoryIDs, excludeVideoID, limit)
	if err != nil {
		return nil, fmt.Errorf("video_store: list ids by categories: %w", err)
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("video_store: scan cat id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// GetAccountCategoryIDs returns unique category IDs for all videos belonging to an account on a site.
func (s *VideoStore) GetAccountCategoryIDs(ctx context.Context, accountID, siteID int64) ([]int64, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT vc.category_id
		FROM video_categories vc
		JOIN videos v ON v.id = vc.video_id
		JOIN site_videos sv ON sv.video_id = v.id
		WHERE v.account_id = $1 AND sv.site_id = $2 AND v.is_active = true
	`, accountID, siteID)
	if err != nil {
		return nil, fmt.Errorf("video_store: account category ids: %w", err)
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("video_store: scan account cat id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// GetLatestVideoIDByAccount returns the most recent video ID for an account on a site.
func (s *VideoStore) GetLatestVideoIDByAccount(ctx context.Context, accountID, siteID int64) (int64, error) {
	var id int64
	err := s.pool.QueryRow(ctx, `
		SELECT v.id
		FROM videos v
		JOIN site_videos sv ON sv.video_id = v.id
		WHERE v.account_id = $1 AND sv.site_id = $2 AND v.is_active = true
		ORDER BY v.published_at DESC NULLS LAST, v.created_at DESC
		LIMIT 1
	`, accountID, siteID).Scan(&id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, nil
		}
		return 0, fmt.Errorf("video_store: latest video by account: %w", err)
	}
	return id, nil
}
