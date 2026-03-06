package handler

import (
	"fmt"
	"html"
	"log/slog"
	"math/rand"
	"net/http"
	"net/url"
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

// bannerExtra builds the JSON extra field for banner events.
func bannerExtra(bannerID int64, clickID string) string {
	if clickID != "" {
		return fmt.Sprintf(`{"banner_id":%d,"click_id":%q}`, bannerID, clickID)
	}
	return fmt.Sprintf(`{"banner_id":%d}`, bannerID)
}

// 1x1 transparent GIF for pixel tracking responses.
var transparentGIF = []byte{
	0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
	0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21,
	0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
	0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
	0x01, 0x00, 0x3b,
}

func writeTransparentPixel(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "image/gif")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Write(transparentGIF)
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

	src := r.URL.Query().Get("src")
	clickID := r.URL.Query().Get("click_id")

	h.buffer.Push(model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_impression",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     bannerExtra(banner.ID, clickID),
		Source:    src,
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

	src := r.URL.Query().Get("src")
	clickID := r.URL.Query().Get("click_id")

	h.buffer.Push(model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_click",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     bannerExtra(banner.ID, clickID),
		Source:    src,
		CreatedAt: time.Now().UTC(),
	})

	slug, err := h.admin.GetAccountSlug(r.Context(), banner.AccountID)
	if err != nil || slug == "" {
		slug = fmt.Sprintf("account/%d", banner.AccountID)
	}

	targetURL := fmt.Sprintf("/model/%s", slug)
	// Propagate source params to the landing page.
	if src != "" || clickID != "" {
		params := url.Values{}
		if src != "" {
			params.Set("src", src)
		}
		if clickID != "" {
			params.Set("click_id", clickID)
		}
		targetURL += "?" + params.Encode()
	}
	if h.siteBaseURL != "" {
		targetURL = h.siteBaseURL + targetURL
	}
	http.Redirect(w, r, targetURL, http.StatusFound)
}

// HoverBanner handles GET /b/{id}/hover — logs a banner hover event and returns a 1x1 pixel.
func (h *BannerHandler) HoverBanner(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeTransparentPixel(w)
		return
	}

	banner, err := h.admin.GetBannerByID(r.Context(), id)
	if err != nil || banner == nil || !banner.IsActive {
		writeTransparentPixel(w)
		return
	}

	src := r.URL.Query().Get("src")
	clickID := r.URL.Query().Get("click_id")

	h.buffer.Push(model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_hover",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     bannerExtra(banner.ID, clickID),
		Source:    src,
		CreatedAt: time.Now().UTC(),
	})

	writeTransparentPixel(w)
}

// ServeDynamic handles GET /b/serve — returns an HTML page with a random banner
// from the pool matching the requested size and optional targeting.
//
// Query params:
//   - size: "300x250" (or w + h separately)
//   - cat:  category slug
//   - kw:   keyword (matches video title/description)
//   - aid:  account ID
//   - src:  traffic source identifier
//   - click_id: ad network click ID for conversion tracking
func (h *BannerHandler) ServeDynamic(w http.ResponseWriter, r *http.Request) {
	width, height := parseBannerSize(r)
	if width <= 0 || height <= 0 {
		http.Error(w, "missing or invalid size", http.StatusBadRequest)
		return
	}

	cat := r.URL.Query().Get("cat")
	kw := r.URL.Query().Get("kw")
	aid, _ := strconv.ParseInt(r.URL.Query().Get("aid"), 10, 64)
	src := r.URL.Query().Get("src")
	clickID := r.URL.Query().Get("click_id")

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

	// Determine source: use explicit src param, fallback to "serve".
	eventSource := src
	if eventSource == "" {
		eventSource = "serve"
	}

	// Log impression asynchronously.
	h.buffer.Push(model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_impression",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     bannerExtra(banner.ID, clickID),
		Source:    eventSource,
		CreatedAt: time.Now().UTC(),
	})

	// Build click URL with source params.
	clickURL := fmt.Sprintf("/b/%d/click", banner.ID)
	if src != "" || clickID != "" {
		params := url.Values{}
		if src != "" {
			params.Set("src", src)
		}
		if clickID != "" {
			params.Set("click_id", clickID)
		}
		clickURL += "?" + params.Encode()
	}
	if h.siteBaseURL != "" {
		clickURL = h.siteBaseURL + clickURL
	}

	// Build hover pixel URL.
	hoverURL := fmt.Sprintf("/b/%d/hover", banner.ID)
	if src != "" || clickID != "" {
		params := url.Values{}
		if src != "" {
			params.Set("src", src)
		}
		if clickID != "" {
			params.Set("click_id", clickID)
		}
		hoverURL += "?" + params.Encode()
	}
	if h.siteBaseURL != "" {
		hoverURL = h.siteBaseURL + hoverURL
	}

	// Escape URLs for safe HTML embedding.
	safeClickURL := html.EscapeString(clickURL)
	safeHoverURL := html.EscapeString(hoverURL)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>*{margin:0;padding:0}body{overflow:hidden}</style></head>
<body>
<a id="b" href="%s" target="_top">
<img src="%s" width="%d" height="%d" style="display:block" alt="">
</a>
<script>
(function(){var d=false;document.getElementById('b').addEventListener('mouseenter',function(){if(d)return;d=true;new Image().src='%s';});})();
</script>
</body></html>`, safeClickURL, html.EscapeString(banner.ImageURL), banner.Width, banner.Height, safeHoverURL)
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
		slog.Info("banner: cache hit", "key", cacheKey, "count", len(pool))
		return pool
	}

	// Cache miss — query DB.
	var err error
	pool, err = h.admin.ListServableBanners(ctx, width, height, cat, aid)
	if err != nil {
		slog.Error("banner: serve query", "error", err)
		return nil
	}

	slog.Info("banner: cache miss", "key", cacheKey, "count", len(pool))
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
