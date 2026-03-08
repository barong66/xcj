package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/xcj/videosite-api/internal/cache"
	"github.com/xcj/videosite-api/internal/clickhouse"
	s3client "github.com/xcj/videosite-api/internal/s3"
	"github.com/xcj/videosite-api/internal/store"
	"github.com/xcj/videosite-api/internal/worker"
	"golang.org/x/image/draw"
)

type AdminHandler struct {
	admin     *store.AdminStore
	ch        *clickhouse.Reader
	workerMgr *worker.Manager
	cache     *cache.Cache
	s3        *s3client.Client
}

func NewAdminHandler(admin *store.AdminStore, ch *clickhouse.Reader, workerMgr *worker.Manager, c *cache.Cache, s3 *s3client.Client) *AdminHandler {
	return &AdminHandler{admin: admin, ch: ch, workerMgr: workerMgr, cache: c, s3: s3}
}

// AdminAuth returns middleware that checks the Bearer token against the provided admin token.
func AdminAuth(adminToken string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			if auth == "" {
				writeError(w, http.StatusUnauthorized, "authorization header required")
				return
			}

			parts := strings.SplitN(auth, " ", 2)
			if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" || parts[1] != adminToken {
				writeError(w, http.StatusUnauthorized, "invalid token")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
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

// BatchDeactivateBanners handles POST /api/v1/admin/banners/batch-deactivate
func (h *AdminHandler) BatchDeactivateBanners(w http.ResponseWriter, r *http.Request) {
	var input struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(input.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids are required")
		return
	}

	count, err := h.admin.BatchDeactivateBanners(r.Context(), input.IDs)
	if err != nil {
		slog.Error("admin: batch deactivate banners", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to deactivate banners")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"deactivated": count})
}

// BatchRegenerateBanners handles POST /api/v1/admin/banners/batch-regenerate
func (h *AdminHandler) BatchRegenerateBanners(w http.ResponseWriter, r *http.Request) {
	var input struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(input.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids are required")
		return
	}

	count, err := h.admin.BatchRegenerateBanners(r.Context(), input.IDs)
	if err != nil {
		slog.Error("admin: batch regenerate banners", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to regenerate banners")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"enqueued": count})
}

// DeactivateBanner handles DELETE /api/v1/admin/banners/{id}
func (h *AdminHandler) DeactivateBanner(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid banner id")
		return
	}

	if err := h.admin.DeactivateBanner(r.Context(), id); err != nil {
		if err.Error() == "banner not found" {
			writeError(w, http.StatusNotFound, "banner not found")
			return
		}
		slog.Error("admin: deactivate banner", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to deactivate banner")
		return
	}
	w.WriteHeader(http.StatusNoContent)
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

// ─── Account Stats ───────────────────────────────────────────────────────────

// GetAccountStats handles GET /api/v1/admin/accounts/{id}/stats
func (h *AdminHandler) GetAccountStats(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	days := intParam(r, "days", 30)
	if days < 1 || days > 365 {
		days = 30
	}

	stats, err := h.ch.GetAccountFunnelStats(r.Context(), id, days)
	if err != nil {
		slog.Error("admin: account stats", "error", err, "account_id", id)
		writeError(w, http.StatusInternalServerError, "failed to get account stats")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"stats":   stats.Days,
		"summary": stats.Summary,
		"days":    days,
	})
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

// ─── Performance Metrics ─────────────────────────────────────────────────────

// GetPerfSummary handles GET /api/v1/admin/perf-summary
func (h *AdminHandler) GetPerfSummary(w http.ResponseWriter, r *http.Request) {
	days := intParam(r, "days", 7)
	if days < 1 || days > 365 {
		days = 7
	}
	stats, err := h.ch.GetPerfSummary(r.Context(), days)
	if err != nil {
		slog.Error("admin: perf summary", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get perf summary")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// GetDeviceBreakdown handles GET /api/v1/admin/device-breakdown
func (h *AdminHandler) GetDeviceBreakdown(w http.ResponseWriter, r *http.Request) {
	days := intParam(r, "days", 7)
	if days < 1 || days > 365 {
		days = 7
	}
	stats, err := h.ch.GetDeviceBreakdown(r.Context(), days)
	if err != nil {
		slog.Error("admin: device breakdown", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get device breakdown")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// GetReferrerStats handles GET /api/v1/admin/referrer-stats
func (h *AdminHandler) GetReferrerStats(w http.ResponseWriter, r *http.Request) {
	days := intParam(r, "days", 7)
	if days < 1 || days > 365 {
		days = 7
	}
	stats, err := h.ch.GetReferrerStats(r.Context(), days)
	if err != nil {
		slog.Error("admin: referrer stats", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get referrer stats")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// ─── Traffic Explorer ─────────────────────────────────────────────────────────

// GetTrafficStats handles GET /api/v1/admin/traffic-stats
func (h *AdminHandler) GetTrafficStats(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	groupBy := q.Get("group_by")
	if groupBy == "" {
		groupBy = "date"
	}

	days := intParam(r, "days", 30)
	if days < 1 || days > 365 {
		days = 30
	}

	filterKeys := []string{"source", "country", "device_type", "browser", "os",
		"event_type", "utm_source", "utm_medium", "utm_campaign", "referrer"}
	filters := make(map[string]string)
	for _, key := range filterKeys {
		if val := q.Get(key); val != "" {
			filters[key] = val
		}
	}

	params := clickhouse.TrafficStatsParams{
		GroupBy:  groupBy,
		GroupBy2: q.Get("group_by2"),
		Days:     days,
		Filters:  filters,
		SortBy:   q.Get("sort"),
		SortDir:  q.Get("dir"),
	}

	result, err := h.ch.GetTrafficStats(r.Context(), params)
	if err != nil {
		slog.Error("admin: traffic stats", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get traffic stats")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// GetTrafficDimensions handles GET /api/v1/admin/traffic-stats/dimensions
func (h *AdminHandler) GetTrafficDimensions(w http.ResponseWriter, r *http.Request) {
	days := intParam(r, "days", 30)
	if days < 1 || days > 365 {
		days = 30
	}

	dims, err := h.ch.GetTrafficDimensions(r.Context(), days)
	if err != nil {
		slog.Error("admin: traffic dimensions", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get dimensions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"dimensions": dims})
}

// ─── Banner Recrop ────────────────────────────────────────────────────────────

// RecropBanner handles POST /api/v1/admin/banners/{id}/recrop
func (h *AdminHandler) RecropBanner(w http.ResponseWriter, r *http.Request) {
	if h.s3 == nil {
		writeError(w, http.StatusServiceUnavailable, "S3 not configured")
		return
	}

	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid banner id")
		return
	}

	var input struct {
		X      int `json:"x"`
		Y      int `json:"y"`
		Width  int `json:"width"`
		Height int `json:"height"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.Width <= 0 || input.Height <= 0 {
		writeError(w, http.StatusBadRequest, "width and height must be positive")
		return
	}

	// Get banner info and source image URL.
	info, err := h.admin.GetBannerForRecrop(r.Context(), id)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			writeError(w, http.StatusNotFound, "banner not found")
			return
		}
		slog.Error("admin: get banner for recrop", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to get banner")
		return
	}
	if info.SourceImageURL == "" {
		writeError(w, http.StatusBadRequest, "no source image available")
		return
	}

	// Validate source URL — only allow our own media domain.
	parsedURL, err := url.Parse(info.SourceImageURL)
	if err != nil || (parsedURL.Host != "media.temptguide.com" && parsedURL.Host != "localhost") {
		writeError(w, http.StatusBadRequest, "invalid source image URL")
		return
	}

	// Download source image with timeout and size limit.
	httpClient := &http.Client{Timeout: 30 * time.Second}
	resp, err := httpClient.Get(info.SourceImageURL)
	if err != nil {
		slog.Error("admin: download source image", "error", err, "url", info.SourceImageURL)
		writeError(w, http.StatusInternalServerError, "failed to download source image")
		return
	}
	defer resp.Body.Close()

	const maxImageSize = 20 << 20 // 20 MB
	limitedReader := io.LimitReader(resp.Body, maxImageSize+1)
	srcData, err := io.ReadAll(limitedReader)
	if err != nil {
		slog.Error("admin: read source image", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read source image")
		return
	}
	if len(srcData) > maxImageSize {
		writeError(w, http.StatusBadRequest, "source image too large (max 20MB)")
		return
	}

	// Decode image.
	srcImg, _, err := image.Decode(bytes.NewReader(srcData))
	if err != nil {
		slog.Error("admin: decode source image", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to decode source image")
		return
	}

	// Validate image dimensions.
	bounds := srcImg.Bounds()
	if bounds.Dx() > 10000 || bounds.Dy() > 10000 {
		writeError(w, http.StatusBadRequest, "source image too large (max 10000x10000)")
		return
	}
	if input.X < 0 || input.Y < 0 ||
		input.X+input.Width > bounds.Dx() || input.Y+input.Height > bounds.Dy() {
		writeError(w, http.StatusBadRequest, "crop area out of bounds")
		return
	}

	// Crop.
	cropRect := image.Rect(input.X, input.Y, input.X+input.Width, input.Y+input.Height)
	type subImager interface {
		SubImage(r image.Rectangle) image.Image
	}
	si, ok := srcImg.(subImager)
	if !ok {
		writeError(w, http.StatusInternalServerError, "image does not support cropping")
		return
	}
	cropped := si.SubImage(cropRect)

	// Resize to banner dimensions.
	dst := image.NewRGBA(image.Rect(0, 0, info.Width, info.Height))
	draw.CatmullRom.Scale(dst, dst.Bounds(), cropped, cropped.Bounds(), draw.Over, nil)

	// Encode as JPEG.
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 90}); err != nil {
		slog.Error("admin: encode recropped image", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to encode image")
		return
	}

	// Build S3 key (same pattern as parser).
	var s3Key string
	if info.VideoFrameID != nil {
		s3Key = fmt.Sprintf("banners/%d/%d_f%d_%dx%d.jpg",
			info.AccountID, info.VideoID, *info.VideoFrameID, info.Width, info.Height)
	} else {
		s3Key = fmt.Sprintf("banners/%d/%d_%dx%d.jpg",
			info.AccountID, info.VideoID, info.Width, info.Height)
	}

	// Upload to R2.
	publicURL, err := h.s3.Upload(r.Context(), s3Key, bytes.NewReader(buf.Bytes()), int64(buf.Len()), "image/jpeg")
	if err != nil {
		slog.Error("admin: upload recropped banner", "error", err, "key", s3Key)
		writeError(w, http.StatusInternalServerError, "failed to upload image")
		return
	}

	// Add cache-busting timestamp.
	imageURL := fmt.Sprintf("%s?v=%d", publicURL, time.Now().Unix())

	// Update banner record.
	if err := h.admin.UpdateBannerImageURL(r.Context(), id, imageURL); err != nil {
		slog.Error("admin: update banner image url", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to update banner")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"image_url": imageURL})
}

// ─── Account Conversion Prices ────────────────────────────────────────────────

var allowedConversionEvents = map[string]bool{
	"social_click":  true,
	"content_click": true,
}

// GetAccountConversionPrices handles GET /api/v1/admin/accounts/{id}/conversion-prices
func (h *AdminHandler) GetAccountConversionPrices(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	prices, err := h.admin.GetAccountConversionPrices(r.Context(), id)
	if err != nil {
		slog.Error("admin: get conversion prices", "error", err, "account_id", id)
		writeError(w, http.StatusInternalServerError, "failed to get conversion prices")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"prices": prices})
}

// UpsertAccountConversionPrice handles PUT /api/v1/admin/accounts/{id}/conversion-prices
func (h *AdminHandler) UpsertAccountConversionPrice(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	var input struct {
		EventType string  `json:"event_type"`
		Price     float64 `json:"price"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !allowedConversionEvents[input.EventType] {
		writeError(w, http.StatusBadRequest, "invalid event type")
		return
	}
	if input.Price < 0 {
		writeError(w, http.StatusBadRequest, "price must be non-negative")
		return
	}

	price, err := h.admin.UpsertAccountConversionPrice(r.Context(), id, input.EventType, input.Price)
	if err != nil {
		slog.Error("admin: upsert conversion price", "error", err, "account_id", id)
		writeError(w, http.StatusInternalServerError, "failed to save conversion price")
		return
	}
	writeJSON(w, http.StatusOK, price)
}

// ─── Account Source Event IDs ─────────────────────────────────────────────────

// GetAccountSourceEventIDs handles GET /api/v1/admin/accounts/{id}/source-event-ids
func (h *AdminHandler) GetAccountSourceEventIDs(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	items, err := h.admin.GetAccountSourceEventIDs(r.Context(), id)
	if err != nil {
		slog.Error("admin: get source event ids", "error", err, "account_id", id)
		writeError(w, http.StatusInternalServerError, "failed to get source event ids")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"items": items})
}

// UpsertAccountSourceEventID handles PUT /api/v1/admin/accounts/{id}/source-event-ids
func (h *AdminHandler) UpsertAccountSourceEventID(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	var input struct {
		AdSourceID int64  `json:"ad_source_id"`
		EventType  string `json:"event_type"`
		EventID    int    `json:"event_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.AdSourceID <= 0 {
		writeError(w, http.StatusBadRequest, "ad_source_id is required")
		return
	}
	if !allowedConversionEvents[input.EventType] {
		writeError(w, http.StatusBadRequest, "invalid event type")
		return
	}
	if input.EventID < 1 || input.EventID > 9 {
		writeError(w, http.StatusBadRequest, "event_id must be 1-9")
		return
	}

	item, err := h.admin.UpsertAccountSourceEventID(r.Context(), id, input.AdSourceID, input.EventType, input.EventID)
	if err != nil {
		slog.Error("admin: upsert source event id", "error", err, "account_id", id)
		writeError(w, http.StatusInternalServerError, "failed to save source event id")
		return
	}
	writeJSON(w, http.StatusOK, item)
}
