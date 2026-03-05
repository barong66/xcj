package handler

import (
	"fmt"
	"log/slog"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/xcj/videosite-api/internal/cache"
	"github.com/xcj/videosite-api/internal/clickhouse"
	"github.com/xcj/videosite-api/internal/model"
	"github.com/xcj/videosite-api/internal/store"
)

type BannerHandler struct {
	admin       *store.AdminStore
	buffer      *clickhouse.EventBuffer
	cache       *cache.Cache
	siteBaseURL string
}

func NewBannerHandler(admin *store.AdminStore, buffer *clickhouse.EventBuffer, c *cache.Cache, siteBaseURL string) *BannerHandler {
	return &BannerHandler{admin: admin, buffer: buffer, cache: c, siteBaseURL: siteBaseURL}
}

// clientIP extracts the real client IP from X-Forwarded-For or RemoteAddr.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		return strings.TrimSpace(parts[0])
	}
	return r.RemoteAddr
}

// ServeBanner handles GET /b/{id} — redirects to the banner image URL and logs an impression.
func (h *BannerHandler) ServeBanner(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	banner, err := h.admin.GetBannerByID(r.Context(), id)
	if err != nil {
		slog.Error("banner: serve", "error", err, "id", id)
		http.NotFound(w, r)
		return
	}
	if banner == nil || !banner.IsActive {
		http.NotFound(w, r)
		return
	}

	h.buffer.Push(model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_impression",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     fmt.Sprintf(`{"banner_id":%d}`, banner.ID),
		CreatedAt: time.Now().UTC(),
	})

	http.Redirect(w, r, banner.ImageURL, http.StatusFound)
}

// ClickBanner handles GET /b/{id}/click — redirects to the model profile and logs a click.
func (h *BannerHandler) ClickBanner(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	banner, err := h.admin.GetBannerByID(r.Context(), id)
	if err != nil {
		slog.Error("banner: click", "error", err, "id", id)
		http.NotFound(w, r)
		return
	}
	if banner == nil || !banner.IsActive {
		http.NotFound(w, r)
		return
	}

	h.buffer.Push(model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_click",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     fmt.Sprintf(`{"banner_id":%d}`, banner.ID),
		CreatedAt: time.Now().UTC(),
	})

	slug, err := h.admin.GetAccountSlug(r.Context(), banner.AccountID)
	if err != nil || slug == "" {
		slug = fmt.Sprintf("account/%d", banner.AccountID)
	}

	targetURL := fmt.Sprintf("/model/%s", slug)
	if h.siteBaseURL != "" {
		targetURL = h.siteBaseURL + targetURL
	}
	http.Redirect(w, r, targetURL, http.StatusFound)
}

// ServeDynamic handles GET /b/serve — returns an HTML page with a random banner
// from the pool matching the requested size and optional targeting.
//
// Query params:
//   - size: "300x250" (or w + h separately)
//   - cat:  category slug
//   - kw:   keyword (matches video title/description)
//   - aid:  account ID
func (h *BannerHandler) ServeDynamic(w http.ResponseWriter, r *http.Request) {
	width, height := parseBannerSize(r)
	if width <= 0 || height <= 0 {
		http.Error(w, "missing or invalid size", http.StatusBadRequest)
		return
	}

	cat := r.URL.Query().Get("cat")
	kw := r.URL.Query().Get("kw")
	aid, _ := strconv.ParseInt(r.URL.Query().Get("aid"), 10, 64)

	pool := h.getBannerPool(r, width, height, cat, kw, aid)

	// No-cache headers + allow iframe embedding.
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Del("X-Frame-Options")

	if len(pool) == 0 {
		// Graceful degradation: empty transparent page.
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `<!DOCTYPE html><html><head><style>body{margin:0}</style></head><body></body></html>`)
		return
	}

	banner := pool[rand.Intn(len(pool))]

	// Log impression asynchronously.
	h.buffer.Push(model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_impression",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     fmt.Sprintf(`{"banner_id":%d}`, banner.ID),
		Source:    "serve",
		CreatedAt: time.Now().UTC(),
	})

	clickURL := fmt.Sprintf("/b/%d/click", banner.ID)
	if h.siteBaseURL != "" {
		clickURL = h.siteBaseURL + clickURL
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>*{margin:0;padding:0}body{overflow:hidden}</style></head>
<body>
<a href="%s" target="_top">
<img src="%s" width="%d" height="%d" style="display:block" alt="">
</a>
</body></html>`, clickURL, banner.ImageURL, banner.Width, banner.Height)
}

// getBannerPool returns the pool of eligible banners, using Redis cache when possible.
func (h *BannerHandler) getBannerPool(r *http.Request, width, height int, cat, kw string, aid int64) []store.ServableBanner {
	ctx := r.Context()

	// Keyword queries are not cached (too many variations).
	if kw != "" {
		pool, err := h.admin.ListServableBannersByKeyword(ctx, width, height, kw)
		if err != nil {
			slog.Error("banner: serve kw query", "error", err)
			return nil
		}
		return pool
	}

	// Determine cache key.
	var cacheKey string
	switch {
	case aid > 0:
		cacheKey = cache.BannerPoolAccKey(width, height, aid)
	case cat != "":
		cacheKey = cache.BannerPoolCatKey(width, height, cat)
	default:
		cacheKey = cache.BannerPoolKey(width, height)
	}

	// Try cache.
	var pool []store.ServableBanner
	if h.cache.GetJSON(ctx, cacheKey, &pool) {
		return pool
	}

	// Cache miss — query DB.
	var err error
	pool, err = h.admin.ListServableBanners(ctx, width, height, cat, aid)
	if err != nil {
		slog.Error("banner: serve query", "error", err)
		return nil
	}

	// Cache the result (even if empty, to avoid repeated misses).
	h.cache.SetList(ctx, cacheKey, pool)
	return pool
}

// parseBannerSize extracts width and height from "size=WxH" or "w=W&h=H" query params.
func parseBannerSize(r *http.Request) (int, int) {
	if sizeStr := r.URL.Query().Get("size"); sizeStr != "" {
		parts := strings.SplitN(sizeStr, "x", 2)
		if len(parts) == 2 {
			w, _ := strconv.Atoi(parts[0])
			h, _ := strconv.Atoi(parts[1])
			return w, h
		}
	}
	w, _ := strconv.Atoi(r.URL.Query().Get("w"))
	h, _ := strconv.Atoi(r.URL.Query().Get("h"))
	return w, h
}
