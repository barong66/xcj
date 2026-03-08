package store

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AdminStore struct {
	pool *pgxpool.Pool
}

func NewAdminStore(pool *pgxpool.Pool) *AdminStore {
	return &AdminStore{pool: pool}
}

// ─── Stats ───────────────────────────────────────────────────────────────────

type AdminStats struct {
	TotalVideos      int64                   `json:"total_videos"`
	ActiveVideos     int64                   `json:"active_videos"`
	InactiveVideos   int64                   `json:"inactive_videos"`
	TotalAccounts    int64                   `json:"total_accounts"`
	AccountsByPlatform []PlatformAccountCount `json:"accounts_by_platform"`
	QueuePending     int64                   `json:"queue_pending"`
	QueueRunning     int64                   `json:"queue_running"`
	QueueDone        int64                   `json:"queue_done"`
	QueueFailed      int64                   `json:"queue_failed"`
	Uncategorized    int64                   `json:"uncategorized"`
	VideosToday      int64                   `json:"videos_today"`
	VideosThisWeek   int64                   `json:"videos_this_week"`
}

type PlatformAccountCount struct {
	Platform string `json:"platform"`
	Total    int64  `json:"total"`
	Active   int64  `json:"active"`
}

func (s *AdminStore) GetStats(ctx context.Context) (*AdminStats, error) {
	var stats AdminStats

	// Videos counts.
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM videos`).Scan(&stats.TotalVideos)
	if err != nil {
		return nil, fmt.Errorf("admin_store: total videos: %w", err)
	}
	err = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM videos WHERE is_active = true`).Scan(&stats.ActiveVideos)
	if err != nil {
		return nil, fmt.Errorf("admin_store: active videos: %w", err)
	}
	stats.InactiveVideos = stats.TotalVideos - stats.ActiveVideos

	// Accounts.
	err = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM accounts`).Scan(&stats.TotalAccounts)
	if err != nil {
		return nil, fmt.Errorf("admin_store: total accounts: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT platform, COUNT(*) AS total,
			COUNT(*) FILTER (WHERE is_active = true) AS active
		FROM accounts GROUP BY platform ORDER BY platform
	`)
	if err != nil {
		return nil, fmt.Errorf("admin_store: accounts by platform: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var p PlatformAccountCount
		if err := rows.Scan(&p.Platform, &p.Total, &p.Active); err != nil {
			return nil, fmt.Errorf("admin_store: scan platform count: %w", err)
		}
		stats.AccountsByPlatform = append(stats.AccountsByPlatform, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin_store: platform rows: %w", err)
	}

	// Queue counts.
	queueRows, err := s.pool.Query(ctx, `SELECT status, COUNT(*) FROM parse_queue GROUP BY status`)
	if err != nil {
		return nil, fmt.Errorf("admin_store: queue counts: %w", err)
	}
	defer queueRows.Close()
	for queueRows.Next() {
		var status string
		var count int64
		if err := queueRows.Scan(&status, &count); err != nil {
			return nil, fmt.Errorf("admin_store: scan queue count: %w", err)
		}
		switch status {
		case "pending":
			stats.QueuePending = count
		case "running":
			stats.QueueRunning = count
		case "done":
			stats.QueueDone = count
		case "failed":
			stats.QueueFailed = count
		}
	}
	if err := queueRows.Err(); err != nil {
		return nil, fmt.Errorf("admin_store: queue rows: %w", err)
	}

	// Uncategorized.
	err = s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM videos WHERE ai_processed_at IS NULL AND is_active = true`,
	).Scan(&stats.Uncategorized)
	if err != nil {
		return nil, fmt.Errorf("admin_store: uncategorized: %w", err)
	}

	// Videos today / this week.
	err = s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM videos WHERE created_at >= CURRENT_DATE`,
	).Scan(&stats.VideosToday)
	if err != nil {
		return nil, fmt.Errorf("admin_store: videos today: %w", err)
	}
	err = s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM videos WHERE created_at >= date_trunc('week', CURRENT_DATE)`,
	).Scan(&stats.VideosThisWeek)
	if err != nil {
		return nil, fmt.Errorf("admin_store: videos this week: %w", err)
	}

	return &stats, nil
}

// ─── Accounts ────────────────────────────────────────────────────────────────

type AdminAccount struct {
	ID            int64             `json:"id"`
	Platform      string            `json:"platform"`
	Username      string            `json:"username"`
	Slug          string            `json:"slug"`
	DisplayName   string            `json:"display_name"`
	AvatarURL     string            `json:"avatar_url"`
	Bio           string            `json:"bio"`
	SocialLinks   map[string]string `json:"social_links"`
	IsActive      bool              `json:"is_active"`
	IsPaid        bool              `json:"is_paid"`
	PaidUntil     *time.Time        `json:"paid_until,omitempty"`
	FollowerCount int64             `json:"follower_count"`
	LastParsedAt  *time.Time        `json:"last_parsed_at,omitempty"`
	ParseErrors   int               `json:"parse_errors"`
	VideoCount    int64             `json:"video_count"`
	CreatedAt     time.Time         `json:"created_at"`
}

type AdminAccountList struct {
	Accounts   []AdminAccount `json:"accounts"`
	Total      int64          `json:"total"`
	Page       int            `json:"page"`
	PerPage    int            `json:"per_page"`
	TotalPages int            `json:"total_pages"`
}

func (s *AdminStore) ListAccounts(ctx context.Context, platform, status, paid string, page, perPage int) (*AdminAccountList, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	conditions := []string{}
	args := []interface{}{}
	argIdx := 0

	nextArg := func(val interface{}) string {
		argIdx++
		args = append(args, val)
		return fmt.Sprintf("$%d", argIdx)
	}

	if platform != "" {
		conditions = append(conditions, "a.platform = "+nextArg(platform))
	}
	if status == "active" {
		conditions = append(conditions, "a.is_active = true")
	} else if status == "inactive" {
		conditions = append(conditions, "a.is_active = false")
	}
	if paid == "paid" {
		conditions = append(conditions, "a.is_paid = true")
	} else if paid == "free" {
		conditions = append(conditions, "a.is_paid = false")
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE "
		for i, c := range conditions {
			if i > 0 {
				whereClause += " AND "
			}
			whereClause += c
		}
	}

	// Count.
	var total int64
	countQ := fmt.Sprintf("SELECT COUNT(*) FROM accounts a %s", whereClause)
	if err := s.pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("admin_store: count accounts: %w", err)
	}

	offset := (page - 1) * perPage
	selectQ := fmt.Sprintf(`
		SELECT a.id, a.platform, a.username, COALESCE(a.slug,''), COALESCE(a.display_name,''), COALESCE(a.avatar_url,''),
			COALESCE(a.bio,''), COALESCE(a.social_links, '{}'),
			a.is_active, a.is_paid, a.paid_until, COALESCE(a.follower_count, 0),
			a.last_parsed_at, a.parse_errors,
			COUNT(v.id) AS video_count,
			a.created_at
		FROM accounts a
		LEFT JOIN videos v ON v.account_id = a.id AND v.is_active = true
		%s
		GROUP BY a.id
		ORDER BY a.created_at DESC
		LIMIT %s OFFSET %s
	`, whereClause, nextArg(perPage), nextArg(offset))

	rows, err := s.pool.Query(ctx, selectQ, args...)
	if err != nil {
		return nil, fmt.Errorf("admin_store: list accounts: %w", err)
	}
	defer rows.Close()

	var accounts []AdminAccount
	for rows.Next() {
		var a AdminAccount
		var socialLinksRaw []byte
		if err := rows.Scan(
			&a.ID, &a.Platform, &a.Username, &a.Slug, &a.DisplayName, &a.AvatarURL,
			&a.Bio, &socialLinksRaw,
			&a.IsActive, &a.IsPaid, &a.PaidUntil, &a.FollowerCount,
			&a.LastParsedAt, &a.ParseErrors,
			&a.VideoCount, &a.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("admin_store: scan account: %w", err)
		}
		a.SocialLinks = map[string]string{}
		_ = json.Unmarshal(socialLinksRaw, &a.SocialLinks)
		accounts = append(accounts, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin_store: account rows: %w", err)
	}

	if accounts == nil {
		accounts = []AdminAccount{}
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))

	return &AdminAccountList{
		Accounts:   accounts,
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: totalPages,
	}, nil
}

type CreateAccountInput struct {
	Platform  string `json:"platform"`
	Username  string `json:"username"`
	MaxVideos *int   `json:"max_videos,omitempty"`
}

func (s *AdminStore) CreateAccount(ctx context.Context, input CreateAccountInput) (*AdminAccount, error) {
	username := input.Username
	if len(username) > 0 && username[0] == '@' {
		username = username[1:]
	}

	// Check existing.
	var existingID int64
	var existingActive bool
	err := s.pool.QueryRow(ctx,
		`SELECT id, is_active FROM accounts WHERE platform = $1 AND username = $2`,
		input.Platform, username,
	).Scan(&existingID, &existingActive)

	if err == nil {
		// Already exists — reactivate if inactive, update max_videos if provided.
		if !existingActive || input.MaxVideos != nil {
			_, err = s.pool.Exec(ctx,
				`UPDATE accounts SET is_active = true, parse_errors = 0, max_videos = COALESCE($2, max_videos), updated_at = NOW() WHERE id = $1`,
				existingID, input.MaxVideos,
			)
			if err != nil {
				return nil, fmt.Errorf("admin_store: reactivate account: %w", err)
			}
		}
		// Enqueue parse (skip if already pending/running).
		s.enqueueIfNotExists(ctx, existingID)
		return s.getAccountByID(ctx, existingID)
	}
	if err != pgx.ErrNoRows {
		return nil, fmt.Errorf("admin_store: check existing: %w", err)
	}

	// Create new.
	var accountID int64
	err = s.pool.QueryRow(ctx,
		`INSERT INTO accounts (platform, username, max_videos) VALUES ($1, $2, $3) RETURNING id`,
		input.Platform, username, input.MaxVideos,
	).Scan(&accountID)
	if err != nil {
		return nil, fmt.Errorf("admin_store: create account: %w", err)
	}

	// Enqueue parse.
	s.enqueueIfNotExists(ctx, accountID)

	return s.getAccountByID(ctx, accountID)
}

// enqueueIfNotExists adds a pending parse job only if one doesn't already exist for the account.
func (s *AdminStore) enqueueIfNotExists(ctx context.Context, accountID int64) {
	var exists bool
	_ = s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM parse_queue WHERE account_id = $1 AND status IN ('pending', 'running'))`,
		accountID,
	).Scan(&exists)
	if exists {
		return
	}
	_, _ = s.pool.Exec(ctx,
		`INSERT INTO parse_queue (account_id, status) VALUES ($1, 'pending')`,
		accountID,
	)
}

