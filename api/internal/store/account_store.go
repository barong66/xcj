package store

import (
	"context"
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
	err := s.pool.QueryRow(ctx, `
		SELECT id, platform, username, COALESCE(display_name,''), COALESCE(avatar_url,''), is_paid, created_at
		FROM accounts WHERE id = $1
	`, id).Scan(
		&a.ID, &a.Platform, &a.Username, &a.DisplayName,
		&a.AvatarURL, &a.IsPaid, &a.CreatedAt,
	)
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
			COALESCE(v.title,''), COALESCE(v.description,''), v.duration_sec, COALESCE(v.thumbnail_lg_url, v.thumbnail_url, ''), COALESCE(v.preview_url,''),
			v.width, v.height, v.country_id, v.view_count, v.click_count,
			v.is_active, v.is_promoted, v.promoted_until, v.promotion_weight,
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
