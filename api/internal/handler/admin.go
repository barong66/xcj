package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/xcj/videosite-api/internal/cache"
	"github.com/xcj/videosite-api/internal/clickhouse"
	"github.com/xcj/videosite-api/internal/store"
	"github.com/xcj/videosite-api/internal/worker"
)

type AdminHandler struct {
	admin     *store.AdminStore
	ch        *clickhouse.Reader
	workerMgr *worker.Manager
	cache     *cache.Cache
}

func NewAdminHandler(admin *store.AdminStore, ch *clickhouse.Reader, workerMgr *worker.Manager, c *cache.Cache) *AdminHandler {
	return &AdminHandler{admin: admin, ch: ch, workerMgr: workerMgr, cache: c}
}

// AdminAuth is middleware that checks the Bearer token against the ADMIN_TOKEN env var.
func AdminAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := os.Getenv("ADMIN_TOKEN")
		if token == "" {
			token = "xcj-admin-2024"
		}

		auth := r.Header.Get("Authorization")
		if auth == "" {
			writeError(w, http.StatusUnauthorized, "authorization header required")
			return
		}

		parts := strings.SplitN(auth, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" || parts[1] != token {
			writeError(w, http.StatusUnauthorized, "invalid token")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// ─── Stats ───────────────────────────────────────────────────────────────────

// GetStats handles GET /api/v1/admin/stats
func (h *AdminHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.admin.GetStats(r.Context())
	if err != nil {
		slog.Error("admin: get stats", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get stats")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// ─── Accounts ────────────────────────────────────────────────────────────────

// GetAccount handles GET /api/v1/admin/accounts/{id}
func (h *AdminHandler) GetAccount(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	account, err := h.admin.GetAccountByID(r.Context(), id)
	if err != nil {
		slog.Error("admin: get account", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to get account")
		return
	}
	if account == nil {
		writeError(w, http.StatusNotFound, "account not found")
		return
	}
	writeJSON(w, http.StatusOK, account)
}

// ListAccounts handles GET /api/v1/admin/accounts
func (h *AdminHandler) ListAccounts(w http.ResponseWriter, r *http.Request) {
	platform := r.URL.Query().Get("platform")
	status := r.URL.Query().Get("status")
	paid := r.URL.Query().Get("paid")
	page := intParam(r, "page", 1)
	perPage := intParam(r, "per_page", 20)

	result, err := h.admin.ListAccounts(r.Context(), platform, status, paid, page, perPage)
	if err != nil {
		slog.Error("admin: list accounts", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list accounts")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// CreateAccount handles POST /api/v1/admin/accounts
func (h *AdminHandler) CreateAccount(w http.ResponseWriter, r *http.Request) {
	var input store.CreateAccountInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if input.Platform == "" || input.Username == "" {
		writeError(w, http.StatusBadRequest, "platform and username are required")
		return
	}

	input.Platform = strings.ToLower(input.Platform)
	if input.Platform != "twitter" && input.Platform != "instagram" {
		writeError(w, http.StatusBadRequest, "platform must be 'twitter' or 'instagram'")
		return
	}

	account, err := h.admin.CreateAccount(r.Context(), input)
	if err != nil {
		slog.Error("admin: create account", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create account")
		return
	}
	h.workerMgr.EnsureRunning()
	writeJSON(w, http.StatusCreated, account)
}

// UpdateAccount handles PUT /api/v1/admin/accounts/{id}
func (h *AdminHandler) UpdateAccount(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	var input store.UpdateAccountInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	account, err := h.admin.UpdateAccount(r.Context(), id, input)
	if err != nil {
		slog.Error("admin: update account", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to update account")
		return
	}
	if account == nil {
		writeError(w, http.StatusNotFound, "account not found")
		return
	}
	writeJSON(w, http.StatusOK, account)
}

// DeleteAccount handles DELETE /api/v1/admin/accounts/{id}
func (h *AdminHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	if err := h.admin.DeleteAccount(r.Context(), id); err != nil {
		if err.Error() == "account not found" {
			writeError(w, http.StatusNotFound, "account not found")
			return
		}
		slog.Error("admin: delete account", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to delete account")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ReparseAccount handles POST /api/v1/admin/accounts/{id}/reparse
func (h *AdminHandler) ReparseAccount(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	if err := h.admin.ReparseAccount(r.Context(), id); err != nil {
		if err.Error() == "account not found" {
			writeError(w, http.StatusNotFound, "account not found")
			return
		}
		slog.Error("admin: reparse account", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to enqueue reparse")
		return
	}
	h.workerMgr.EnsureRunning()
	writeJSON(w, http.StatusOK, map[string]string{"status": "enqueued"})
}

// ReparseAllAccounts handles POST /api/v1/admin/accounts/reparse-all
func (h *AdminHandler) ReparseAllAccounts(w http.ResponseWriter, r *http.Request) {
	count, err := h.admin.ReparseAllAccounts(r.Context())
	if err != nil {
		slog.Error("admin: reparse all accounts", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to enqueue reparse all")
		return
	}
	if count > 0 {
		h.workerMgr.EnsureRunning()
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":   "enqueued",
		"enqueued": count,
	})
}

// ─── Queue ───────────────────────────────────────────────────────────────────

// ListQueue handles GET /api/v1/admin/queue
func (h *AdminHandler) ListQueue(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	page := intParam(r, "page", 1)
	perPage := intParam(r, "per_page", 20)

	result, err := h.admin.ListQueue(r.Context(), status, page, perPage)
	if err != nil {
		slog.Error("admin: list queue", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list queue")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// RetryFailedJobs handles POST /api/v1/admin/queue/retry-failed
func (h *AdminHandler) RetryFailedJobs(w http.ResponseWriter, r *http.Request) {
	count, err := h.admin.RetryFailedJobs(r.Context())
	if err != nil {
		slog.Error("admin: retry failed jobs", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to retry failed jobs")
		return
	}
	if count > 0 {
		h.workerMgr.EnsureRunning()
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "ok",
		"retried": count,
	})
}

// ClearFailedJobs handles DELETE /api/v1/admin/queue/failed
func (h *AdminHandler) ClearFailedJobs(w http.ResponseWriter, r *http.Request) {
	count, err := h.admin.ClearFailedJobs(r.Context())
	if err != nil {
		slog.Error("admin: clear failed jobs", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to clear failed jobs")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "ok",
		"cleared": count,
	})
}

// CancelQueueItem handles DELETE /api/v1/admin/queue/{id}
func (h *AdminHandler) CancelQueueItem(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid queue item id")
		return
	}

	if err := h.admin.CancelQueueItem(r.Context(), id); err != nil {
		if err.Error() == "queue item not found or not pending" {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		slog.Error("admin: cancel queue item", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to cancel queue item")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GetQueueSummary handles GET /api/v1/admin/queue/summary
func (h *AdminHandler) GetQueueSummary(w http.ResponseWriter, r *http.Request) {
	summary, err := h.admin.GetQueueSummary(r.Context())
	if err != nil {
		slog.Error("admin: queue summary", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get queue summary")
		return
	}
	resp := struct {
		*store.QueueSummary
		WorkerRunning bool `json:"worker_running"`
	}{
		QueueSummary:  summary,
		WorkerRunning: h.workerMgr.IsRunning(),
	}
	writeJSON(w, http.StatusOK, resp)
}

// ─── Videos ──────────────────────────────────────────────────────────────────

// ListVideos handles GET /api/v1/admin/videos
func (h *AdminHandler) ListVideos(w http.ResponseWriter, r *http.Request) {
	category := r.URL.Query().Get("category")
	uncategorized := r.URL.Query().Get("uncategorized") == "true"
	page := intParam(r, "page", 1)
	perPage := intParam(r, "per_page", 20)

	result, err := h.admin.ListVideos(r.Context(), category, uncategorized, page, perPage)
	if err != nil {
		slog.Error("admin: list videos", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list videos")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// DeleteVideo handles DELETE /api/v1/admin/videos/{id}
func (h *AdminHandler) DeleteVideo(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid video id")
		return
	}

	if err := h.admin.DeleteVideo(r.Context(), id); err != nil {
		if err.Error() == "video not found" {
			writeError(w, http.StatusNotFound, "video not found")
			return
		}
		slog.Error("admin: delete video", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to delete video")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// RecategorizeVideos handles POST /api/v1/admin/videos/recategorize
func (h *AdminHandler) RecategorizeVideos(w http.ResponseWriter, r *http.Request) {
	var input store.RecategorizeInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	count, err := h.admin.RecategorizeVideos(r.Context(), input)
	if err != nil {
		slog.Error("admin: recategorize videos", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to recategorize videos")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "ok",
		"updated": count,
	})
}

// GetVideoStats handles GET /api/v1/admin/videos/stats
// Reads real site analytics (impressions/clicks) from ClickHouse
// and enriches with video metadata from PostgreSQL.
func (h *AdminHandler) GetVideoStats(w http.ResponseWriter, r *http.Request) {
	sortBy := r.URL.Query().Get("sort")
	sortDir := r.URL.Query().Get("dir")
	page := intParam(r, "page", 1)
	perPage := intParam(r, "per_page", 24)

	ctx := r.Context()

	// Get aggregated stats from ClickHouse.
	chResult, err := h.ch.GetVideoStats(ctx, sortBy, sortDir, page, perPage)
	if err != nil {
		slog.Error("admin: video stats from clickhouse", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get video stats")
		return
	}

	// Get total site stats.
	totalStats, err := h.ch.GetTotalStats(ctx)
	if err != nil {
		slog.Error("admin: total site stats", "error", err)
		// Non-fatal, continue with zero totals.
		totalStats = &clickhouse.TotalSiteStats{}
	}

	// Collect video IDs to fetch metadata from PostgreSQL.
	videoIDs := make([]int64, len(chResult.Stats))
	for i, s := range chResult.Stats {
		videoIDs[i] = s.VideoID
	}

	// Fetch video metadata from PG.
	videoMeta, err := h.admin.GetVideoMetaBatch(ctx, videoIDs)
	if err != nil {
		slog.Error("admin: video meta batch", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get video metadata")
		return
	}

	// Build response combining CH stats + PG metadata.
	type VideoStatResponse struct {
		ID           int64   `json:"id"`
		Platform     string  `json:"platform"`
		PlatformID   string  `json:"platform_id"`
		Title        string  `json:"title"`
		ThumbnailURL string  `json:"thumbnail_url"`
		DurationSec  int     `json:"duration_sec"`
		Username     string  `json:"username"`
		Impressions  uint64  `json:"impressions"`
		Clicks       uint64  `json:"clicks"`
		CTR          float64 `json:"ctr"`
		CreatedAt    string  `json:"created_at"`
	}

	videos := make([]VideoStatResponse, 0, len(chResult.Stats))
	for _, s := range chResult.Stats {
		meta, ok := videoMeta[s.VideoID]
		v := VideoStatResponse{
			ID:          s.VideoID,
			Impressions: s.Impressions,
			Clicks:      s.Clicks,
			CTR:         s.CTR,
		}
		if ok {
			v.Platform = meta.Platform
			v.PlatformID = meta.PlatformID
			v.Title = meta.Title
			v.ThumbnailURL = meta.ThumbnailURL
			v.DurationSec = meta.DurationSec
			v.Username = meta.Username
			v.CreatedAt = meta.CreatedAt.Format("2006-01-02T15:04:05Z")
		}
		videos = append(videos, v)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"videos":           videos,
		"total":            chResult.Total,
		"page":             chResult.Page,
		"per_page":         chResult.PerPage,
		"total_pages":      chResult.TotalPages,
		"total_impressions": totalStats.TotalImpressions,
		"total_clicks":     totalStats.TotalClicks,
		"total_ctr":        totalStats.TotalCTR,
	})
}

// ─── Categories ──────────────────────────────────────────────────────────────

// ListCategories handles GET /api/v1/admin/categories
func (h *AdminHandler) ListCategories(w http.ResponseWriter, r *http.Request) {
	categories, err := h.admin.ListCategories(r.Context())
	if err != nil {
		slog.Error("admin: list categories", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list categories")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"categories": categories})
}

// ─── Sites ───────────────────────────────────────────────────────────────────

// GetSite handles GET /api/v1/admin/sites/{id}
func (h *AdminHandler) GetSite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site id")
		return
	}

	site, err := h.admin.GetSiteByID(r.Context(), id)
	if err != nil {
		slog.Error("admin: get site", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to get site")
		return
	}
	if site == nil {
		writeError(w, http.StatusNotFound, "site not found")
		return
	}
	writeJSON(w, http.StatusOK, site)
}

// UpdateSite handles PUT /api/v1/admin/sites/{id}
func (h *AdminHandler) UpdateSite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site id")
		return
	}

	var body struct {
		Config json.RawMessage `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.admin.UpdateSiteConfig(r.Context(), id, body.Config); err != nil {
		if err.Error() == "site not found" {
			writeError(w, http.StatusNotFound, "site not found")
			return
		}
		slog.Error("admin: update site", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to update site")
		return
	}

	// Invalidate cache for this site and accounts (site_config is embedded in account responses).
	if h.cache != nil {
		h.cache.InvalidateSite(r.Context(), id)
		h.cache.InvalidateAccounts(r.Context())
	}

	site, err := h.admin.GetSiteByID(r.Context(), id)
	if err != nil {
		slog.Error("admin: get site after update", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to get site")
		return
	}
	writeJSON(w, http.StatusOK, site)
}

// ListSites handles GET /api/v1/admin/sites
func (h *AdminHandler) ListSites(w http.ResponseWriter, r *http.Request) {
	sites, err := h.admin.ListSites(r.Context())
	if err != nil {
		slog.Error("admin: list sites", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list sites")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"sites": sites})
}

// RefreshSiteContent handles POST /api/v1/admin/sites/{id}/refresh
// Enqueues all active accounts for reparse and invalidates the site cache.
func (h *AdminHandler) RefreshSiteContent(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid site id")
		return
	}

	// Verify site exists.
	site, err := h.admin.GetSiteByID(r.Context(), id)
	if err != nil {
		slog.Error("admin: refresh site", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to find site")
		return
	}
	if site == nil {
		writeError(w, http.StatusNotFound, "site not found")
		return
	}

	// Enqueue all active accounts for reparse.
	count, err := h.admin.ReparseAllAccounts(r.Context())
	if err != nil {
		slog.Error("admin: refresh site reparse", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to enqueue reparse")
		return
	}

	// Invalidate all cached data for this site.
	if h.cache != nil {
		h.cache.InvalidateSite(r.Context(), id)
	}

	if count > 0 {
		h.workerMgr.EnsureRunning()
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":   "ok",
		"enqueued": count,
	})
}

// ─── Banner Sizes ─────────────────────────────────────────────────────────────

// ListBannerSizes handles GET /api/v1/admin/banner-sizes
func (h *AdminHandler) ListBannerSizes(w http.ResponseWriter, r *http.Request) {
	sizes, err := h.admin.ListBannerSizes(r.Context())
	if err != nil {
		slog.Error("admin: list banner sizes", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list banner sizes")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"sizes": sizes})
}

// CreateBannerSize handles POST /api/v1/admin/banner-sizes
func (h *AdminHandler) CreateBannerSize(w http.ResponseWriter, r *http.Request) {
	var input store.CreateBannerSizeInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.Width <= 0 || input.Height <= 0 {
		writeError(w, http.StatusBadRequest, "width and height must be positive")
		return
	}

	size, err := h.admin.CreateBannerSize(r.Context(), input)
	if err != nil {
		slog.Error("admin: create banner size", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create banner size")
		return
	}
	writeJSON(w, http.StatusCreated, size)
}

// UpdateBannerSize handles PUT /api/v1/admin/banner-sizes/{id}
func (h *AdminHandler) UpdateBannerSize(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid banner size id")
		return
	}

	var body struct {
		IsActive bool `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.admin.UpdateBannerSize(r.Context(), id, body.IsActive); err != nil {
		if err.Error() == "banner size not found" {
			writeError(w, http.StatusNotFound, "banner size not found")
			return
		}
		slog.Error("admin: update banner size", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to update banner size")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ─── Banners ──────────────────────────────────────────────────────────────────

// GetAccountBannerSummary handles GET /api/v1/admin/accounts/{id}/banners/summary
func (h *AdminHandler) GetAccountBannerSummary(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	summary, err := h.admin.GetAccountBannerSummary(r.Context(), id)
	if err != nil {
		slog.Error("admin: banner summary", "error", err, "account_id", id)
		writeError(w, http.StatusInternalServerError, "failed to get banner summary")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"sizes": summary})
}

// ListAccountBanners handles GET /api/v1/admin/accounts/{id}/banners
func (h *AdminHandler) ListAccountBanners(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	sizeID, _ := strconv.ParseInt(r.URL.Query().Get("size_id"), 10, 64)
	page := intParam(r, "page", 1)
	perPage := intParam(r, "per_page", 20)

	result, err := h.admin.ListAccountBanners(r.Context(), id, sizeID, page, perPage)
	if err != nil {
		slog.Error("admin: list account banners", "error", err, "account_id", id)
		writeError(w, http.StatusInternalServerError, "failed to list banners")
		return
	}
	h.enrichBannerStats(r.Context(), result.Banners)
	writeJSON(w, http.StatusOK, result)
}

// GenerateAccountBanners handles POST /api/v1/admin/accounts/{id}/banners/generate
func (h *AdminHandler) GenerateAccountBanners(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	if err := h.admin.EnqueueBannerGeneration(r.Context(), id, 0); err != nil {
		slog.Error("admin: generate banners", "error", err, "account_id", id)
		writeError(w, http.StatusInternalServerError, "failed to enqueue banner generation")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "enqueued"})
}

// ListAllBanners handles GET /api/v1/admin/banners
func (h *AdminHandler) ListAllBanners(w http.ResponseWriter, r *http.Request) {
	page := intParam(r, "page", 1)
	perPage := intParam(r, "per_page", 20)

	result, err := h.admin.ListAllBanners(r.Context(), page, perPage)
	if err != nil {
		slog.Error("admin: list all banners", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list banners")
		return
	}
	h.enrichBannerStats(r.Context(), result.Banners)
	writeJSON(w, http.StatusOK, result)
}

// enrichBannerStats fetches banner impression/click stats from ClickHouse and populates AdminBanner fields.
func (h *AdminHandler) enrichBannerStats(ctx context.Context, banners []store.AdminBanner) {
	if len(banners) == 0 {
		return
	}
	videoIDs := make([]int64, 0, len(banners))
	for _, b := range banners {
		videoIDs = append(videoIDs, b.VideoID)
	}
	stats, err := h.ch.GetBannerStats(ctx, videoIDs)
	if err != nil {
		slog.Error("admin: get banner stats", "error", err)
		return
	}
	for i := range banners {
		if s, ok := stats[banners[i].VideoID]; ok {
			banners[i].Impressions = s.Impressions
			banners[i].Hovers = s.Hovers
			banners[i].Clicks = s.Clicks
			banners[i].CTR = s.CTR
		}
	}
}

// ─── Ad Sources ───────────────────────────────────────────────────────────────

// ListAdSources handles GET /api/v1/admin/ad-sources
func (h *AdminHandler) ListAdSources(w http.ResponseWriter, r *http.Request) {
	sources, err := h.admin.ListAdSources(r.Context())
	if err != nil {
		slog.Error("admin: list ad sources", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list ad sources")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"ad_sources": sources})
}

// CreateAdSource handles POST /api/v1/admin/ad-sources
func (h *AdminHandler) CreateAdSource(w http.ResponseWriter, r *http.Request) {
	var input store.CreateAdSourceInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	source, err := h.admin.CreateAdSource(r.Context(), input)
	if err != nil {
		slog.Error("admin: create ad source", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create ad source")
		return
	}
	writeJSON(w, http.StatusCreated, source)
}

// UpdateAdSource handles PUT /api/v1/admin/ad-sources/{id}
func (h *AdminHandler) UpdateAdSource(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid ad source id")
		return
	}

	var input store.UpdateAdSourceInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	source, err := h.admin.UpdateAdSource(r.Context(), id, input)
	if err != nil {
		if err.Error() == "ad source not found" {
			writeError(w, http.StatusNotFound, "ad source not found")
			return
		}
		slog.Error("admin: update ad source", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to update ad source")
		return
	}
	writeJSON(w, http.StatusOK, source)
}

// ─── Banner Funnel Analytics ──────────────────────────────────────────────────

// GetBannerFunnel handles GET /api/v1/admin/banner-funnel
func (h *AdminHandler) GetBannerFunnel(w http.ResponseWriter, r *http.Request) {
	days := intParam(r, "days", 30)
	if days < 1 || days > 365 {
		days = 30
	}

	stats, err := h.ch.GetBannerFunnelStats(r.Context(), days)
	if err != nil {
		slog.Error("admin: banner funnel stats", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get banner funnel stats")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"funnel": stats, "days": days})
}

// ─── Conversion Postbacks ─────────────────────────────────────────────────────

// ListPostbacks handles GET /api/v1/admin/postbacks
func (h *AdminHandler) ListPostbacks(w http.ResponseWriter, r *http.Request) {
	limit := intParam(r, "limit", 50)
	if limit < 1 || limit > 200 {
		limit = 50
	}

	postbacks, err := h.admin.ListRecentPostbacks(r.Context(), limit)
	if err != nil {
		slog.Error("admin: list postbacks", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list postbacks")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"postbacks": postbacks})
}