func (s *AdminStore) getAccountByID(ctx context.Context, id int64) (*AdminAccount, error) {
	var a AdminAccount
	var socialLinksRaw []byte
	err := s.pool.QueryRow(ctx, `
		SELECT a.id, a.platform, a.username, COALESCE(a.slug,''), COALESCE(a.display_name,''), COALESCE(a.avatar_url,''),
			COALESCE(a.bio,''), COALESCE(a.social_links, '{}'),
			a.is_active, a.is_paid, a.paid_until, COALESCE(a.follower_count, 0),
			a.last_parsed_at, a.parse_errors, a.created_at,
			(SELECT COUNT(*) FROM videos v WHERE v.account_id = a.id AND v.is_active = true) AS video_count
		FROM accounts a WHERE a.id = $1
	`, id).Scan(
		&a.ID, &a.Platform, &a.Username, &a.Slug, &a.DisplayName, &a.AvatarURL,
		&a.Bio, &socialLinksRaw,
		&a.IsActive, &a.IsPaid, &a.PaidUntil, &a.FollowerCount,
		&a.LastParsedAt, &a.ParseErrors, &a.CreatedAt, &a.VideoCount,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("admin_store: get account by id: %w", err)
	}
	a.SocialLinks = map[string]string{}
	_ = json.Unmarshal(socialLinksRaw, &a.SocialLinks)
	return &a, nil
}

// GetAccountByID is the exported version for use by handlers.
func (s *AdminStore) GetAccountByID(ctx context.Context, id int64) (*AdminAccount, error) {
	return s.getAccountByID(ctx, id)
}

type UpdateAccountInput struct {
	IsActive    *bool              `json:"is_active,omitempty"`
	IsPaid      *bool              `json:"is_paid,omitempty"`
	SocialLinks *map[string]string `json:"social_links,omitempty"`
}

func (s *AdminStore) UpdateAccount(ctx context.Context, id int64, input UpdateAccountInput) (*AdminAccount, error) {
	if input.IsActive != nil {
		_, err := s.pool.Exec(ctx,
			`UPDATE accounts SET is_active = $2, updated_at = NOW() WHERE id = $1`,
			id, *input.IsActive,
		)
		if err != nil {
			return nil, fmt.Errorf("admin_store: update is_active: %w", err)
		}
	}
	if input.IsPaid != nil {
		// Check current is_paid to detect false→true transition.
		var wasPaid bool
		_ = s.pool.QueryRow(ctx, `SELECT is_paid FROM accounts WHERE id = $1`, id).Scan(&wasPaid)

		_, err := s.pool.Exec(ctx,
			`UPDATE accounts SET is_paid = $2, updated_at = NOW() WHERE id = $1`,
			id, *input.IsPaid,
		)
		if err != nil {
			return nil, fmt.Errorf("admin_store: update is_paid: %w", err)
		}

		// When promotion is enabled, enqueue banner generation for all videos.
		if *input.IsPaid && !wasPaid {
			_ = s.EnqueueBannerGeneration(ctx, id, 0)
		}
	}
	if input.SocialLinks != nil {
		linksJSON, err := json.Marshal(*input.SocialLinks)
		if err != nil {
			return nil, fmt.Errorf("admin_store: marshal social_links: %w", err)
		}
		_, err = s.pool.Exec(ctx,
			`UPDATE accounts SET social_links = $2, updated_at = NOW() WHERE id = $1`,
			id, linksJSON,
		)
		if err != nil {
			return nil, fmt.Errorf("admin_store: update social_links: %w", err)
		}
	}
	return s.getAccountByID(ctx, id)
}

func (s *AdminStore) DeleteAccount(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM accounts WHERE id = $1`,
		id,
	)
	if err != nil {
		return fmt.Errorf("admin_store: delete account: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("account not found")
	}
	return nil
}

func (s *AdminStore) ReparseAccount(ctx context.Context, id int64) error {
	// Verify account exists.
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM accounts WHERE id = $1)`, id).Scan(&exists)
	if err != nil {
		return fmt.Errorf("admin_store: check account: %w", err)
	}
	if !exists {
		return fmt.Errorf("account not found")
	}
	s.enqueueIfNotExists(ctx, id)
	return nil
}

func (s *AdminStore) ReparseAllAccounts(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO parse_queue (account_id, status)
		SELECT a.id, 'pending' FROM accounts a
		WHERE a.is_active = true
		AND NOT EXISTS (SELECT 1 FROM parse_queue pq WHERE pq.account_id = a.id AND pq.status IN ('pending', 'running'))
	`)
	if err != nil {
		return 0, fmt.Errorf("admin_store: reparse all: %w", err)
	}
	return tag.RowsAffected(), nil
}

// ─── Parse Queue ─────────────────────────────────────────────────────────────

type AdminQueueItem struct {
	ID          int64      `json:"id"`
	AccountID   int64      `json:"account_id"`
	Username    string     `json:"username"`
	Platform    string     `json:"platform"`
	Status      string     `json:"status"`
	VideosFound int        `json:"videos_found"`
	Error       *string    `json:"error,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	FinishedAt  *time.Time `json:"finished_at,omitempty"`
}

type AdminQueueList struct {
	Items      []AdminQueueItem `json:"items"`
	Total      int64            `json:"total"`
	Page       int              `json:"page"`
	PerPage    int              `json:"per_page"`
	TotalPages int              `json:"total_pages"`
}

