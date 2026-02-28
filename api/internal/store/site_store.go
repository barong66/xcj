package store

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xcj/videosite-api/internal/model"
)

type SiteStore struct {
	pool *pgxpool.Pool
}

func NewSiteStore(pool *pgxpool.Pool) *SiteStore {
	return &SiteStore{pool: pool}
}

func (s *SiteStore) GetByID(ctx context.Context, id int64) (*model.Site, error) {
	var site model.Site
	err := s.pool.QueryRow(ctx, `
		SELECT id, slug, domain, name, config, is_active, created_at, updated_at
		FROM sites WHERE id = $1
	`, id).Scan(
		&site.ID, &site.Slug, &site.Domain, &site.Name,
		&site.Config, &site.IsActive, &site.CreatedAt, &site.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("site_store: get by id: %w", err)
	}
	return &site, nil
}

func (s *SiteStore) GetByDomain(ctx context.Context, domain string) (*model.Site, error) {
	var site model.Site
	err := s.pool.QueryRow(ctx, `
		SELECT id, slug, domain, name, config, is_active, created_at, updated_at
		FROM sites WHERE domain = $1
	`, domain).Scan(
		&site.ID, &site.Slug, &site.Domain, &site.Name,
		&site.Config, &site.IsActive, &site.CreatedAt, &site.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("site_store: get by domain: %w", err)
	}
	return &site, nil
}
