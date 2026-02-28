package handler

import (
	"log/slog"
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

	// Try cache (only first page without pagination params).
	if page == 1 {
		cacheKey := cache.AccountKey(id)
		var cached model.Account
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

	if page == 1 {
		cacheKey := cache.AccountKey(id)
		h.cache.SetDetail(r.Context(), cacheKey, account)
	}

	writeJSON(w, http.StatusOK, account)
}
