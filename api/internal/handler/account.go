package handler

import (
	"encoding/json"
	"log/slog"
	"math"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/xcj/videosite-api/internal/cache"
	"github.com/xcj/videosite-api/internal/middleware"
	"github.com/xcj/videosite-api/internal/model"
	"github.com/xcj/videosite-api/internal/store"
)

type AccountHandler struct {
	accounts *store.AccountStore
	cache    *cache.Cache
}

func NewAccountHandler(accounts *store.AccountStore, cache *cache.Cache) *AccountHandler {
	return &AccountHandler{accounts: accounts, cache: cache}
}

// accountResponse wraps Account with pagination fields and site config.
type accountResponse struct {
	model.Account
	Page       int             `json:"page"`
	Pages      int             `json:"pages"`
	Total      int             `json:"total"`
	SiteConfig json.RawMessage `json:"site_config,omitempty"`
}

func buildAccountResponse(a *model.Account, page, perPage int, site *model.Site) accountResponse {
	totalPages := int(math.Ceil(float64(a.VideoCount) / float64(perPage)))
	if totalPages < 1 {
		totalPages = 1
	}
	resp := accountResponse{
		Account: *a,
		Page:    page,
		Pages:   totalPages,
		Total:   int(a.VideoCount),
	}
	if site != nil && len(site.Config) > 0 {
		resp.SiteConfig = site.Config
	}
	return resp
}

// Get handles GET /api/v1/accounts/{id}
func (h *AccountHandler) Get(w http.ResponseWriter, r *http.Request) {
	site := middleware.SiteFromContext(r.Context())
	if site == nil {
		writeError(w, http.StatusInternalServerError, "site not resolved")
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid account id")
		return
	}

	page := intParam(r, "page", 1)
	perPage := intParam(r, "per_page", 24)

	// Try cache (only first page).
	if page == 1 {
		cacheKey := cache.AccountKey(id, perPage)
		var cached accountResponse
		if h.cache.GetJSON(r.Context(), cacheKey, &cached) {
			writeJSON(w, http.StatusOK, cached)
			return
		}
	}

	account, err := h.accounts.GetByID(r.Context(), id, site.ID, page, perPage)
	if err != nil {
		slog.Error("handler: get account", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to get account")
		return
	}

	if account == nil {
		writeError(w, http.StatusNotFound, "account not found")
		return
	}

	resp := buildAccountResponse(account, page, perPage, site)

	if page == 1 {
		cacheKey := cache.AccountKey(id, perPage)
		h.cache.SetDetail(r.Context(), cacheKey, resp)
	}

	writeJSON(w, http.StatusOK, resp)
}

// GetBySlug handles GET /api/v1/accounts/slug/{slug}
func (h *AccountHandler) GetBySlug(w http.ResponseWriter, r *http.Request) {
	site := middleware.SiteFromContext(r.Context())
	if site == nil {
		writeError(w, http.StatusInternalServerError, "site not resolved")
		return
	}

	slug := chi.URLParam(r, "slug")
	if slug == "" {
		writeError(w, http.StatusBadRequest, "slug is required")
		return
	}

	page := intParam(r, "page", 1)
	perPage := intParam(r, "per_page", 24)

	// Try cache (only first page).
	if page == 1 {
		cacheKey := cache.AccountSlugKey(slug, perPage)
		var cached accountResponse
		if h.cache.GetJSON(r.Context(), cacheKey, &cached) {
			writeJSON(w, http.StatusOK, cached)
			return
		}
	}

	account, err := h.accounts.GetBySlug(r.Context(), slug, site.ID, page, perPage)
	if err != nil {
		slog.Error("handler: get account by slug", "error", err, "slug", slug)
		writeError(w, http.StatusInternalServerError, "failed to get account")
		return
	}

	if account == nil {
		writeError(w, http.StatusNotFound, "account not found")
		return
	}

	resp := buildAccountResponse(account, page, perPage, site)

	if page == 1 {
		cacheKey := cache.AccountSlugKey(slug, perPage)
		h.cache.SetDetail(r.Context(), cacheKey, resp)
	}

	writeJSON(w, http.StatusOK, resp)
}