func (s *AdminStore) ListQueue(ctx context.Context, status string, page, perPage int) (*AdminQueueList, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	conditions := []string{}
	args := []interface{}{}
	argIdx := 0

	nextArg := func(val interface{}) string {
		argIdx++
		args = append(args, val)
		return fmt.Sprintf("$%d", argIdx)
	}

	if status != "" {
		conditions = append(conditions, "pq.status = "+nextArg(status))
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + conditions[0]
	}

	var total int64
	countQ := fmt.Sprintf("SELECT COUNT(*) FROM parse_queue pq %s", whereClause)
	if err := s.pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("admin_store: count queue: %w", err)
	}

	offset := (page - 1) * perPage
	selectQ := fmt.Sprintf(`
		SELECT pq.id, pq.account_id, a.username, a.platform,
			pq.status, pq.videos_found, pq.error,
			pq.created_at, pq.started_at, pq.finished_at
		FROM parse_queue pq
		JOIN accounts a ON a.id = pq.account_id
		%s
		ORDER BY pq.created_at DESC
		LIMIT %s OFFSET %s
	`, whereClause, nextArg(perPage), nextArg(offset))

	rows, err := s.pool.Query(ctx, selectQ, args...)
	if err != nil {
		return nil, fmt.Errorf("admin_store: list queue: %w", err)
	}
	defer rows.Close()

	var items []AdminQueueItem
	for rows.Next() {
		var item AdminQueueItem
		if err := rows.Scan(
			&item.ID, &item.AccountID, &item.Username, &item.Platform,
			&item.Status, &item.VideosFound, &item.Error,
			&item.CreatedAt, &item.StartedAt, &item.FinishedAt,
		); err != nil {
			return nil, fmt.Errorf("admin_store: scan queue item: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin_store: queue rows: %w", err)
	}

	if items == nil {
		items = []AdminQueueItem{}
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))

	return &AdminQueueList{
		Items:      items,
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: totalPages,
	}, nil
}

func (s *AdminStore) RetryFailedJobs(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE parse_queue
		SET status = 'pending', started_at = NULL, finished_at = NULL, error = NULL, videos_found = 0
		WHERE status = 'failed'
	`)
	if err != nil {
		return 0, fmt.Errorf("admin_store: retry failed: %w", err)
	}
	return tag.RowsAffected(), nil
}

func (s *AdminStore) ClearFailedJobs(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM parse_queue WHERE status = 'failed'`)
	if err != nil {
		return 0, fmt.Errorf("admin_store: clear failed: %w", err)
	}
	return tag.RowsAffected(), nil
}

func (s *AdminStore) CancelQueueItem(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM parse_queue WHERE id = $1 AND status = 'pending'`,
		id,
	)
	if err != nil {
		return fmt.Errorf("admin_store: cancel queue item: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("queue item not found or not pending")
	}
	return nil
}

type QueueSummary struct {
	Pending        int64      `json:"pending"`
	Running        int64      `json:"running"`
	Done           int64      `json:"done"`
	Failed         int64      `json:"failed"`
	LastFinishedAt *time.Time `json:"last_finished_at"`
}

func (s *AdminStore) GetQueueSummary(ctx context.Context) (*QueueSummary, error) {
	var summary QueueSummary
	err := s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE status = 'pending'),
			COUNT(*) FILTER (WHERE status = 'running'),
			COUNT(*) FILTER (WHERE status = 'done'),
			COUNT(*) FILTER (WHERE status = 'failed'),
			MAX(finished_at)
		FROM parse_queue
	`).Scan(&summary.Pending, &summary.Running, &summary.Done, &summary.Failed, &summary.LastFinishedAt)
	if err != nil {
		return nil, fmt.Errorf("admin_store: queue summary: %w", err)
	}
	return &summary, nil
}

// ─── Videos ──────────────────────────────────────────────────────────────────

type AdminVideo struct {
	ID           int64      `json:"id"`
	AccountID    int64      `json:"account_id"`
	Platform     string     `json:"platform"`
	PlatformID   string     `json:"platform_id"`
	OriginalURL  string     `json:"original_url"`
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	DurationSec  int        `json:"duration_sec"`
	ThumbnailURL string     `json:"thumbnail_url"`
	PreviewURL   string     `json:"preview_url"`
	Width        int        `json:"width"`
	Height       int        `json:"height"`
	ViewCount    int64      `json:"view_count"`
	ClickCount   int64      `json:"click_count"`
	IsActive     bool       `json:"is_active"`
	PublishedAt  *time.Time `json:"published_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	Username     string     `json:"username"`
	Categories   []AdminVideoCategory `json:"categories"`
}

type AdminVideoCategory struct {
	ID         int64   `json:"id"`
	Slug       string  `json:"slug"`
	Name       string  `json:"name"`
	Confidence float64 `json:"confidence"`
}

type AdminVideoList struct {
	Videos     []AdminVideo `json:"videos"`
	Total      int64        `json:"total"`
	Page       int          `json:"page"`
	PerPage    int          `json:"per_page"`
	TotalPages int          `json:"total_pages"`
}

func (s *AdminStore) ListVideos(ctx context.Context, categorySlug string, uncategorized bool, page, perPage int) (*AdminVideoList, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	conditions := []string{"v.is_active = true"}
	args := []interface{}{}
	argIdx := 0

	nextArg := func(val interface{}) string {
		argIdx++
		args = append(args, val)
		return fmt.Sprintf("$%d", argIdx)
	}

	joinClause := ""
	if categorySlug != "" {
		joinClause = "JOIN video_categories vc ON vc.video_id = v.id JOIN categories c ON c.id = vc.category_id"
		conditions = append(conditions, "c.slug = "+nextArg(categorySlug))
	}

	if uncategorized {
		conditions = append(conditions, "v.ai_processed_at IS NULL")
	}

	whereClause := "WHERE "
	for i, c := range conditions {
		if i > 0 {
			whereClause += " AND "
		}
		whereClause += c
	}

	var total int64
	countQ := fmt.Sprintf("SELECT COUNT(DISTINCT v.id) FROM videos v %s %s", joinClause, whereClause)
	if err := s.pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("admin_store: count videos: %w", err)
	}

	offset := (page - 1) * perPage
	selectQ := fmt.Sprintf(`
		SELECT DISTINCT v.id, v.account_id, v.platform, v.platform_id, COALESCE(v.original_url,''),
			COALESCE(v.title,''), COALESCE(v.description,''), v.duration_sec, COALESCE(v.thumbnail_lg_url, v.thumbnail_url, ''), COALESCE(v.preview_url,''),
			v.width, v.height, v.view_count, v.click_count,
			v.is_active, v.published_at, v.created_at,
			COALESCE(a.username,'')
		FROM videos v
		JOIN accounts a ON a.id = v.account_id
		%s %s
		ORDER BY v.created_at DESC
		LIMIT %s OFFSET %s
	`, joinClause, whereClause, nextArg(perPage), nextArg(offset))

	rows, err := s.pool.Query(ctx, selectQ, args...)
	if err != nil {
		return nil, fmt.Errorf("admin_store: list videos: %w", err)
	}
	defer rows.Close()

	var videos []AdminVideo
	for rows.Next() {
		var v AdminVideo
		if err := rows.Scan(
			&v.ID, &v.AccountID, &v.Platform, &v.PlatformID, &v.OriginalURL,
			&v.Title, &v.Description, &v.DurationSec, &v.ThumbnailURL, &v.PreviewURL,
			&v.Width, &v.Height, &v.ViewCount, &v.ClickCount,
			&v.IsActive, &v.PublishedAt, &v.CreatedAt, &v.Username,
		); err != nil {
			return nil, fmt.Errorf("admin_store: scan video: %w", err)
		}
		v.Categories = []AdminVideoCategory{}
		videos = append(videos, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin_store: video rows: %w", err)
	}

	// Load categories for videos.
	if len(videos) > 0 {
		ids := make([]int64, len(videos))
		idxMap := make(map[int64]int, len(videos))
		for i, v := range videos {
			ids[i] = v.ID
			idxMap[v.ID] = i
		}
		catRows, err := s.pool.Query(ctx, `
			SELECT vc.video_id, c.id, c.slug, c.name, vc.confidence
			FROM video_categories vc
			JOIN categories c ON c.id = vc.category_id
			WHERE vc.video_id = ANY($1)
			ORDER BY vc.confidence DESC
		`, ids)
		if err != nil {
			return nil, fmt.Errorf("admin_store: load video categories: %w", err)
		}
		defer catRows.Close()
		for catRows.Next() {
			var videoID int64
			var vc AdminVideoCategory
			if err := catRows.Scan(&videoID, &vc.ID, &vc.Slug, &vc.Name, &vc.Confidence); err != nil {
				return nil, fmt.Errorf("admin_store: scan video category: %w", err)
			}
			if idx, ok := idxMap[videoID]; ok {
				videos[idx].Categories = append(videos[idx].Categories, vc)
			}
		}
		if err := catRows.Err(); err != nil {
			return nil, fmt.Errorf("admin_store: video category rows: %w", err)
		}
	}

	if videos == nil {
		videos = []AdminVideo{}
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))

	return &AdminVideoList{
		Videos:     videos,
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: totalPages,
	}, nil
}

func (s *AdminStore) DeleteVideo(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE videos SET is_active = false, updated_at = NOW() WHERE id = $1`,
		id,
	)
	if err != nil {
		return fmt.Errorf("admin_store: delete video: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("video not found")
	}
	return nil
}

