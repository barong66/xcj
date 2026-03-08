# Go API

Chi router, pgx for PostgreSQL, Redis caching, ClickHouse analytics, Minio/S3 for R2.

## Structure

```
cmd/server/main.go          Entry point (init services → start HTTP)
internal/
  handler/                  HTTP handlers + router (15 files, ~4K LOC)
    router.go               All routes registered here
    admin.go                Admin CRUD (accounts, banners, videos, stats, queue)
    banner.go               Banner serving (/b/serve), CTR selection, clicks
    banner_templates.go     HTML/CSS templates (bold, elegant, minimalist, card)
    video.go                Video feed, search, filtering, sorting
    account.go              Account list, detail, profiles
    category.go             Category tree
    event.go                Event tracking (POST /api/v1/events)
    health.go               System health checks
    ua.go                   User-Agent parsing
    response.go             JSON response helpers
  store/                    PostgreSQL data access (6 files)
    db.go                   Connection pool, health check
    video_store.go          Video queries (with ai_categories, social_links)
    account_store.go        Account CRUD, pagination, profiles
    admin_store.go          Admin ops, queue, postbacks
    site_store.go           Multi-site routing
    category_store.go       Category tree
  model/                    Data structures (Video, Account, Category, Event, Site)
  middleware/               Logging, rate limiting, site detection
  clickhouse/               Analytics: EventBuffer (async batch writes) + Reader (queries)
  cache/                    Redis wrapper (list TTL 60s, detail TTL 300s)
  s3/                       Cloudflare R2 client (upload, recrop, delete)
  config/                   Environment variable parsing
  ranking/                  Bayesian CTR ranking for feed
  cron/                     Feed refresh (1h), postback retry (5m)
  worker/                   Python parser subprocess management
```

## Patterns

**Store pattern:** type wrapping `*pgxpool.Pool` with CRUD methods.
```go
type VideoStore struct{ pool *pgxpool.Pool }
func (s *VideoStore) GetByID(ctx context.Context, id int64) (*model.Video, error)
```

**Handler pattern:** standard `http.HandlerFunc`, uses Chi URL params.
```go
func (h *Handler) GetVideo(w http.ResponseWriter, r *http.Request)
```

**Error handling:** `log.Error()` + `writeError(w, statusCode, "message")`

**Config:** `config.Load()` from env vars, pass `cfg` to constructors.

## Key Routes

Public: `/api/v1/{videos,accounts,categories,countries,events}`, `/b/serve`
Admin: `/api/v1/admin/{accounts,videos,banners,banner-sizes,categories,sites,queue,ad-sources,stats}`
Health: `/health`, `/api/v1/admin/health`

## Testing

```bash
go test ./...
```

Tests in `handler/*_test.go` and `s3/client_test.go`.
