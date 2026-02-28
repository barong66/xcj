package handler

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/xcj/videosite-api/internal/cache"
	"github.com/xcj/videosite-api/internal/middleware"
	"github.com/xcj/videosite-api/internal/model"
	"github.com/xcj/videosite-api/internal/store"
)

type CategoryHandler struct {
	categories *store.CategoryStore
	cache      *cache.Cache
}

func NewCategoryHandler(categories *store.CategoryStore, cache *cache.Cache) *CategoryHandler {
	return &CategoryHandler{categories: categories, cache: cache}
}

// List handles GET /api/v1/categories
func (h *CategoryHandler) List(w http.ResponseWriter, r *http.Request) {
	site := middleware.SiteFromContext(r.Context())
	if site == nil {
		writeError(w, http.StatusInternalServerError, "site not resolved")
		return
	}

	// Try cache.
	cacheKey := cache.CategoriesKey(site.ID)
	var cached []model.Category
	if h.cache.GetJSON(r.Context(), cacheKey, &cached) {
		writeJSON(w, http.StatusOK, map[string]interface{}{"categories": cached})
		return
	}

	categories, err := h.categories.ListForSite(r.Context(), site.ID)
	if err != nil {
		slog.Error("handler: list categories", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list categories")
		return
	}

	if categories == nil {
		categories = []model.Category{}
	}

	h.cache.SetList(r.Context(), cacheKey, categories)
	writeJSON(w, http.StatusOK, map[string]interface{}{"categories": categories})
}

// GetBySlug handles GET /api/v1/categories/{slug}
func (h *CategoryHandler) GetBySlug(w http.ResponseWriter, r *http.Request) {
	site := middleware.SiteFromContext(r.Context())
	if site == nil {
		writeError(w, http.StatusInternalServerError, "site not resolved")
		return
	}

	slug := chi.URLParam(r, "slug")
	if slug == "" {
		writeError(w, http.StatusBadRequest, "category slug is required")
		return
	}

	// Try cache.
	cacheKey := cache.CategoryDetailKey(site.ID, slug)
	var cached model.Category
	if h.cache.GetJSON(r.Context(), cacheKey, &cached) {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	category, err := h.categories.GetBySlug(r.Context(), site.ID, slug)
	if err != nil {
		slog.Error("handler: get category", "error", err, "slug", slug)
		writeError(w, http.StatusInternalServerError, "failed to get category")
		return
	}

	if category == nil {
		writeError(w, http.StatusNotFound, "category not found")
		return
	}

	h.cache.SetDetail(r.Context(), cacheKey, category)
	writeJSON(w, http.StatusOK, category)
}