type RecategorizeInput struct {
	VideoIDs []int64 `json:"video_ids"`
	All      bool    `json:"all"`
}

func (s *AdminStore) RecategorizeVideos(ctx context.Context, input RecategorizeInput) (int64, error) {
	if input.All {
		tag, err := s.pool.Exec(ctx,
			`UPDATE videos SET ai_processed_at = NULL, updated_at = NOW() WHERE is_active = true`,
		)
		if err != nil {
			return 0, fmt.Errorf("admin_store: recategorize all: %w", err)
		}
		return tag.RowsAffected(), nil
	}

	if len(input.VideoIDs) > 0 {
		tag, err := s.pool.Exec(ctx,
			`UPDATE videos SET ai_processed_at = NULL, updated_at = NOW() WHERE id = ANY($1)`,
			input.VideoIDs,
		)
		if err != nil {
			return 0, fmt.Errorf("admin_store: recategorize videos: %w", err)
		}
		return tag.RowsAffected(), nil
	}

	return 0, nil
}

// ─── Categories ──────────────────────────────────────────────────────────────

type AdminCategory struct {
	ID         int64  `json:"id"`
	Slug       string `json:"slug"`
	Name       string `json:"name"`
	ParentID   *int64 `json:"parent_id,omitempty"`
	IsActive   bool   `json:"is_active"`
	SortOrder  int    `json:"sort_order"`
	VideoCount int64  `json:"video_count"`
}

func (s *AdminStore) ListCategories(ctx context.Context) ([]AdminCategory, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.slug, c.name, c.parent_id, c.is_active, c.sort_order,
			COUNT(DISTINCT vc.video_id) AS video_count
		FROM categories c
		LEFT JOIN video_categories vc ON vc.category_id = c.id
		GROUP BY c.id, c.slug, c.name, c.parent_id, c.is_active, c.sort_order
		ORDER BY c.sort_order, c.name
	`)
	if err != nil {
		return nil, fmt.Errorf("admin_store: list categories: %w", err)
	}
	defer rows.Close()

	var categories []AdminCategory
	for rows.Next() {
		var c AdminCategory
		if err := rows.Scan(
			&c.ID, &c.Slug, &c.Name, &c.ParentID,
			&c.IsActive, &c.SortOrder, &c.VideoCount,
		); err != nil {
			return nil, fmt.Errorf("admin_store: scan category: %w", err)
		}
		categories = append(categories, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin_store: category rows: %w", err)
	}

	if categories == nil {
		categories = []AdminCategory{}
	}

	return categories, nil
}

// ─── Sites ───────────────────────────────────────────────────────────────────

type AdminSite struct {
	ID            int64           `json:"id"`
	Slug          string          `json:"slug"`
	Domain        string          `json:"domain"`
	Name          string          `json:"name"`
	Config        json.RawMessage `json:"config"`
	IsActive      bool            `json:"is_active"`
	CreatedAt     time.Time       `json:"created_at"`
	CategoryCount int64           `json:"category_count"`
	VideoCount    int64           `json:"video_count"`
}

func (s *AdminStore) GetSiteByID(ctx context.Context, id int64) (*AdminSite, error) {
	var site AdminSite
	err := s.pool.QueryRow(ctx, `
		SELECT s.id, s.slug, s.domain, s.name, COALESCE(s.config, '{}'), s.is_active, s.created_at,
			(SELECT COUNT(*) FROM site_categories sc WHERE sc.site_id = s.id) AS cat_count,
			(SELECT COUNT(*) FROM site_videos sv WHERE sv.site_id = s.id) AS video_count
		FROM sites s WHERE s.id = $1
	`, id).Scan(
		&site.ID, &site.Slug, &site.Domain, &site.Name, &site.Config,
		&site.IsActive, &site.CreatedAt,
		&site.CategoryCount, &site.VideoCount,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("admin_store: get site by id: %w", err)
	}
	return &site, nil
}

func (s *AdminStore) UpdateSiteConfig(ctx context.Context, id int64, config json.RawMessage) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE sites SET config = $2, updated_at = NOW() WHERE id = $1`,
		id, config,
	)
	if err != nil {
		return fmt.Errorf("admin_store: update site config: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("site not found")
	}
	return nil
}

