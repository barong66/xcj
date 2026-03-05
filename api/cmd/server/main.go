package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/xcj/videosite-api/internal/cache"
	"github.com/xcj/videosite-api/internal/clickhouse"
	"github.com/xcj/videosite-api/internal/config"
	"github.com/xcj/videosite-api/internal/cron"
	"github.com/xcj/videosite-api/internal/handler"
	"github.com/xcj/videosite-api/internal/ranking"
	"github.com/xcj/videosite-api/internal/store"
	"github.com/xcj/videosite-api/internal/worker"
)

func main() {
	// Set up structured logging.
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	cfg := config.Load()
	slog.Info("starting server", "port", cfg.Port)

	// Connect to PostgreSQL.
	pool, err := store.NewPool(cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	slog.Info("connected to PostgreSQL")

	// Connect to Redis.
	redisCache, err := cache.New(cfg.RedisURL, cfg.CacheListTTL, cfg.CacheDetailTTL)
	if err != nil {
		slog.Error("failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	defer redisCache.Close()
	slog.Info("connected to Redis")

	// Connect to ClickHouse and start event buffer.
	eventBuffer, err := clickhouse.NewEventBuffer(cfg.ClickHouseURL, cfg.EventBufferSize, cfg.EventFlushInterval)
	if err != nil {
		slog.Error("failed to connect to ClickHouse", "error", err)
		os.Exit(1)
	}
	defer eventBuffer.Close()
	slog.Info("connected to ClickHouse, event buffer started")

	// ClickHouse reader for analytics queries.
	chReader, err := clickhouse.NewReader(cfg.ClickHouseURL)
	if err != nil {
		slog.Error("failed to create ClickHouse reader", "error", err)
		os.Exit(1)
	}
	defer chReader.Close()
	slog.Info("ClickHouse reader ready")

	// Initialize stores.
	siteStore := store.NewSiteStore(pool)
	videoStore := store.NewVideoStore(pool)
	categoryStore := store.NewCategoryStore(pool)
	accountStore := store.NewAccountStore(pool)
	adminStore := store.NewAdminStore(pool)

	// Worker manager for the Python parser subprocess.
	workerMgr := worker.New(cfg.ProjectDir)

	// Ranking service for Bayesian CTR feed ordering.
	rankingService := ranking.NewService(redisCache.Client())

	// Cron scheduler for periodic tasks.
	scheduler := cron.NewScheduler()
	feedRefresher := cron.NewFeedScoreRefresher(chReader, rankingService)
	scheduler.Add(cron.Job{
		Name:     "feed-score-refresh",
		Interval: 1 * time.Hour,
		Fn:       feedRefresher.Run,
	})
	scheduler.Start()

	// Build router.
	router := handler.NewRouter(
		pool,
		siteStore,
		videoStore,
		categoryStore,
		accountStore,
		adminStore,
		redisCache,
		eventBuffer,
		chReader,
		cfg.RateLimitRPS,
		workerMgr,
		rankingService,
		cfg.SiteBaseURL,
	)

	// Create HTTP server.
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in a goroutine.
	go func() {
		slog.Info("server listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal for graceful shutdown.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	slog.Info("shutting down server", "signal", sig.String())

	// Give outstanding requests 15 seconds to complete.
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	scheduler.Stop()
	workerMgr.Stop()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("server forced to shutdown", "error", err)
		os.Exit(1)
	}

	slog.Info("server stopped gracefully")
}
