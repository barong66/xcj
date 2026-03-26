package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ChatConfig holds the data needed to build a Grok system prompt for a model.
type ChatConfig struct {
	AccountID   int64
	Name        string
	Username    string
	Country     string
	Categories  []string
	SocialLinks map[string]string
	ChatPrompt  *string // nil = auto-generate
	ChatAdText  *string // nil = use social links
}

// ChatStore queries account data needed for the chat feature.
type ChatStore struct {
	pool *pgxpool.Pool
}

// NewChatStore creates a ChatStore.
func NewChatStore(pool *pgxpool.Pool) *ChatStore {
	return &ChatStore{pool: pool}
}

// GetChatConfig returns chat configuration for an account by slug.
// Returns nil, nil if the account doesn't exist or chat is disabled.
func (s *ChatStore) GetChatConfig(ctx context.Context, siteID int64, slug string) (*ChatConfig, error) {
	var cfg ChatConfig
	var socialLinksJSON []byte
	var categoriesJSON []byte

	err := s.pool.QueryRow(ctx, `
		SELECT
			a.id,
			COALESCE(a.display_name, a.username),
			a.username,
			COALESCE(co.name, ''),
			COALESCE(a.social_links, '{}'),
			COALESCE(
				(SELECT jsonb_agg(DISTINCT c.name)
				 FROM video_categories vc
				 JOIN categories c ON c.id = vc.category_id
				 JOIN videos v ON v.id = vc.video_id
				 WHERE v.account_id = a.id
				 LIMIT 5),
				'[]'
			),
			a.chat_prompt,
			a.chat_ad_text
		FROM accounts a
		LEFT JOIN countries co ON co.id = a.country_id
		WHERE (a.slug = $1 OR a.username = $1)
		  AND a.is_active = true
		  AND a.chat_enabled = true
		  AND EXISTS (
			  SELECT 1 FROM videos v
			  JOIN site_videos sv ON sv.video_id = v.id
			  WHERE v.account_id = a.id AND sv.site_id = $2
		  )
	`, slug, siteID).Scan(
		&cfg.AccountID,
		&cfg.Name,
		&cfg.Username,
		&cfg.Country,
		&socialLinksJSON,
		&categoriesJSON,
		&cfg.ChatPrompt,
		&cfg.ChatAdText,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	// Unmarshal JSON fields (unmarshalJSON is defined in helpers.go)
	if err := unmarshalJSON(socialLinksJSON, &cfg.SocialLinks); err != nil {
		cfg.SocialLinks = map[string]string{}
	}
	if err := unmarshalJSON(categoriesJSON, &cfg.Categories); err != nil {
		cfg.Categories = []string{}
	}

	return &cfg, nil
}
