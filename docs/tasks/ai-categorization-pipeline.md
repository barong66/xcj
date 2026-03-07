# AI Categorization Pipeline (OpenAI GPT-4o Vision)

> ClickUp: https://app.clickup.com/t/869c8u1y3 (verification task)
> ClickUp: https://app.clickup.com/t/869c7w8qu (original implementation)
> ClickUp: https://app.clickup.com/t/869ccdcjn (credits — resolved, switched to OpenAI)
> ClickUp: https://app.clickup.com/t/869ccek1u (monitor OpenAI usage)
> Module: `parser/categorizer/`
> Status: DEPLOYED, OPERATIONAL

---

## Overview

AI-категоризация видео через OpenAI GPT-4o Vision. Анализирует thumbnail каждого видео и назначает 1-5 категорий из предопределённого списка (67 штук) с confidence score.

**History:** Originally built with Anthropic Claude Sonnet Vision. Switched to OpenAI GPT-4o on 2026-03-05 due to Anthropic API credit activation delays (Stripe processing). Anthropic credits eventually activated, but the decision was made to keep OpenAI going forward.

## Architecture

```
parser/categorizer/
├── categories.py     # 67 категорий (slug + name), hardcoded
├── vision.py         # Основная логика: prompt, OpenAI GPT-4o API call, response parsing
├── pipeline.py       # PipelineConfig (openai_api_key)
└── worker.py         # categorizer_worker_loop — фоновый цикл
```

**Pipeline flow:**
```
categorizer_worker_loop (runs in asyncio.gather with parse_worker + banner_worker)
→ SELECT videos WHERE ai_processed_at IS NULL AND is_active = true
→ Batch by CATEGORIZER_BATCH_SIZE (default: 50)
→ For each video:
  → Download thumbnail from S3/CDN
  → Send to OpenAI GPT-4o Vision (base64 image + metadata)
  → Prompt includes list of 67 allowed categories
  → GPT-4o returns 1-5 categories with confidence (0.0-1.0)
  → INSERT INTO categories ON CONFLICT DO NOTHING (auto-create)
  → INSERT INTO video_categories (video_id, category_id, confidence)
  → UPDATE videos SET ai_processed_at = NOW(), ai_categories = <JSONB cache>
```

## Database Tables

### `categories` (master list)
| Field | Type | Description |
|-------|------|-------------|
| id | BIGSERIAL PK | |
| slug | TEXT UNIQUE | URL-friendly name |
| name | TEXT | Display name |
| parent_id | BIGINT FK(self) | Hierarchy (unused by AI) |
| is_active | BOOLEAN | Visibility |
| sort_order | INTEGER | Display order |

### `video_categories` (junction)
| Field | Type | Description |
|-------|------|-------------|
| video_id | BIGINT FK | |
| category_id | BIGINT FK | |
| confidence | FLOAT | AI confidence 0.0-1.0 |

PK: (video_id, category_id)

### `site_categories` (per-site visibility)
| Field | Type | Description |
|-------|------|-------------|
| site_id | BIGINT FK | |
| category_id | BIGINT FK | |
| sort_order | INTEGER | Order on site |

PK: (site_id, category_id)

**Current state (2026-03-05):** First full run completed. 370 videos categorized, 41 categories created, 1649 video_categories links.

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| OPENAI_API_KEY | (empty) | Required. OpenAI API key |
| CATEGORIZER_BATCH_SIZE | 50 | Videos per batch |
| CATEGORIZER_CONCURRENCY | 5 | Parallel API requests |

## History

### Switch to OpenAI GPT-4o (2026-03-05)
- Anthropic credits were not activating (delayed Stripe processing), so switched to OpenAI GPT-4o which was already set up
- Turns out Anthropic credits DID activate eventually -- all 370 videos were actually categorized by Claude before the switch
- Decision: keep OpenAI going forward
- **Results:** 41 categories created, 1649 video_categories links

**Files changed:**
- `parser/categorizer/vision.py` -- rewritten to use OpenAI AsyncOpenAI client + GPT-4o model
- `parser/categorizer/pipeline.py` -- anthropic_api_key -> openai_api_key in PipelineConfig
- `parser/__main__.py` -- ANTHROPIC_API_KEY -> OPENAI_API_KEY env var check
- `parser/pyproject.toml` -- replaced anthropic dependency with openai
- `deploy/docker/docker-compose.yml` -- added OPENAI_API_KEY env var to parser-worker

### What was discovered (earlier on 2026-03-05)
The categorizer was **fully coded** (task 869c7w8qu marked done) but **never actually ran** because:

1. **ANTHROPIC_API_KEY was empty in .env** on the server -- categorizer silently skips when key is missing
2. **Categorizer was NOT in the worker loop** -- `parser/__main__.py` only had `parse_worker_loop` and `banner_worker_loop` in `asyncio.gather`. The `categorizer_worker_loop` was never added.

### What was fixed
- **Commit ef00ee4**: Added `categorizer_worker_loop` to `asyncio.gather` in `parser/__main__.py`
- Now the worker starts 3 coroutines: parse_worker, banner_worker, categorizer
- When OPENAI_API_KEY is missing, categorizer logs a warning and gracefully skips (no crash)

## Operations

### Check status
```sql
SELECT count(*) FROM video_categories;
SELECT count(*) FROM categories;
SELECT count(*) FROM videos WHERE ai_processed_at IS NULL AND is_active = true;
```

### Manual run
```bash
python -m parser categorize
```

### Recategorize all videos
```bash
curl -X POST http://localhost:8080/api/v1/admin/videos/recategorize \
  -H "Authorization: Bearer xcj-admin-2024"
```

## Related Tasks
- **Categories CRUD** (`docs/tasks/categories-crud.md`) — admin UI for managing categories (TODO)
- **Admin Videos: manual category editing** (869c8uvn4) — edit categories per video (TODO)
