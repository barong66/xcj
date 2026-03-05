package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port         string
	DatabaseURL  string
	RedisURL     string
	ClickHouseURL string

	CacheListTTL   time.Duration
	CacheDetailTTL time.Duration

	EventBufferSize  int
	EventFlushInterval time.Duration

	RateLimitRPS int
	CORSOrigins  []string

	AdminToken string

	ProjectDir string // root directory containing parser/ package

	SiteBaseURL string // public site URL for absolute redirects (e.g. https://temptguide.com)
}

func Load() *Config {
	return &Config{
		Port:         envOrDefault("PORT", "8080"),
		DatabaseURL:  envOrDefault("DATABASE_URL", "postgres://traforama:traforama@localhost:5432/traforama?sslmode=disable"),
		RedisURL:     envOrDefault("REDIS_URL", "redis://localhost:6379/0"),
		ClickHouseURL: envOrDefault("CLICKHOUSE_URL", "clickhouse://default:traforama@localhost:9000/traforama"),

		CacheListTTL:   durationOrDefault("CACHE_LIST_TTL", 60*time.Second),
		CacheDetailTTL: durationOrDefault("CACHE_DETAIL_TTL", 300*time.Second),

		EventBufferSize:    intOrDefault("EVENT_BUFFER_SIZE", 1000),
		EventFlushInterval: durationOrDefault("EVENT_FLUSH_INTERVAL", 1*time.Second),

		RateLimitRPS: intOrDefault("RATE_LIMIT_RPS", 100),
		CORSOrigins:  []string{"*"},

		AdminToken: envOrDefault("ADMIN_TOKEN", "xcj-admin-2024"),

		ProjectDir: envOrDefault("PROJECT_DIR", ".."),

		SiteBaseURL: envOrDefault("SITE_BASE_URL", ""),
	}
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func intOrDefault(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func durationOrDefault(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
