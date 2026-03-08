# xcj Project

Video aggregation platform for social media account promotion. Collects videos from Twitter/Instagram, categorizes via AI, serves through branded websites with analytics and banner monetization.

**Public brand:** TemptGuide (temptguide.com). Never use "traforama" in conversation.

## Architecture

```
Go API (port 8080)  ←→  PostgreSQL 16 + ClickHouse 26.2 + Redis 7
Next.js 14 (port 3000)  →  Go API (SSR proxy)
Python parser worker  →  PostgreSQL + Cloudflare R2
```

- **Multi-site:** site detection via `X-Forwarded-Host` header (`api/internal/middleware/site.go`)
- **Media storage:** Cloudflare R2 (bucket `xcj-media`, public URL `media.temptguide.com`)
- **Parser:** Instagram via Apify, Twitter via yt-dlp
- **AI categorization:** OpenAI GPT-4o Vision (32 categories)

## Directory Structure

| Directory | What | Details |
|-----------|------|---------|
| `api/` | Go API server | Chi router, pgx, see `api/CLAUDE.md` |
| `web/` | Next.js frontend | App Router SSR, Tailwind, see `web/CLAUDE.md` |
| `parser/` | Python worker | Scrapers + AI + banners, see `parser/CLAUDE.md` |
| `scripts/migrations/` | SQL migrations | PostgreSQL (001-015) + ClickHouse |
| `deploy/` | Docker, nginx, systemd | Production infra |
| `docs/tasks/` | Task documentation | Completed feature specs |

## Testing (mandatory before commit)

```bash
cd api && go test ./...                    # Go API
python3 -m pytest parser/tests/ -v         # Python parser
cd web && npm test                         # Next.js (when configured)
```

Tests live next to source: `*_test.go`, `parser/tests/`, `*.test.ts`

## Deploy

```bash
ssh traforama@37.27.189.122 "cd /opt/traforama/xcj && git pull origin main && docker compose -f deploy/docker/docker-compose.yml --env-file .env up -d --build"
```

## Database Migrations

**PostgreSQL:**
```bash
cat scripts/migrations/00X_*.sql | docker exec -i traforama-postgres psql -U xcj -d xcj
```

**ClickHouse:**
```bash
cat scripts/migrations/00X_*.sql | docker exec -i traforama-clickhouse clickhouse-client --multiquery
```

Applied: 001-011, 013-015. **NOT applied:** 012 (clickhouse_banner_metrics).

## ClickUp

Space: XXCJ (ID: 90126473643). After completing a task:
- Mark task as done + add comment describing changes and modified files
- Create new tasks for discovered bugs/TODOs

## Workflow: Project Manager Agent

Always run PM agent after completing any task. PM does TWO things:
1. **ClickUp** — find/create task, mark done, add comment, create follow-ups
2. **MD files** — update TECHNICAL_SPEC.md, DOCS.md, docs/tasks/*.md

Both steps are mandatory.

## Common Pitfalls

- Container names: `traforama-*` (not `xcj-*`)
- Docker Compose requires `--env-file .env` (doesn't auto-read from subdirectory)
- SSH user: `traforama` (not root), has sudo
- Never regenerate SSH keys on server — deploy key already on GitHub
- Parser auto-links new videos to all active sites via `link_video_to_sites`
- ClickHouse pinned to version 26.2 (matches existing data)
- Next.js SSR forwards browser Host as `X-Forwarded-Host` to Go API

## Local Development

```bash
docker compose -f docker-compose.dev.yml up -d   # Start DBs only
cd api && go run cmd/server/main.go               # API on :8080
cd web && npm run dev                              # Web on :3000
python -m parser worker                            # Parser worker
```

## API Response Format

```json
// Success
{"data": {...}, "status": "ok"}

// Error
{"error": "message", "status": "error", "code": "ERR_CODE"}
```

Admin auth: `Authorization: Bearer <ADMIN_TOKEN>`

## Reference Docs

- `TECHNICAL_SPEC.md` — full technical specification (DB schema, API endpoints, features)
- `DOCS.md` — product documentation
- `docs/tasks/*.md` — completed feature specifications
