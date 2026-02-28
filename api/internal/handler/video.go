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

type VideoHandler struct {
	videos *store.VideoStore
	cache  *cache.Cache
}

func NewVideoHandler(videos *store.VideoStore, cache *cache.Cache) *VideoHandler {
	return &VideoHandler{videos: videos, cache: cache}
}

// List handles GET /api/v1/videos
func (h *VideoHandler) List(w http.ResponseWriter, r *http.Request) {
	site := middleware.SiteFromContext(r.Context())
	if site == nil {
		writeError(w, http.StatusInternalServerError, "site not resolved")
		return
	}

	params := model.VideoListParams{
		SiteID:  site.ID,
		Sort:    r.URL.Query().Get("sort"),
		Page:    intParam(r, "page", 1),
		PerPage: intParam(r, "per_page", 24),
	}

	if params.Sort == "" {
		params.Sort = "recent"
	}

	if catStr := r.URL.Query().Get("category_id"); catStr != "" {
		if catID, err := strconv.ParseInt(catStr, 10, 64); err == nil {
			params.CategoryID = &catID
		}
	}

	if countryStr := r.URL.Query().Get("country_id"); countryStr != "" {
		if countryID, err := strconv.ParseInt(countryStr, 10, 64); err == nil {
			params.CountryID = &countryID
		}
	}

	// Try cache first (skip for random sort since results differ each time).
	var catID, cntID int64
	if params.CategoryID != nil {
		catID = *params.CategoryID
	}
	if params.CountryID != nil {
		cntID = *params.CountryID
	}

	if params.Sort != "random" {
		cacheKey := cache.VideoListKey(site.ID, params.Sort, catID, cntID, params.Page)
		var result model.VideoListResult
		if h.cache.GetJSON(r.Context(), cacheKey, &result) {
			writeJSON(w, http.StatusOK, result)
			return
		}
	}

	result, err := h.videos.List(r.Context(), params)
	if err != nil {
		slog.Error("handler: list videos", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list videos")
		return
	}

	// Cache the result (skip random).
	if params.Sort != "random" {
		cacheKey := cache.VideoListKey(site.ID, params.Sort, catID, cntID, params.Page)
		h.cache.SetList(r.Context(), cacheKey, result)
	}

	writeJSON(w, http.StatusOK, result)
}

// Get handles GET /api/v1/videos/{id}
func (h *VideoHandler) Get(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid video id")
		return
	}

	// Try cache.
	cacheKey := cache.VideoDetailKey(id)
	var video model.Video
	if h.cache.GetJSON(r.Context(), cacheKey, &video) {
		writeJSON(w, http.StatusOK, video)
		return
	}

	result, err := h.videos.GetByID(r.Context(), id)
	if err != nil {
		slog.Error("handler: get video", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to get video")
		return
	}

	if result == nil {
		writeError(w, http.StatusNotFound, "video not found")
		return
	}

	h.cache.SetDetail(r.Context(), cacheKey, result)
	writeJSON(w, http.StatusOK, result)
}

// Search handles GET /api/v1/search
func (h *VideoHandler) Search(w http.ResponseWriter, r *http.Request) {
	site := middleware.SiteFromContext(r.Context())
	if site == nil {
		writeError(w, http.StatusInternalServerError, "site not resolved")
		return
	}

	query := r.URL.Query().Get("q")
	if query == "" {
		writeError(w, http.StatusBadRequest, "search query is required")
		return
	}

	page := intParam(r, "page", 1)
	perPage := intParam(r, "per_page", 24)

	// Try cache.
	cacheKey := cache.SearchKey(site.ID, query, page)
	var cached model.VideoListResult
	if h.cache.GetJSON(r.Context(), cacheKey, &cached) {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	result, err := h.videos.Search(r.Context(), site.ID, query, page, perPage)
	if err != nil {
		slog.Error("handler: search videos", "error", err, "query", query)
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}

	h.cache.SetList(r.Context(), cacheKey, result)
	writeJSON(w, http.StatusOK, result)
}

func intParam(r *http.Request, key string, fallback int) int {
	val := r.URL.Query().Get(key)
	if val == "" {
		return fallback
	}
	n, err := strconv.Atoi(val)
	if err != nil || n < 1 {
		return fallback
	}
	return n
}