func (s *AdminStore) ListSites(ctx context.Context) ([]AdminSite, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			s.id, s.slug, s.domain, s.name, COALESCE(s.config, '{}'), s.is_active, s.created_at,
			(SELECT COUNT(*) FROM site_categories sc WHERE sc.site_id = s.id) AS cat_count,
			(SELECT COUNT(*) FROM site_videos sv WHERE sv.site_id = s.id) AS video_count
		FROM sites s
		ORDER BY s.id
	`)
	if err != nil {
		return nil, fmt.Errorf("admin_store: list sites: %w", err)
	}
	defer rows.Close()

	var sites []AdminSite
	for rows.Next() {
		var site AdminSite
		if err := rows.Scan(
			&site.ID, &site.Slug, &site.Domain, &site.Name, &site.Config,
			&site.IsActive, &site.CreatedAt,
			&site.CategoryCount, &site.VideoCount,
		); err != nil {
			return nil, fmt.Errorf("admin_store: scan site: %w", err)
		}
		sites = append(sites, site)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin_store: site rows: %w", err)
	}

	if sites == nil {
		sites = []AdminSite{}
	}

	return sites, nil
}

// ─── Video Stats ─────────────────────────────────────────────────────────────

type VideoStatItem struct {
	ID           int64      `json:"id"`
	Platform     string     `json:"platform"`
	PlatformID   string     `json:"platform_id"`
	Title        string     `json:"title"`
	ThumbnailURL string     `json:"thumbnail_url"`
	DurationSec  int        `json:"duration_sec"`
	Username     string     `json:"username"`
	ViewCount    int64      `json:"view_count"`
	ClickCount   int64      `json:"click_count"`
	CTR          float64    `json:"ctr"`
	IsActive     bool       `json:"is_active"`
	PublishedAt  *time.Time `json:"published_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

type VideoStatsList struct {
	Videos     []VideoStatItem `json:"videos"`
	Total      int64           `json:"total"`
	Page       int             `json:"page"`
	PerPage    int             `json:"per_page"`
	TotalPages int             `json:"total_pages"`
}

func (s *AdminStore) ListVideoStats(ctx context.Context, sortBy string, sortDir string, page, perPage int) (*VideoStatsList, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 24
	}

	// Validate sort field.
	allowedSorts := map[string]string{
		"views":      "v.view_count",
		"clicks":     "v.click_count",
		"ctr":        "ctr",
		"created_at": "v.created_at",
	}
	sortColumn, ok := allowedSorts[sortBy]
	if !ok {
		sortColumn = "v.view_count"
	}
	if sortDir != "asc" {
		sortDir = "desc"
	}

	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM videos WHERE is_active = true`).Scan(&total); err != nil {
		return nil, fmt.Errorf("admin_store: count video stats: %w", err)
	}

	offset := (page - 1) * perPage

	query := fmt.Sprintf(`
		SELECT v.id, v.platform, v.platform_id, COALESCE(v.title,''), COALESCE(v.thumbnail_lg_url, v.thumbnail_url, ''),
			v.duration_sec, COALESCE(a.username,''),
			v.view_count, v.click_count,
			CASE WHEN v.view_count > 0 THEN ROUND(v.click_count::numeric / v.view_count * 100, 2) ELSE 0 END AS ctr,
			v.is_active, v.published_at, v.created_at
		FROM videos v
		JOIN accounts a ON a.id = v.account_id
		WHERE v.is_active = true
		ORDER BY %s %s NULLS LAST
		LIMIT $1 OFFSET $2
	`, sortColumn, sortDir)

	rows, err := s.pool.Query(ctx, query, perPage, offset)
	if err != nil {
		return nil, fmt.Errorf("admin_store: list video stats: %w", err)
	}
	defer rows.Close()

	var videos []VideoStatItem
	for rows.Next() {
		var v VideoStatItem
		if err := rows.Scan(
			&v.ID, &v.Platform, &v.PlatformID, &v.Title, &v.ThumbnailURL,
			&v.DurationSec, &v.Username,
			&v.ViewCount, &v.ClickCount, &v.CTR,
			&v.IsActive, &v.PublishedAt, &v.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("admin_store: scan video stat: %w", err)
		}
		videos = append(videos, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin_store: video stats rows: %w", err)
	}

	if videos == nil {
		videos = []VideoStatItem{}
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))

	return &VideoStatsList{
		Videos:     videos,
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: totalPages,
	}, nil
}

// ─── Banner Sizes ─────────────────────────────────────────────────────────────

type BannerSize struct {
	ID        int64     `json:"id"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	Label     string    `json:"label"`
	Type      string    `json:"type"`
	IsActive  bool      `json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *AdminStore) ListBannerSizes(ctx context.Context) ([]BannerSize, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, width, height, label, type, is_active, created_at FROM banner_sizes ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("admin_store: list banner sizes: %w", err)
	}
	defer rows.Close()

	var sizes []BannerSize
	for rows.Next() {
		var bs BannerSize
		if err := rows.Scan(&bs.ID, &bs.Width, &bs.Height, &bs.Label, &bs.Type, &bs.IsActive, &bs.CreatedAt); err != nil {
			return nil, fmt.Errorf("admin_store: scan banner size: %w", err)
		}
		sizes = append(sizes, bs)
	}
	if sizes == nil {
		sizes = []BannerSize{}
	}
	return sizes, rows.Err()
}

type CreateBannerSizeInput struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Label  string `json:"label"`
	Type   string `json:"type"`
}

func (s *AdminStore) CreateBannerSize(ctx context.Context, input CreateBannerSizeInput) (*BannerSize, error) {
	if input.Type == "" {
		input.Type = "image"
	}
	var bs BannerSize
	err := s.pool.QueryRow(ctx,
		`INSERT INTO banner_sizes (width, height, label, type) VALUES ($1, $2, $3, $4) RETURNING id, width, height, label, type, is_active, created_at`,
		input.Width, input.Height, input.Label, input.Type,
	).Scan(&bs.ID, &bs.Width, &bs.Height, &bs.Label, &bs.Type, &bs.IsActive, &bs.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("admin_store: create banner size: %w", err)
	}
	return &bs, nil
}

func (s *AdminStore) UpdateBannerSize(ctx context.Context, id int64, isActive bool) error {
	tag, err := s.pool.Exec(ctx, `UPDATE banner_sizes SET is_active = $2 WHERE id = $1`, id, isActive)
	if err != nil {
		return fmt.Errorf("admin_store: update banner size: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("banner size not found")
	}
	return nil
}

// ─── Banners ──────────────────────────────────────────────────────────────────

type AdminBanner struct {
	ID             int64     `json:"id"`
	AccountID      int64     `json:"account_id"`
	VideoID        int64     `json:"video_id"`
	BannerSizeID   int64     `json:"banner_size_id"`
	VideoFrameID   *int64    `json:"video_frame_id"`
	ImageURL       string    `json:"image_url"`
	ThumbnailURL   string    `json:"thumbnail_url"`
	SourceImageURL string    `json:"source_image_url"`
	Width          int       `json:"width"`
	Height         int       `json:"height"`
	IsActive       bool      `json:"is_active"`
	CreatedAt      time.Time `json:"created_at"`
	VideoTitle     string    `json:"video_title"`
	Username       string    `json:"username"`
	Impressions    uint64    `json:"impressions"`
	Hovers         uint64    `json:"hovers"`
	Clicks         uint64    `json:"clicks"`
	CTR            float64   `json:"ctr"`
}

type AdminBannerList struct {
	Banners    []AdminBanner `json:"banners"`
	Total      int64         `json:"total"`
	Page       int           `json:"page"`
	PerPage    int           `json:"per_page"`
	TotalPages int           `json:"total_pages"`
}

type BannerSizeSummary struct {
	BannerSizeID int64  `json:"banner_size_id"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	Label        string `json:"label"`
	Count        int64  `json:"count"`
}

func (s *AdminStore) GetAccountBannerSummary(ctx context.Context, accountID int64) ([]BannerSizeSummary, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT bs.id, bs.width, bs.height, bs.label, COUNT(b.id) AS cnt
		FROM banner_sizes bs
		LEFT JOIN banners b ON b.banner_size_id = bs.id AND b.account_id = $1 AND b.is_active = true
		WHERE bs.is_active = true
		GROUP BY bs.id, bs.width, bs.height, bs.label
		ORDER BY bs.id
	`, accountID)
	if err != nil {
		return nil, fmt.Errorf("admin_store: banner summary: %w", err)
	}
	defer rows.Close()

	var result []BannerSizeSummary
	for rows.Next() {
		var s BannerSizeSummary
		if err := rows.Scan(&s.BannerSizeID, &s.Width, &s.Height, &s.Label, &s.Count); err != nil {
			return nil, fmt.Errorf("admin_store: scan banner summary: %w", err)
		}
		result = append(result, s)
	}
	if result == nil {
		result = []BannerSizeSummary{}
	}
	return result, rows.Err()
}

func (s *AdminStore) ListAccountBanners(ctx context.Context, accountID int64, sizeID int64, page, perPage int) (*AdminBannerList, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 1000 {
		perPage = 20
	}

	conditions := []string{"b.account_id = $1", "b.is_active = true"}
	args := []interface{}{accountID}
	argIdx := 1

	if sizeID > 0 {
		argIdx++
		conditions = append(conditions, fmt.Sprintf("b.banner_size_id = $%d", argIdx))
		args = append(args, sizeID)
	}

	where := "WHERE " + conditions[0]
	for _, c := range conditions[1:] {
		where += " AND " + c
	}

	var total int64
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	if err := s.pool.QueryRow(ctx, fmt.Sprintf("SELECT COUNT(*) FROM banners b %s", where), countArgs...).Scan(&total); err != nil {
		return nil, fmt.Errorf("admin_store: count banners: %w", err)
	}

	argIdx++
	limitArg := fmt.Sprintf("$%d", argIdx)
	args = append(args, perPage)
	argIdx++
	offsetArg := fmt.Sprintf("$%d", argIdx)
	args = append(args, (page-1)*perPage)

	query := fmt.Sprintf(`
		SELECT b.id, b.account_id, b.video_id, b.banner_size_id, b.video_frame_id,
			b.image_url,
			CASE WHEN b.video_frame_id IS NOT NULL
				THEN COALESCE((SELECT vf.image_url FROM video_frames vf WHERE vf.id = b.video_frame_id), '')
				ELSE COALESCE(v.thumbnail_lg_url, v.thumbnail_url, '')
			END AS source_image_url,
			b.width, b.height, b.is_active, b.created_at,
			COALESCE(v.title,''), COALESCE(a.username,'')
		FROM banners b
		JOIN videos v ON v.id = b.video_id
		JOIN accounts a ON a.id = b.account_id
		%s
		ORDER BY b.created_at DESC
		LIMIT %s OFFSET %s
	`, where, limitArg, offsetArg)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("admin_store: list banners: %w", err)
	}
	defer rows.Close()

	var banners []AdminBanner
	for rows.Next() {
		var b AdminBanner
		if err := rows.Scan(&b.ID, &b.AccountID, &b.VideoID, &b.BannerSizeID, &b.VideoFrameID,
			&b.ImageURL, &b.SourceImageURL,
			&b.Width, &b.Height, &b.IsActive, &b.CreatedAt, &b.VideoTitle, &b.Username); err != nil {
			return nil, fmt.Errorf("admin_store: scan banner: %w", err)
		}
		banners = append(banners, b)
	}
	if banners == nil {
		banners = []AdminBanner{}
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))

	return &AdminBannerList{
		Banners:    banners,
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: totalPages,
	}, rows.Err()
}

func (s *AdminStore) ListAllBanners(ctx context.Context, page, perPage int) (*AdminBannerList, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM banners WHERE is_active = true`).Scan(&total); err != nil {
		return nil, fmt.Errorf("admin_store: count all banners: %w", err)
	}

	offset := (page - 1) * perPage
	rows, err := s.pool.Query(ctx, `
		SELECT b.id, b.account_id, b.video_id, b.banner_size_id, b.video_frame_id,
			b.image_url,
			CASE WHEN b.video_frame_id IS NOT NULL
				THEN COALESCE((SELECT vf.image_url FROM video_frames vf WHERE vf.id = b.video_frame_id), '')
				ELSE COALESCE(v.thumbnail_lg_url, v.thumbnail_url, '')
			END AS source_image_url,
			b.width, b.height, b.is_active, b.created_at,
			COALESCE(v.title,''), COALESCE(a.username,'')
		FROM banners b
		JOIN videos v ON v.id = b.video_id
		JOIN accounts a ON a.id = b.account_id
		WHERE b.is_active = true
		ORDER BY b.created_at DESC
		LIMIT $1 OFFSET $2
	`, perPage, offset)
	if err != nil {
		return nil, fmt.Errorf("admin_store: list all banners: %w", err)
	}
	defer rows.Close()

	var banners []AdminBanner
	for rows.Next() {
		var b AdminBanner
		if err := rows.Scan(&b.ID, &b.AccountID, &b.VideoID, &b.BannerSizeID, &b.VideoFrameID,
			&b.ImageURL, &b.SourceImageURL,
			&b.Width, &b.Height, &b.IsActive, &b.CreatedAt, &b.VideoTitle, &b.Username); err != nil {
			return nil, fmt.Errorf("admin_store: scan banner: %w", err)
		}
		banners = append(banners, b)
	}
	if banners == nil {
		banners = []AdminBanner{}
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))

	return &AdminBannerList{
		Banners:    banners,
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: totalPages,
	}, rows.Err()
}

