package store

import (
	"context"
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
	ID           int64      `json:"id"`
	Platform     string     `json:"platform"`
	Username     string     `json:"username"`
	DisplayName  string     `json:"display_name"`
	AvatarURL    string     `json:"avatar_url"`
	IsActive     bool       `json:"is_active"`
	IsPaid       bool       `json:"is_paid"`
	PaidUntil    *time.Time `json:"paid_until,omitempty"`
	FollowerCount int64     `json:"follower_count"`
	LastParsedAt *time.Time `json:"last_parsed_at,omitempty"`
	ParseErrors  int        `json:"parse_errors"`
	VideoCount   int64      `json:"video_count"`
	CreatedAt    time.Time  `json:"created_at"`
}

type AdminAccountList struct {
	Accounts   []AdminAccount `json:"accounts"`
	Total      int64          `json:"total"`
	Page       int            `json:"page"`
	PerPage    int            `json:"per_page"`
	TotalPages int            `json:"total_pages"`
}

func (s *AdminStore) ListAccounts(ctx context.Context, platform, status string, page, perPage int) (*AdminAccountList, error) {
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
		SELECT a.id, a.platform, a.username, COALESCE(a.display_name,''), COALESCE(a.avatar_url,''),
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
		if err := rows.Scan(
			&a.ID, &a.Platform, &a.Username, &a.DisplayName, &a.AvatarURL,
			&a.IsActive, &a.IsPaid, &a.PaidUntil, &a.FollowerCount,
			&a.LastParsedAt, &a.ParseErrors,
			&a.VideoCount, &a.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("admin_store: scan account: %w", err)
		}
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
	err := s.pool.QueryRow(ctx, `
		SELECT a.id, a.platform, a.username, COALESCE(a.display_name,''), COALESCE(a.avatar_url,''),
			a.is_active, a.is_paid, a.paid_until, COALESCE(a.follower_count, 0),
			a.last_parsed_at, a.parse_errors, a.created_at,
			(SELECT COUNT(*) FROM videos v WHERE v.account_id = a.id AND v.is_active = true) AS video_count
		FROM accounts a WHERE a.id = $1
	`, id).Scan(
		&a.ID, &a.Platform, &a.Username, &a.DisplayName, &a.AvatarURL,
		&a.IsActive, &a.IsPaid, &a.PaidUntil, &a.FollowerCount,
		&a.LastParsedAt, &a.ParseErrors, &a.CreatedAt, &a.VideoCount,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("admin_store: get account by id: %w", err)
	}
	return &a, nil
}

type UpdateAccountInput struct {
	IsActive *bool `json:"is_active,omitempty"`
	IsPaid   *bool `json:"is_paid,omitempty"`
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
		_, err := s.pool.Exec(ctx,
			`UPDATE accounts SET is_paid = $2, updated_at = NOW() WHERE id = $1`,
			id, *input.IsPaid,
		)
		if err != nil {
			return nil, fmt.Errorf("admin_store: update is_paid: %w", err)
		}
	}
	return s.getAccountByID(ctx, id)
}

func (s *AdminStore) DeleteAccount(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE accounts SET is_active = false, updated_at = NOW() WHERE id = $1`,
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
	ID           int64     `json:"id"`
	Slug         string    `json:"slug"`
	Domain       string    `json:"domain"`
	Name         string    `json:"name"`
	IsActive     bool      `json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
	CategoryCount int64    `json:"category_count"`
	VideoCount   int64     `json:"video_count"`
}

func (s *AdminStore) GetSiteByID(ctx context.Context, id int64) (*AdminSite, error) {
	var site AdminSite
	err := s.pool.QueryRow(ctx, `
		SELECT s.id, s.slug, s.domain, s.name, s.is_active, s.created_at,
			(SELECT COUNT(*) FROM site_categories sc WHERE sc.site_id = s.id) AS cat_count,
			(SELECT COUNT(*) FROM site_videos sv WHERE sv.site_id = s.id) AS video_count
		FROM sites s WHERE s.id = $1
	`, id).Scan(
		&site.ID, &site.Slug, &site.Domain, &site.Name,
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

func (s *AdminStore) ListSites(ctx context.Context) ([]AdminSite, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			s.id, s.slug, s.domain, s.name, s.is_active, s.created_at,
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
			&site.ID, &site.Slug, &site.Domain, &site.Name,
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
