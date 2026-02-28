package store

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xcj/videosite-api/internal/model"
)

type CategoryStore struct {
	pool *pgxpool.Pool
}

func NewCategoryStore(pool *pgxpool.Pool) *CategoryStore {
	return &CategoryStore{pool: pool}
}

// ListForSite returns all active categories associated with a site,
// ordered by sort_order.
func (s *CategoryStore) ListForSite(ctx context.Context, siteID int64) ([]model.Category, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.slug, c.name, c.parent_id, c.is_active, c.sort_order,
			COUNT(DISTINCT vc.video_id) AS video_count
		FROM categories c
		JOIN site_categories sc ON sc.category_id = c.id
		LEFT JOIN video_categories vc ON vc.category_id = c.id
		LEFT JOIN site_videos sv ON sv.video_id = vc.video_id AND sv.site_id = sc.site_id
		WHERE sc.site_id = $1 AND c.is_active = true
		GROUP BY c.id, c.slug, c.name, c.parent_id, c.is_active, c.sort_order
		ORDER BY c.sort_order, c.name
	`, siteID)
	if err != nil {
		return nil, fmt.Errorf("category_store: list: %w", err)
	}
	defer rows.Close()

	var categories []model.Category
	for rows.Next() {
		var c model.Category
		if err := rows.Scan(
			&c.ID, &c.Slug, &c.Name, &c.ParentID,
			&c.IsActive, &c.SortOrder, &c.VideoCount,
		); err != nil {
			return nil, fmt.Errorf("category_store: scan: %w", err)
		}
		categories = append(categories, c)
	}

	return categories, rows.Err()
}

// GetBySlug returns a single category by slug for a site, including its video count.
func (s *CategoryStore) GetBySlug(ctx context.Context, siteID int64, slug string) (*model.Category, error) {
	var c model.Category
	err := s.pool.QueryRow(ctx, `
		SELECT c.id, c.slug, c.name, c.parent_id, c.is_active, c.sort_order,
			COUNT(DISTINCT vc.video_id) AS video_count
		FROM categories c
		JOIN site_categories sc ON sc.category_id = c.id
		LEFT JOIN video_categories vc ON vc.category_id = c.id
		LEFT JOIN site_videos sv ON sv.video_id = vc.video_id AND sv.site_id = sc.site_id
		WHERE sc.site_id = $1 AND c.slug = $2 AND c.is_active = true
		GROUP BY c.id, c.slug, c.name, c.parent_id, c.is_active, c.sort_order
	`, siteID, slug).Scan(
		&c.ID, &c.Slug, &c.Name, &c.ParentID,
		&c.IsActive, &c.SortOrder, &c.VideoCount,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("category_store: get by slug: %w", err)
	}
	return &c, nil
}