func (s *AdminStore) InsertBanner(ctx context.Context, accountID, videoID, bannerSizeID int64, imageURL string, width, height int) (*AdminBanner, error) {
	var b AdminBanner
	err := s.pool.QueryRow(ctx, `
		INSERT INTO banners (account_id, video_id, banner_size_id, image_url, width, height)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (video_id, banner_size_id) WHERE video_frame_id IS NULL
			DO UPDATE SET image_url = EXCLUDED.image_url
		RETURNING id, account_id, video_id, banner_size_id, image_url, width, height, is_active, created_at
	`, accountID, videoID, bannerSizeID, imageURL, width, height).Scan(
		&b.ID, &b.AccountID, &b.VideoID, &b.BannerSizeID, &b.ImageURL,
		&b.Width, &b.Height, &b.IsActive, &b.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("admin_store: insert banner: %w", err)
	}
	return &b, nil
}

func (s *AdminStore) DeactivateBanner(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `UPDATE banners SET is_active = false WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("admin_store: deactivate banner: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("banner not found")
	}
	return nil
}

// BatchDeactivateBanners deactivates multiple banners at once.
func (s *AdminStore) BatchDeactivateBanners(ctx context.Context, ids []int64) (int64, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE banners SET is_active = false WHERE id = ANY($1)`, ids)
	if err != nil {
		return 0, fmt.Errorf("admin_store: batch deactivate banners: %w", err)
	}
	return tag.RowsAffected(), nil
}

// BatchRegenerateBanners looks up the (account_id, video_id) pairs for the given banner IDs
// and enqueues one banner_queue job per unique pair.
func (s *AdminStore) BatchRegenerateBanners(ctx context.Context, ids []int64) (int64, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT account_id, video_id FROM banners WHERE id = ANY($1) AND is_active = true
	`, ids)
	if err != nil {
		return 0, fmt.Errorf("admin_store: batch regenerate lookup: %w", err)
	}
	defer rows.Close()

	var count int64
	for rows.Next() {
		var accountID, videoID int64
		if err := rows.Scan(&accountID, &videoID); err != nil {
			return count, fmt.Errorf("admin_store: batch regenerate scan: %w", err)
		}
		_, err := s.pool.Exec(ctx,
			`INSERT INTO banner_queue (account_id, video_id, status) VALUES ($1, $2, 'pending')`,
			accountID, &videoID,
		)
		if err != nil {
			return count, fmt.Errorf("admin_store: batch regenerate enqueue: %w", err)
		}
		count++
	}
	return count, rows.Err()
}

// BannerRecropInfo holds data needed to re-crop a banner.
type BannerRecropInfo struct {
	ID             int64
	AccountID      int64
	VideoID        int64
	VideoFrameID   *int64
	Width          int
	Height         int
	SourceImageURL string
}

// GetBannerForRecrop returns the banner info and its source image URL.
func (s *AdminStore) GetBannerForRecrop(ctx context.Context, id int64) (*BannerRecropInfo, error) {
	var info BannerRecropInfo
	err := s.pool.QueryRow(ctx, `
		SELECT b.id, b.account_id, b.video_id, b.video_frame_id, b.width, b.height,
			CASE WHEN b.video_frame_id IS NOT NULL
				THEN COALESCE((SELECT vf.image_url FROM video_frames vf WHERE vf.id = b.video_frame_id), '')
				ELSE COALESCE(v.thumbnail_lg_url, v.thumbnail_url, '')
			END AS source_image_url
		FROM banners b
		JOIN videos v ON v.id = b.video_id
		WHERE b.id = $1 AND b.is_active = true
	`, id).Scan(&info.ID, &info.AccountID, &info.VideoID, &info.VideoFrameID,
		&info.Width, &info.Height, &info.SourceImageURL)
	if err != nil {
		return nil, fmt.Errorf("admin_store: get banner for recrop: %w", err)
	}
	return &info, nil
}

// UpdateBannerImageURL updates the image URL of a banner.
func (s *AdminStore) UpdateBannerImageURL(ctx context.Context, id int64, imageURL string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE banners SET image_url = $2 WHERE id = $1`, id, imageURL)
	if err != nil {
		return fmt.Errorf("admin_store: update banner image url: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("banner not found")
	}
	return nil
}

// EnqueueBannerGeneration inserts a job into banner_queue.
// videoID=0 means generate for all videos of the account.
func (s *AdminStore) EnqueueBannerGeneration(ctx context.Context, accountID int64, videoID int64) error {
	var vidPtr *int64
	if videoID > 0 {
		vidPtr = &videoID
	}
	_, err := s.pool.Exec(ctx,
		`INSERT INTO banner_queue (account_id, video_id, status) VALUES ($1, $2, 'pending')`,
		accountID, vidPtr,
	)
	if err != nil {
		return fmt.Errorf("admin_store: enqueue banner generation: %w", err)
	}
	return nil
}

// GetVideoThumbnail returns the thumbnail URL for a video.
func (s *AdminStore) GetVideoThumbnail(ctx context.Context, videoID int64) (string, error) {
	var url string
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(thumbnail_url,'') FROM videos WHERE id = $1`, videoID).Scan(&url)
	if err != nil {
		return "", fmt.Errorf("admin_store: get video thumbnail: %w", err)
	}
	return url, nil
}

// GetBannerByID returns a banner with its image_url for public serving.
func (s *AdminStore) GetBannerByID(ctx context.Context, id int64) (*AdminBanner, error) {
	var b AdminBanner
	err := s.pool.QueryRow(ctx, `
		SELECT b.id, b.account_id, b.video_id, b.banner_size_id, b.image_url,
			COALESCE(v.thumbnail_lg_url, v.thumbnail_url, ''),
			b.width, b.height, b.is_active, b.created_at,
			COALESCE(v.title,''), COALESCE(a.username,'')
		FROM banners b
		JOIN videos v ON v.id = b.video_id
		JOIN accounts a ON a.id = b.account_id
		WHERE b.id = $1
	`, id).Scan(
		&b.ID, &b.AccountID, &b.VideoID, &b.BannerSizeID, &b.ImageURL,
		&b.ThumbnailURL,
		&b.Width, &b.Height, &b.IsActive, &b.CreatedAt, &b.VideoTitle, &b.Username,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("admin_store: get banner by id: %w", err)
	}
	return &b, nil
}

// GetAccountSlug returns the slug for public redirect from banner click.
func (s *AdminStore) GetAccountSlug(ctx context.Context, accountID int64) (string, error) {
	var slug string
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(slug,'') FROM accounts WHERE id = $1`, accountID).Scan(&slug)
	if err != nil {
		return "", fmt.Errorf("admin_store: get account slug: %w", err)
	}
	return slug, nil
}

// ─── Dynamic Banner Serving ──────────────────────────────────────────────────

// ServableBanner holds minimal data for dynamic banner serving.
type ServableBanner struct {
	ID           int64  `json:"id"`
	AccountID    int64  `json:"aid"`
	VideoID      int64  `json:"vid"`
	ImageURL     string `json:"url"`
	ThumbnailURL string `json:"thumb"`
	Username     string `json:"user"`
	Width        int    `json:"w"`
	Height       int    `json:"h"`
}

