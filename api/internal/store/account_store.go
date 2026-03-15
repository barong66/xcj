package store

import (
	"context"
	"encoding/json"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xcj/videosite-api/internal/model"
)

type AccountStore struct {
	pool *pgxpool.Pool
}

func NewAccountStore(pool *pgxpool.Pool) *AccountStore {
	return &AccountStore{pool: pool}
}

// GetByID returns an account by ID, including its videos for a given site.
func (s *AccountStore) GetByID(ctx context.Context, id int64, siteID int64, page, perPage int) (*model.Account, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 24
	}

	var a model.Account
	var socialLinksJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, platform, username, COALESCE(slug,''), COALESCE(display_name,''),
			COALESCE(avatar_url,''), COALESCE(bio,''), COALESCE(social_links, '{}')::text::bytea,
			is_paid, created_at
		FROM accounts WHERE id = $1
	`, id).Scan(
		&a.ID, &a.Platform, &a.Username, &a.Slug, &a.DisplayName,
		&a.AvatarURL, &a.Bio, &socialLinksJSON,
		&a.IsPaid, &a.CreatedAt,
	)
	if err == nil && len(socialLinksJSON) > 0 {
		_ = json.Unmarshal(socialLinksJSON, &a.SocialLinks)
	}
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("account_store: get by id: %w", err)
	}

	// Count total videos for this account on this site.
	err = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM videos v
		JOIN site_videos sv ON sv.video_id = v.id
		WHERE v.account_id = $1 AND sv.site_id = $2 AND v.is_active = true
	`, id, siteID).Scan(&a.VideoCount)
	if err != nil {
		return nil, fmt.Errorf("account_store: count videos: %w", err)
	}

	// Fetch paginated videos.
	offset := (page - 1) * perPage
	rows, err := s.pool.Query(ctx, `
		SELECT v.id, v.account_id, v.platform, v.platform_id, v.original_url,
			COALESCE(v.title,''), COALESCE(v.description,''), COALESCE(v.duration_sec,0), COALESCE(v.thumbnail_lg_url, v.thumbnail_url, ''), COALESCE(v.preview_url,''),
			COALESCE(v.width,0), COALESCE(v.height,0), v.country_id, COALESCE(v.view_count,0), COALESCE(v.click_count,0),
			v.is_active, v.is_promoted, v.promoted_until, COALESCE(v.promotion_weight,0),
			v.published_at, v.created_at
		FROM videos v
		JOIN site_videos sv ON sv.video_id = v.id
		WHERE v.account_id = $1 AND sv.site_id = $2 AND v.is_active = true
		ORDER BY v.published_at DESC NULLS LAST, v.created_at DESC
		LIMIT $3 OFFSET $4
	`, id, siteID, perPage, offset)
	if err != nil {
		return nil, fmt.Errorf("account_store: list videos: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var v model.Video
		if err := rows.Scan(
			&v.ID, &v.AccountID, &v.Platform, &v.PlatformID, &v.OriginalURL,
			&v.Title, &v.Description, &v.DurationSec, &v.ThumbnailURL, &v.PreviewURL,
			&v.Width, &v.Height, &v.CountryID, &v.ViewCount, &v.ClickCount,
			&v.IsActive, &v.IsPromoted, &v.PromotedUntil, &v.PromotionWeight,
			&v.PublishedAt, &v.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("account_store: scan video: %w", err)
		}
		a.Videos = append(a.Videos, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("account_store: rows: %w", err)
	}

	_ = math.Ceil(float64(a.VideoCount) / float64(perPage))

	return &a, nil
}

// AccountSummary is a lightweight account representation for list views.
type AccountSummary struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	Slug        string `json:"slug"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
}

// List returns accounts linked to a site that have avatars, sorted by video count desc.
func (s *AccountStore) List(ctx context.Context, siteID int64, limit int) ([]AccountSummary, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}

	rows, err := s.pool.Query(ctx, `
		SELECT a.id, a.username, COALESCE(a.slug,''), COALESCE(a.display_name,''), a.avatar_url
		FROM accounts a
		JOIN videos v ON v.account_id = a.id
		JOIN site_videos sv ON sv.video_id = v.id
		WHERE sv.site_id = $1 AND a.avatar_url IS NOT NULL AND a.avatar_url != '' AND a.is_active = true AND v.is_active = true
		GROUP BY a.id, a.username, a.slug, a.display_name, a.avatar_url
		ORDER BY COUNT(v.id) DESC
		LIMIT $2
	`, siteID, limit)
	if err != nil {
		return nil, fmt.Errorf("account_store: list: %w", err)
	}
	defer rows.Close()

	var accounts []AccountSummary
	for rows.Next() {
		var a AccountSummary
		if err := rows.Scan(&a.ID, &a.Username, &a.Slug, &a.DisplayName, &a.AvatarURL); err != nil {
			return nil, fmt.Errorf("account_store: list scan: %w", err)
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

// GetBySlug returns an account by slug, including its videos for a given site.
func (s *AccountStore) GetBySlug(ctx context.Context, slug string, siteID int64, page, perPage int) (*model.Account, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 24
	}

	var a model.Account
	var socialLinksJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, platform, username, COALESCE(slug,''), COALESCE(display_name,''),
			COALESCE(avatar_url,''), COALESCE(bio,''), COALESCE(social_links, '{}')::text::bytea,
			is_paid, created_at
		FROM accounts WHERE COALESCE(slug, username) = $1
	`, slug).Scan(
		&a.ID, &a.Platform, &a.Username, &a.Slug, &a.DisplayName,
		&a.AvatarURL, &a.Bio, &socialLinksJSON,
		&a.IsPaid, &a.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("account_store: get by slug: %w", err)
	}
	if len(socialLinksJSON) > 0 {
		_ = json.Unmarshal(socialLinksJSON, &a.SocialLinks)
	}

	// Count total videos for this account on this site.
	err = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM videos v
		JOIN site_videos sv ON sv.video_id = v.id
		WHERE v.account_id = $1 AND sv.site_id = $2 AND v.is_active = true
	`, a.ID, siteID).Scan(&a.VideoCount)
	if err != nil {
		return nil, fmt.Errorf("account_store: count videos: %w", err)
	}

	// Fetch paginated videos.
	offset := (page - 1) * perPage
	rows, err := s.pool.Query(ctx, `
		SELECT v.id, v.account_id, v.platform, v.platform_id, v.original_url,
			COALESCE(v.title,''), COALESCE(v.description,''), COALESCE(v.duration_sec,0), COALESCE(v.thumbnail_lg_url, v.thumbnail_url, ''), COALESCE(v.preview_url,''),
			COALESCE(v.width,0), COALESCE(v.height,0), v.country_id, COALESCE(v.view_count,0), COALESCE(v.click_count,0),
			v.is_active, v.is_promoted, v.promoted_until, COALESCE(v.promotion_weight,0),
			v.published_at, v.created_at
		FROM videos v
		JOIN site_videos sv ON sv.video_id = v.id
		WHERE v.account_id = $1 AND sv.site_id = $2 AND v.is_active = true
		ORDER BY v.published_at DESC NULLS LAST, v.created_at DESC
		LIMIT $3 OFFSET $4
	`, a.ID, siteID, perPage, offset)
	if err != nil {
		return nil, fmt.Errorf("account_store: list videos: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var v model.Video
		if err := rows.Scan(
			&v.ID, &v.AccountID, &v.Platform, &v.PlatformID, &v.OriginalURL,
			&v.Title, &v.Description, &v.DurationSec, &v.ThumbnailURL, &v.PreviewURL,
			&v.Width, &v.Height, &v.CountryID, &v.ViewCount, &v.ClickCount,
			&v.IsActive, &v.IsPromoted, &v.PromotedUntil, &v.PromotionWeight,
			&v.PublishedAt, &v.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("account_store: scan video: %w", err)
		}
		a.Videos = append(a.Videos, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("account_store: rows: %w", err)
	}

	return &a, nil
}
