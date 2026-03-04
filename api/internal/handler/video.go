package handler

import (
	"log/slog"
	"math"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/xcj/videosite-api/internal/cache"
	"github.com/xcj/videosite-api/internal/middleware"
	"github.com/xcj/videosite-api/internal/model"
	"github.com/xcj/videosite-api/internal/ranking"
	"github.com/xcj/videosite-api/internal/store"
)

type VideoHandler struct {
	videos     *store.VideoStore
	accounts   *store.AccountStore
	categories *store.CategoryStore
	cache      *cache.Cache
	ranker     *ranking.Service
}

func NewVideoHandler(videos *store.VideoStore, accounts *store.AccountStore, categories *store.CategoryStore, cache *cache.Cache, ranker *ranking.Service) *VideoHandler {
	return &VideoHandler{videos: videos, accounts: accounts, categories: categories, cache: cache, ranker: ranker}
}

// List handles GET /api/v1/videos
func (h *VideoHandler) List(w http.ResponseWriter, r *http.Request) {
	site := middleware.SiteFromContext(r.Context())
	if site == nil {
		writeError(w, http.StatusInternalServerError, "site not resolved")
		return
	}

	params := model.VideoListParams{
		SiteID:     site.ID,
		Sort:       r.URL.Query().Get("sort"),
		Page:       intParam(r, "page", 1),
		PerPage:    intParam(r, "per_page", 24),
		AnchorSlug: r.URL.Query().Get("anchor"),
		Source:     r.URL.Query().Get("src"),
	}

	if params.Sort == "" {
		params.Sort = "recent"
	}

	if catStr := r.URL.Query().Get("category_id"); catStr != "" {
		if catID, err := strconv.ParseInt(catStr, 10, 64); err == nil {
			params.CategoryID = &catID
		}
	}

	// Support filtering by category slug (resolves to ID).
	if catSlug := r.URL.Query().Get("category"); catSlug != "" && params.CategoryID == nil {
		cat, err := h.categories.GetBySlug(r.Context(), site.ID, catSlug)
		if err == nil && cat != nil {
			params.CategoryID = &cat.ID
		}
	}

	if exclStr := r.URL.Query().Get("exclude_account_id"); exclStr != "" {
		if exclID, err := strconv.ParseInt(exclStr, 10, 64); err == nil {
			params.ExcludeAccountID = &exclID
		}
	}

	if countryStr := r.URL.Query().Get("country_id"); countryStr != "" {
		if countryID, err := strconv.ParseInt(countryStr, 10, 64); err == nil {
			params.CountryID = &countryID
		}
	}

	// Anchor feed: ?anchor=slug on page 1
	if params.AnchorSlug != "" && params.Page == 1 && h.ranker != nil {
		if result := h.serveAnchorFeed(r, site.ID, params); result != nil {
			writeJSON(w, http.StatusOK, result)
			return
		}
		// Fallback to normal feed if anchor resolution fails
	}

	// Ranked feed for default "recent" sort when ranker is available and no filters
	if params.Sort == "recent" && h.ranker != nil && params.CategoryID == nil && params.CountryID == nil && params.ExcludeAccountID == nil {
		if result := h.serveRankedFeed(r, site.ID, params); result != nil {
			writeJSON(w, http.StatusOK, result)
			return
		}
		// Fallback to legacy sort
	}

	// Legacy flow: cache + DB query with ORDER BY
	var catID, cntID int64
	if params.CategoryID != nil {
		catID = *params.CategoryID
	}
	if params.CountryID != nil {
		cntID = *params.CountryID
	}

	useCache := params.Sort != "random" && params.ExcludeAccountID == nil
	if useCache {
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

	if useCache {
		cacheKey := cache.VideoListKey(site.ID, params.Sort, catID, cntID, params.Page)
		h.cache.SetList(r.Context(), cacheKey, result)
	}

	writeJSON(w, http.StatusOK, result)
}

// serveRankedFeed returns a Bayesian CTR-ranked feed with Pool A/B mixing.
func (h *VideoHandler) serveRankedFeed(r *http.Request, siteID int64, params model.VideoListParams) *model.VideoListResult {
	ctx := r.Context()

	// Try cache first.
	cacheKey := cache.RankedFeedKey(siteID, params.Page)
	var cached model.VideoListResult
	if h.cache.GetJSON(ctx, cacheKey, &cached) {
		return &cached
	}

	// Get candidate video IDs (up to 200).
	candidateIDs, err := h.videos.ListIDs(ctx, siteID, 200)
	if err != nil {
		slog.Error("handler: ranked feed list ids", "error", err)
		return nil
	}
	if len(candidateIDs) == 0 {
		return nil
	}

	// Classify into Pool A (proven) and Pool B (exploration).
	poolA, poolB := h.ranker.ClassifyAndSort(ctx, candidateIDs)

	// Mix the pools.
	mixed := ranking.MixFeed(poolA, poolB, len(candidateIDs))

	// Paginate.
	total := int64(len(mixed))
	start := (params.Page - 1) * params.PerPage
	if start >= len(mixed) {
		return nil
	}
	end := start + params.PerPage
	if end > len(mixed) {
		end = len(mixed)
	}
	pageIDs := mixed[start:end]

	// Fetch full video objects.
	videos, err := h.videos.GetByIDs(ctx, pageIDs)
	if err != nil {
		slog.Error("handler: ranked feed get by ids", "error", err)
		return nil
	}

	totalPages := int(math.Ceil(float64(total) / float64(params.PerPage)))
	result := &model.VideoListResult{
		Videos:     videos,
		Total:      total,
		Page:       params.Page,
		PerPage:    params.PerPage,
		TotalPages: totalPages,
	}

	h.cache.SetList(ctx, cacheKey, result)
	return result
}

// serveAnchorFeed builds a custom feed with the anchor model's latest video first,
// followed by similar videos, then the regular mixed feed.
func (h *VideoHandler) serveAnchorFeed(r *http.Request, siteID int64, params model.VideoListParams) *model.VideoListResult {
	ctx := r.Context()

	// Try cache.
	cacheKey := cache.AnchorFeedKey(siteID, params.AnchorSlug, params.Page)
	var cached model.VideoListResult
	if h.cache.GetJSON(ctx, cacheKey, &cached) {
		return &cached
	}

	// Resolve anchor account.
	account, err := h.accounts.GetBySlug(ctx, params.AnchorSlug, siteID, 1, 1)
	if err != nil || account == nil {
		slog.Warn("handler: anchor account not found", "slug", params.AnchorSlug)
		return nil
	}

	// Position 1: latest video from anchor model.
	anchorVideoID, err := h.videos.GetLatestVideoIDByAccount(ctx, account.ID, siteID)
	if err != nil || anchorVideoID == 0 {
		return nil
	}

	// Positions 2-6: similar videos (by category).
	catIDs, _ := h.videos.GetAccountCategoryIDs(ctx, account.ID, siteID)
	var similarIDs []int64
	if len(catIDs) > 0 {
		similarIDs, _ = h.videos.ListIDsByCategories(ctx, siteID, catIDs, anchorVideoID, 20)
	}

	// Rank the similar IDs if we have scores.
	if len(similarIDs) > 0 {
		poolA, poolB := h.ranker.ClassifyAndSort(ctx, similarIDs)
		similarIDs = ranking.MixFeed(poolA, poolB, 5)
	}

	// Positions 7+: regular mixed feed (excluding anchor + similar).
	excludeSet := make(map[int64]bool)
	excludeSet[anchorVideoID] = true
	for _, id := range similarIDs {
		excludeSet[id] = true
	}

	allIDs, _ := h.videos.ListIDs(ctx, siteID, 200)
	var restCandidates []int64
	for _, id := range allIDs {
		if !excludeSet[id] {
			restCandidates = append(restCandidates, id)
		}
	}

	var restIDs []int64
	if len(restCandidates) > 0 {
		poolA, poolB := h.ranker.ClassifyAndSort(ctx, restCandidates)
		restIDs = ranking.MixFeed(poolA, poolB, len(restCandidates))
	}

	// Assemble final ordered list: anchor → similar → rest.
	finalIDs := make([]int64, 0, 1+len(similarIDs)+len(restIDs))
	finalIDs = append(finalIDs, anchorVideoID)
	finalIDs = append(finalIDs, similarIDs...)
	finalIDs = append(finalIDs, restIDs...)

	// Paginate.
	total := int64(len(finalIDs))
	start := (params.Page - 1) * params.PerPage
	if start >= len(finalIDs) {
		return nil
	}
	end := start + params.PerPage
	if end > len(finalIDs) {
		end = len(finalIDs)
	}
	pageIDs := finalIDs[start:end]

	// Fetch full objects.
	videos, err := h.videos.GetByIDs(ctx, pageIDs)
	if err != nil {
		slog.Error("handler: anchor feed get by ids", "error", err)
		return nil
	}

	totalPages := int(math.Ceil(float64(total) / float64(params.PerPage)))
	result := &model.VideoListResult{
		Videos:     videos,
		Total:      total,
		Page:       params.Page,
		PerPage:    params.PerPage,
		TotalPages: totalPages,
	}

	h.cache.SetList(ctx, cacheKey, result)
	return result
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