// ListServableBanners returns all active banners for given size, optionally filtered by category or account.
func (s *AdminStore) ListServableBanners(ctx context.Context, width, height int, categorySlug string, accountID int64) ([]ServableBanner, error) {
	query := `
		SELECT b.id, b.account_id, b.video_id, b.image_url,
			COALESCE(v.thumbnail_lg_url, v.thumbnail_url, ''), COALESCE(a.username, ''),
			b.width, b.height
		FROM banners b
		JOIN videos v ON v.id = b.video_id AND v.is_active = true
		JOIN accounts a ON a.id = b.account_id AND a.is_paid = true AND a.is_active = true`

	args := []interface{}{width, height}
	argN := 3

	if categorySlug != "" {
		query += `
		JOIN video_categories vc ON vc.video_id = v.id
		JOIN categories c ON c.id = vc.category_id AND c.slug = $` + fmt.Sprintf("%d", argN)
		args = append(args, categorySlug)
		argN++
	}

	query += `
		WHERE b.is_active = true AND b.width = $1 AND b.height = $2`

	if accountID > 0 {
		query += fmt.Sprintf(` AND b.account_id = $%d`, argN)
		args = append(args, accountID)
		argN++
	}

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("admin_store: list servable banners: %w", err)
	}
	defer rows.Close()

	var banners []ServableBanner
	for rows.Next() {
		var b ServableBanner
		if err := rows.Scan(&b.ID, &b.AccountID, &b.VideoID, &b.ImageURL, &b.ThumbnailURL, &b.Username, &b.Width, &b.Height); err != nil {
			return nil, fmt.Errorf("admin_store: scan servable banner: %w", err)
		}
		banners = append(banners, b)
	}
	return banners, rows.Err()
}

// ─── Video Metadata for ClickHouse stats ─────────────────────────────────────

// VideoMeta holds basic video info for enriching ClickHouse stats.
type VideoMeta struct {
	ID           int64
	Platform     string
	PlatformID   string
	Title        string
	ThumbnailURL string
	DurationSec  int
	Username     string
	CreatedAt    time.Time
}

// GetVideoMetaBatch fetches video metadata for a list of video IDs.
// Returns a map of videoID → VideoMeta.
func (s *AdminStore) GetVideoMetaBatch(ctx context.Context, videoIDs []int64) (map[int64]VideoMeta, error) {
	if len(videoIDs) == 0 {
		return map[int64]VideoMeta{}, nil
	}

	query := `
		SELECT v.id, v.platform, v.platform_id, COALESCE(v.title,''), COALESCE(v.thumbnail_lg_url, v.thumbnail_url, ''),
			v.duration_sec, COALESCE(a.username,''), v.created_at
		FROM videos v
		JOIN accounts a ON a.id = v.account_id
		WHERE v.id = ANY($1)
	`

	rows, err := s.pool.Query(ctx, query, videoIDs)
	if err != nil {
		return nil, fmt.Errorf("admin_store: get video meta batch: %w", err)
	}
	defer rows.Close()

	result := make(map[int64]VideoMeta, len(videoIDs))
	for rows.Next() {
		var m VideoMeta
		if err := rows.Scan(
			&m.ID, &m.Platform, &m.PlatformID, &m.Title, &m.ThumbnailURL,
			&m.DurationSec, &m.Username, &m.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("admin_store: scan video meta: %w", err)
		}
		result[m.ID] = m
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin_store: video meta rows: %w", err)
	}

	return result, nil
}

// ─── Ad Sources ───────────────────────────────────────────────────────────────

type AdSource struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	PostbackURL string    `json:"postback_url"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
}

type ConversionPostback struct {
	ID           int64      `json:"id"`
	AdSourceID   int64      `json:"ad_source_id"`
	AdSourceName string     `json:"ad_source_name,omitempty"`
	ClickID      string     `json:"click_id"`
	EventType    string     `json:"event_type"`
	AccountID    int64      `json:"account_id"`
	VideoID      int64      `json:"video_id"`
	Status       string     `json:"status"`
	ResponseCode int        `json:"response_code"`
	ResponseBody string     `json:"response_body,omitempty"`
	CpaAmount    *float64   `json:"cpa_amount,omitempty"`
	EventID      *int       `json:"event_id,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	SentAt       *time.Time `json:"sent_at,omitempty"`
}

// GetAdSourceByName looks up an ad source by its unique name.
func (s *AdminStore) GetAdSourceByName(ctx context.Context, name string) (*AdSource, error) {
	var a AdSource
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, postback_url, is_active, created_at
		FROM ad_sources WHERE name = $1 AND is_active = true
	`, name).Scan(&a.ID, &a.Name, &a.PostbackURL, &a.IsActive, &a.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("admin_store: get ad source by name: %w", err)
	}
	return &a, nil
}

// ListAdSources returns all ad sources.
func (s *AdminStore) ListAdSources(ctx context.Context) ([]AdSource, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, postback_url, is_active, created_at
		FROM ad_sources ORDER BY id
	`)
	if err != nil {
		return nil, fmt.Errorf("admin_store: list ad sources: %w", err)
	}
	defer rows.Close()

	var sources []AdSource
	for rows.Next() {
		var a AdSource
		if err := rows.Scan(&a.ID, &a.Name, &a.PostbackURL, &a.IsActive, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("admin_store: scan ad source: %w", err)
		}
		sources = append(sources, a)
	}
	if sources == nil {
		sources = []AdSource{}
	}
	return sources, rows.Err()
}

type CreateAdSourceInput struct {
	Name        string `json:"name"`
	PostbackURL string `json:"postback_url"`
}

// CreateAdSource creates a new ad source.
func (s *AdminStore) CreateAdSource(ctx context.Context, input CreateAdSourceInput) (*AdSource, error) {
	var a AdSource
	err := s.pool.QueryRow(ctx, `
		INSERT INTO ad_sources (name, postback_url) VALUES ($1, $2)
		RETURNING id, name, postback_url, is_active, created_at
	`, input.Name, input.PostbackURL).Scan(&a.ID, &a.Name, &a.PostbackURL, &a.IsActive, &a.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("admin_store: create ad source: %w", err)
	}
	return &a, nil
}

type UpdateAdSourceInput struct {
	Name        *string `json:"name,omitempty"`
	PostbackURL *string `json:"postback_url,omitempty"`
	IsActive    *bool   `json:"is_active,omitempty"`
}

// UpdateAdSource updates an existing ad source.
func (s *AdminStore) UpdateAdSource(ctx context.Context, id int64, input UpdateAdSourceInput) (*AdSource, error) {
	var a AdSource
	err := s.pool.QueryRow(ctx, `
		UPDATE ad_sources SET
			name = COALESCE($2, name),
			postback_url = COALESCE($3, postback_url),
			is_active = COALESCE($4, is_active)
		WHERE id = $1
		RETURNING id, name, postback_url, is_active, created_at
	`, id, input.Name, input.PostbackURL, input.IsActive).Scan(&a.ID, &a.Name, &a.PostbackURL, &a.IsActive, &a.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("ad source not found")
		}
		return nil, fmt.Errorf("admin_store: update ad source: %w", err)
	}
	return &a, nil
}

// ─── Conversion Postbacks ─────────────────────────────────────────────────────

// CreateConversionPostback inserts a conversion postback record.
func (s *AdminStore) CreateConversionPostback(ctx context.Context, pb *ConversionPostback) error {
	err := s.pool.QueryRow(ctx, `
		INSERT INTO conversion_postbacks (ad_source_id, click_id, event_type, account_id, video_id, status, cpa_amount, event_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at
	`, pb.AdSourceID, pb.ClickID, pb.EventType, pb.AccountID, pb.VideoID, pb.Status, pb.CpaAmount, pb.EventID).Scan(&pb.ID, &pb.CreatedAt)
	if err != nil {
		return fmt.Errorf("admin_store: create conversion postback: %w", err)
	}
	return nil
}

