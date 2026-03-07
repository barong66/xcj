# Banner Embed Script (loader.js) for Contextual Targeting

> Status: **Done** (2026-03-07)
> ClickUp: https://app.clickup.com/t/869ccwp5q
> Follow-up: https://app.clickup.com/t/869ccwp81

---

## Problem

Publishers embedding banners via iframe need to manually specify targeting parameters (category, keywords). This limits adoption and targeting quality because:
- Publishers don't know our category slugs
- Manual iframe configuration is error-prone
- No contextual targeting — banners shown without considering page content

## Solution

A lightweight JavaScript embed script (`/b/loader.js`, ~1.5KB) that automatically extracts contextual keywords from the publisher's page and creates a targeted banner iframe.

## What was implemented

### New endpoint: `GET /b/loader.js`

Serves a JS embed script that:

1. **Reads page context:**
   - `<title>` tag
   - `<meta name="description">` content
   - `<meta name="keywords">` content
   - `<meta property="og:title">` and `<meta property="og:description">`
   - First `<h1>` element
   - URL pathname segments

2. **Extracts keywords:**
   - Tokenizes all text into words
   - Filters out ~80 common English stop words (a, the, is, and, for, etc.)
   - Performs frequency analysis
   - Returns top-5 most frequent keywords

3. **Creates targeted iframe:**
   - Points to existing `/b/serve?kw=keyword1,keyword2,...`
   - Passes through `src` and `click_id` from data attributes

4. **Lazy loading:**
   - Uses IntersectionObserver with 200px rootMargin
   - Banner iframe is only created when placeholder approaches the viewport
   - Reduces page load impact for below-fold banners

### Publisher integration

```html
<!-- Basic usage -->
<script async src="https://api.temptguide.com/b/loader.js" data-size="300x250"></script>

<!-- With traffic source tracking -->
<script async src="https://api.temptguide.com/b/loader.js"
  data-size="300x250"
  data-src="adnet1"
  data-click-id="{CLICK_ID}"></script>
```

### Script tag attributes

| Attribute | Required | Default | Description |
|-----------|----------|---------|-------------|
| `data-size` | No | `300x250` | Banner size `WxH` |
| `data-style` | No | random | Banner template style: `bold`, `elegant`, `minimalist`, `card` |
| `data-src` | No | — | Traffic source slug (ad network name) |
| `data-click-id` | No | — | Click ID from ad network for S2S postbacks |

### Caching & CORS

- `Cache-Control: public, max-age=86400` (24-hour cache)
- `Access-Control-Allow-Origin: *` (any domain)
- Content-Type: `application/javascript`

## Files changed

| File | Change |
|------|--------|
| `api/internal/handler/banner.go` | Added `ServeLoader` handler + `loaderJS` Go template constant |
| `api/internal/handler/router.go` | Added `r.Get("/b/loader.js", ...)` route |
| `web/public/banner-test.html` | Added loader.js test slot in sidebar |

## Database changes

None. The loader.js uses the existing `/b/serve` endpoint and `kw` parameter.

## Flow diagram

```
Publisher page loads → <script src="/b/loader.js">
  → Script executes on publisher page
  → Reads: title, meta tags, og tags, h1, URL path
  → Tokenizes all text → filters stop words → frequency analysis
  → Extracts top-5 keywords (e.g., "blonde", "model", "instagram")
  → Creates placeholder div
  → IntersectionObserver watches placeholder (rootMargin: 200px)
  → When near viewport: creates <iframe src="/b/serve?size=300x250&kw=blonde,model,instagram&src=adnet1">
  → Standard /b/serve flow: banner pool lookup, CTR-based selection, impression tracking
```

## Known limitations

1. **Keyword matching is rigid** — `kw` parameter is currently treated as a category slug (exact match against `categories.slug`). Keywords extracted from publisher pages rarely match exactly.
2. **English stop words only** — stop word list is English-only, no multilingual support
3. **No keyword caching** — keywords are extracted on every page load (mitigated by script being cached 24h)
4. **Single page context** — doesn't consider user behavior or cross-page context

## Future improvements

Follow-up task: [Improve banner keyword-to-category matching algorithm](https://app.clickup.com/t/869ccwp81)

- **Multi-keyword support** — accept comma-separated keywords, try matching each against categories
- **Fuzzy/partial matching** — match "blonde-hair" to "blonde" category
- **Synonym mapping** — configurable synonym table (e.g., fitness -> gym)
- **Tag-based matching** — add tags/keywords to categories for broader matching
- **Weighted scoring** — when multiple categories match, weight by confidence + relevance
- **Fallback** — if no keyword matches, fall back to random banner from pool
