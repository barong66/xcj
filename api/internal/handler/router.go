package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xcj/videosite-api/internal/cache"
	"github.com/xcj/videosite-api/internal/clickhouse"
	"github.com/xcj/videosite-api/internal/middleware"
	"github.com/xcj/videosite-api/internal/ranking"
	"github.com/xcj/videosite-api/internal/store"
	"github.com/xcj/videosite-api/internal/worker"
)

// NewRouter creates the chi router with all middleware and routes wired up.
func NewRouter(
	pool *pgxpool.Pool,
	siteStore *store.SiteStore,
	videoStore *store.VideoStore,
	categoryStore *store.CategoryStore,
	accountStore *store.AccountStore,
	adminStore *store.AdminStore,
	c *cache.Cache,
	eventBuffer *clickhouse.EventBuffer,
	chReader *clickhouse.Reader,
	rateLimitRPS int,
	workerMgr *worker.Manager,
	ranker *ranking.Service,
) http.Handler {
	r := chi.NewRouter()

	// Global middleware.
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(middleware.Logging)
	r.Use(chimw.Recoverer)

	// CORS.
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Content-Type", "X-Site-Id", "X-Forwarded-Host", "Authorization"},
		ExposedHeaders:   []string{"X-Request-Id"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// Rate limiting.
	rl := middleware.NewRateLimiter(rateLimitRPS)
	r.Use(rl.Middleware)

	// Health check (no site detection needed).
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// Admin routes — no site detection, protected by bearer token.
	r.Route("/api/v1/admin", func(r chi.Router) {
		r.Use(AdminAuth)

		adminHandler := NewAdminHandler(adminStore, chReader, workerMgr, c)
		healthHandler := NewHealthHandler(pool, c, eventBuffer, chReader, workerMgr)

		// Health.
		r.Get("/health", healthHandler.GetHealth)

		// Stats.
		r.Get("/stats", adminHandler.GetStats)

		// Accounts.
		r.Get("/accounts", adminHandler.ListAccounts)
		r.Post("/accounts", adminHandler.CreateAccount)
		r.Post("/accounts/reparse-all", adminHandler.ReparseAllAccounts)
		r.Get("/accounts/{id}", adminHandler.GetAccount)
		r.Put("/accounts/{id}", adminHandler.UpdateAccount)
		r.Delete("/accounts/{id}", adminHandler.DeleteAccount)
		r.Post("/accounts/{id}/reparse", adminHandler.ReparseAccount)

		// Queue.
		r.Get("/queue", adminHandler.ListQueue)
		r.Get("/queue/summary", adminHandler.GetQueueSummary)
		r.Post("/queue/retry-failed", adminHandler.RetryFailedJobs)
		r.Delete("/queue/failed", adminHandler.ClearFailedJobs)
		r.Delete("/queue/{id}", adminHandler.CancelQueueItem)

		// Videos.
		r.Get("/videos", adminHandler.ListVideos)
		r.Get("/videos/stats", adminHandler.GetVideoStats)
		r.Delete("/videos/{id}", adminHandler.DeleteVideo)
		r.Post("/videos/recategorize", adminHandler.RecategorizeVideos)

		// Categories.
		r.Get("/categories", adminHandler.ListCategories)

		// Sites.
		r.Get("/sites", adminHandler.ListSites)
		r.Get("/sites/{id}", adminHandler.GetSite)
		r.Put("/sites/{id}", adminHandler.UpdateSite)
		r.Post("/sites/{id}/refresh", adminHandler.RefreshSiteContent)
	})

	// API v1 routes — all require site detection.
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(middleware.SiteDetection(siteStore))

		videoHandler := NewVideoHandler(videoStore, accountStore, c, ranker)
		categoryHandler := NewCategoryHandler(categoryStore, c)
		accountHandler := NewAccountHandler(accountStore, c)
		eventHandler := NewEventHandler(eventBuffer)

		// Videos.
		r.Get("/videos", videoHandler.List)
		r.Get("/videos/{id}", videoHandler.Get)

		// Search.
		r.Get("/search", videoHandler.Search)

		// Categories.
		r.Get("/categories", categoryHandler.List)
		r.Get("/categories/{slug}", categoryHandler.GetBySlug)

		// Accounts.
		r.Get("/accounts/{id}", accountHandler.Get)
		r.Get("/accounts/slug/{slug}", accountHandler.GetBySlug)

		// Events.
		r.Post("/events", eventHandler.Create)
		r.Post("/events/batch", eventHandler.CreateBatch)
	})

	return r
}