// UpdatePostbackStatus updates the status and response of a postback.
func (s *AdminStore) UpdatePostbackStatus(ctx context.Context, id int64, status string, responseCode int, responseBody string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE conversion_postbacks
		SET status = $2, response_code = $3, response_body = $4, sent_at = NOW()
		WHERE id = $1
	`, id, status, responseCode, responseBody)
	if err != nil {
		return fmt.Errorf("admin_store: update postback status: %w", err)
	}
	return nil
}

// ListPendingPostbacks returns pending postbacks older than 1 minute (for retry).
func (s *AdminStore) ListPendingPostbacks(ctx context.Context, limit int) ([]ConversionPostback, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT cp.id, cp.ad_source_id, a.name, cp.click_id, cp.event_type,
			cp.account_id, cp.video_id, cp.status, cp.response_code, COALESCE(cp.response_body,''),
			cp.cpa_amount, cp.event_id, cp.created_at, cp.sent_at
		FROM conversion_postbacks cp
		JOIN ad_sources a ON a.id = cp.ad_source_id
		WHERE cp.status IN ('pending', 'failed')
			AND cp.created_at > NOW() - INTERVAL '24 hours'
			AND cp.created_at < NOW() - INTERVAL '1 minute'
		ORDER BY cp.created_at
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("admin_store: list pending postbacks: %w", err)
	}
	defer rows.Close()

	var postbacks []ConversionPostback
	for rows.Next() {
		var pb ConversionPostback
		if err := rows.Scan(
			&pb.ID, &pb.AdSourceID, &pb.AdSourceName, &pb.ClickID, &pb.EventType,
			&pb.AccountID, &pb.VideoID, &pb.Status, &pb.ResponseCode, &pb.ResponseBody,
			&pb.CpaAmount, &pb.EventID, &pb.CreatedAt, &pb.SentAt,
		); err != nil {
			return nil, fmt.Errorf("admin_store: scan postback: %w", err)
		}
		postbacks = append(postbacks, pb)
	}
	if postbacks == nil {
		postbacks = []ConversionPostback{}
	}
	return postbacks, rows.Err()
}

// ListRecentPostbacks returns recent conversion postbacks for admin view.
func (s *AdminStore) ListRecentPostbacks(ctx context.Context, limit int) ([]ConversionPostback, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT cp.id, cp.ad_source_id, a.name, cp.click_id, cp.event_type,
			cp.account_id, cp.video_id, cp.status, cp.response_code, COALESCE(cp.response_body,''),
			cp.cpa_amount, cp.event_id, cp.created_at, cp.sent_at
		FROM conversion_postbacks cp
		JOIN ad_sources a ON a.id = cp.ad_source_id
		ORDER BY cp.created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("admin_store: list recent postbacks: %w", err)
	}
	defer rows.Close()

	var postbacks []ConversionPostback
	for rows.Next() {
		var pb ConversionPostback
		if err := rows.Scan(
			&pb.ID, &pb.AdSourceID, &pb.AdSourceName, &pb.ClickID, &pb.EventType,
			&pb.AccountID, &pb.VideoID, &pb.Status, &pb.ResponseCode, &pb.ResponseBody,
			&pb.CpaAmount, &pb.EventID, &pb.CreatedAt, &pb.SentAt,
		); err != nil {
			return nil, fmt.Errorf("admin_store: scan postback: %w", err)
		}
		postbacks = append(postbacks, pb)
	}
	if postbacks == nil {
		postbacks = []ConversionPostback{}
	}
	return postbacks, rows.Err()
}

// ─── Account Conversion Prices ────────────────────────────────────────────────

type AccountConversionPrice struct {
	ID        int64     `json:"id"`
	AccountID int64     `json:"account_id"`
	EventType string    `json:"event_type"`
	Price     float64   `json:"price"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// GetAccountConversionPrices returns all conversion prices for an account.
func (s *AdminStore) GetAccountConversionPrices(ctx context.Context, accountID int64) ([]AccountConversionPrice, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, account_id, event_type, price, created_at, updated_at
		FROM account_conversion_prices
		WHERE account_id = $1
		ORDER BY event_type
	`, accountID)
	if err != nil {
		return nil, fmt.Errorf("admin_store: get account conversion prices: %w", err)
	}
	defer rows.Close()

	var prices []AccountConversionPrice
	for rows.Next() {
		var p AccountConversionPrice
		if err := rows.Scan(&p.ID, &p.AccountID, &p.EventType, &p.Price, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("admin_store: scan conversion price: %w", err)
		}
		prices = append(prices, p)
	}
	if prices == nil {
		prices = []AccountConversionPrice{}
	}
	return prices, rows.Err()
}

// UpsertAccountConversionPrice creates or updates a conversion price for an account+event_type.
func (s *AdminStore) UpsertAccountConversionPrice(ctx context.Context, accountID int64, eventType string, price float64) (*AccountConversionPrice, error) {
	var p AccountConversionPrice
	err := s.pool.QueryRow(ctx, `
		INSERT INTO account_conversion_prices (account_id, event_type, price)
		VALUES ($1, $2, $3)
		ON CONFLICT (account_id, event_type)
		DO UPDATE SET price = $3, updated_at = NOW()
		RETURNING id, account_id, event_type, price, created_at, updated_at
	`, accountID, eventType, price).Scan(&p.ID, &p.AccountID, &p.EventType, &p.Price, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("admin_store: upsert conversion price: %w", err)
	}
	return &p, nil
}

// GetConversionPrice returns the CPA price for an account+event_type.
// Returns (0, nil) if not configured.
func (s *AdminStore) GetConversionPrice(ctx context.Context, accountID int64, eventType string) (float64, error) {
	var price float64
	err := s.pool.QueryRow(ctx, `
		SELECT price FROM account_conversion_prices
		WHERE account_id = $1 AND event_type = $2
	`, accountID, eventType).Scan(&price)
	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, nil
		}
		return 0, fmt.Errorf("admin_store: get conversion price: %w", err)
	}
	return price, nil
}

// ─── Account Source Event IDs ─────────────────────────────────────────────────

type AccountSourceEventID struct {
	ID           int64     `json:"id"`
	AccountID    int64     `json:"account_id"`
	AdSourceID   int64     `json:"ad_source_id"`
	AdSourceName string    `json:"ad_source_name,omitempty"`
	EventType    string    `json:"event_type"`
	EventID      int       `json:"event_id"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// GetAccountSourceEventIDs returns all event_id mappings for an account (with source names).
func (s *AdminStore) GetAccountSourceEventIDs(ctx context.Context, accountID int64) ([]AccountSourceEventID, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT asei.id, asei.account_id, asei.ad_source_id, ads.name,
		       asei.event_type, asei.event_id, asei.created_at, asei.updated_at
		FROM account_source_event_ids asei
		JOIN ad_sources ads ON ads.id = asei.ad_source_id
		WHERE asei.account_id = $1
		ORDER BY ads.name, asei.event_type
	`, accountID)
	if err != nil {
		return nil, fmt.Errorf("admin_store: get account source event ids: %w", err)
	}
	defer rows.Close()

	var items []AccountSourceEventID
	for rows.Next() {
		var item AccountSourceEventID
		if err := rows.Scan(&item.ID, &item.AccountID, &item.AdSourceID, &item.AdSourceName,
			&item.EventType, &item.EventID, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("admin_store: scan source event id: %w", err)
		}
		items = append(items, item)
	}
	if items == nil {
		items = []AccountSourceEventID{}
	}
	return items, rows.Err()
}

// UpsertAccountSourceEventID creates or updates an event_id for a specific account+source+event_type.
func (s *AdminStore) UpsertAccountSourceEventID(ctx context.Context, accountID, adSourceID int64, eventType string, eventID int) (*AccountSourceEventID, error) {
	var item AccountSourceEventID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO account_source_event_ids (account_id, ad_source_id, event_type, event_id)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (account_id, ad_source_id, event_type)
		DO UPDATE SET event_id = $4, updated_at = NOW()
		RETURNING id, account_id, ad_source_id, event_type, event_id, created_at, updated_at
	`, accountID, adSourceID, eventType, eventID).Scan(&item.ID, &item.AccountID, &item.AdSourceID,
		&item.EventType, &item.EventID, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("admin_store: upsert source event id: %w", err)
	}
	return &item, nil
}

// GetEventIDForSource returns the event_id for a specific account+source+event_type.
// Returns 1 if not configured.
func (s *AdminStore) GetEventIDForSource(ctx context.Context, accountID, adSourceID int64, eventType string) (int, error) {
	var eventID int
	err := s.pool.QueryRow(ctx, `
		SELECT event_id FROM account_source_event_ids
		WHERE account_id = $1 AND ad_source_id = $2 AND event_type = $3
	`, accountID, adSourceID, eventType).Scan(&eventID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return 1, nil
		}
		return 1, fmt.Errorf("admin_store: get event id for source: %w", err)
	}
	return eventID, nil
}
