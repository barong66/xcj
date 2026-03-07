# Banner Keyword Matching Fix + CTR-Based Selection

> Status: DONE
> Module: api/internal/handler/banner.go, api/internal/handler/router.go, api/internal/store/admin_store.go
> Completed: 2026-03-06
> ClickUp: https://app.clickup.com/t/869ccwjcj

---

## Problem

### 1. Broken keyword matching
The `kw` parameter in `/b/serve` was searching via ILIKE in `video.title` and `video.description`. However, these fields are often empty after parsing (especially for Instagram), making keyword matching effectively broken -- no banners were ever returned for keyword queries.

### 2. Random banner selection
Banner selection from the pool was purely random (`rand.Intn(len(pool))`), ignoring real performance data. A banner with 5% CTR had the same chance of being shown as a banner with 0.1% CTR.

## Solution

### 1. kw = category slug
The `kw` parameter is now treated as a **category slug** (same as `cat`). It uses the existing `ListServableBanners` with JOIN on `video_categories` table.

This works because:
- AI categorizer (GPT-4o Vision) properly assigns categories to all videos
- Categories have meaningful slugs (e.g., `blonde`, `brunette`, `amateur`)
- The `video_categories` table has reliable data (1649+ associations)

**Before:** `kw=blonde` -> ILIKE '%blonde%' on empty title/description -> 0 results
**After:** `kw=blonde` -> JOIN video_categories WHERE category.slug = 'blonde' -> proper results

### 2. CTR-based selection (selectBestBanner)
Instead of random selection, added `selectBestBanner` method:

1. Queries ClickHouse via existing `GetBannerStats` for banner CTR per video_id
2. Finds the banner with the highest CTR in the pool
3. If all CTRs are equal (or zero), falls back to random selection

This means the system automatically optimizes which banners are shown based on real click-through performance data, without any manual intervention.

## Files Changed

| File | Change |
|------|--------|
| `api/internal/handler/banner.go` | Added `chReader *clickhouse.Reader` to BannerHandler struct/constructor; simplified `getBannerPool` to treat kw as category slug; added `selectBestBanner` method |
| `api/internal/handler/router.go` | Pass `chReader` to `NewBannerHandler` constructor |
| `api/internal/store/admin_store.go` | Removed unused `ListServableBannersByKeyword` method |

## Redis Cache Keys

No change to cache key structure. The `kw` parameter now uses the same cache keys as `cat`:
- `bp:{w}x{h}:{cat}` -- pool by size + category (used for both `cat` and `kw` params)

The previous behavior of skipping cache for keyword queries is removed since kw is now equivalent to cat.

## Follow-up

- **Smart multi-keyword matching** -- support comma-separated category slugs in `kw` parameter with weighted scoring
  - ClickUp: https://app.clickup.com/t/869ccwjcr
