package handler

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/xcj/videosite-api/internal/clickhouse"
	"github.com/xcj/videosite-api/internal/model"
	"github.com/xcj/videosite-api/internal/store"
)

type BannerHandler struct {
	admin  *store.AdminStore
	buffer *clickhouse.EventBuffer
}

func NewBannerHandler(admin *store.AdminStore, buffer *clickhouse.EventBuffer) *BannerHandler {
	return &BannerHandler{admin: admin, buffer: buffer}
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

	// Log banner_impression event.
	ip := r.RemoteAddr
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		ip = strings.TrimSpace(parts[0])
	}

	h.buffer.Push(model.Event{
		SiteID:    0, // banner serving is site-agnostic
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_impression",
		UserAgent: r.UserAgent(),
		IP:        ip,
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

	// Log banner_click event.
	ip := r.RemoteAddr
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		ip = strings.TrimSpace(parts[0])
	}

	h.buffer.Push(model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_click",
		UserAgent: r.UserAgent(),
		IP:        ip,
		Referrer:  r.Referer(),
		Extra:     fmt.Sprintf(`{"banner_id":%d}`, banner.ID),
		CreatedAt: time.Now().UTC(),
	})

	// Redirect to model profile page.
	slug, err := h.admin.GetAccountSlug(r.Context(), banner.AccountID)
	if err != nil || slug == "" {
		slug = fmt.Sprintf("account/%d", banner.AccountID)
	}

	// Use the first configured site domain or fallback.
	targetURL := fmt.Sprintf("/model/%s", slug)
	http.Redirect(w, r, targetURL, http.StatusFound)
}
