# HTML Banners with Hover Effects

> Status: **Done** (2026-03-07)
> ClickUp: *(pending — no API access at time of writing, needs manual update)*

---

## Problem

The `/b/serve` endpoint rendered banners as static `<a><img></a>` HTML — a plain linked image with no interactivity. This resulted in:
- Low engagement: static banners blend into page content and are easily ignored (banner blindness)
- No visual feedback on hover — user doesn't know the banner is clickable
- No branding or CTA — just a raw cropped thumbnail
- All banners look identical regardless of context

## Solution

Replaced static JPEG banner output in `/b/serve` with interactive HTML+CSS templates featuring hover effects (scale, glow, opacity transitions), CTA buttons, @username overlay, and multiple visual styles.

## What was implemented

### 1. Extended `ServableBanner` struct

Added two new fields to the `ServableBanner` struct used for dynamic banner serving:

```go
type ServableBanner struct {
    ID           int64  `json:"id"`
    AccountID    int64  `json:"aid"`
    VideoID      int64  `json:"vid"`
    ImageURL     string `json:"url"`
    ThumbnailURL string `json:"thumb"`  // NEW: raw thumbnail (thumbnail_lg_url)
    Username     string `json:"user"`   // NEW: account username for overlay
    Width        int    `json:"w"`
    Height       int    `json:"h"`
}
```

The `ListServableBanners` SQL query was updated to JOIN with `videos` and `accounts` tables to fetch `thumbnail_lg_url` and `username`.

### 2. Four HTML banner template styles

Created `banner_templates.go` with 4 Go `html/template` templates, each with distinct visual identity:

| Style | Visual Identity | Hover Effects |
|-------|----------------|---------------|
| **bold** | Pink 3px border, gradient CTA pill "Watch Me Now", "Exclusive Content" tagline, corner accent triangle | Image scale 1.05x + brightness boost, CTA glow intensifies + scale 1.05x |
| **elegant** | Gold (#C9A96E) accents, serif font (Georgia), diamond ornament, gold separator line | Image scale 1.04x + brightness boost, CTA opacity 0.8 -> 1.0 |
| **minimalist** | Clean bottom overlay, subtle "TemptGuide" watermark top-left, arrow CTA "View Profile ->" | Image scale 1.03x + brightness boost, CTA text brightens |
| **card** | 75% photo + 25% dark bottom bar (#1A1A2E), play button circle, red accent line, "live" LED dot | Photo scale 1.04x + brightness boost, play button scale 1.08x + glow intensifies |

All templates share:
- CSS image filters: `contrast(1.15) saturate(1.2) brightness(1.05)` for vivid, punchy images; on hover: `contrast(1.2) saturate(1.3) brightness(1.1)`
- Minimal dark gradients (bottom only, for text readability) — no full-image darkening
- Responsive `clamp()` font sizing
- `object-position: center 20%` for face-focused cropping
- Inline mouseenter JS for hover tracking (1x1 GIF pixel to `/b/{id}/hover`)
- System fonts only (no external font loading)
- Full viewport fill with overflow hidden
- `target="_top"` on click links to break out of iframe

### 3. Updated `ServeDynamic` handler

The handler now:
1. Accepts `style` query parameter (`bold`, `elegant`, `minimalist`, `card`)
2. Uses raw thumbnail (`thumbnail_lg_url`) instead of static JPEG banner image
3. Falls back to `ImageURL` if thumbnail not available
4. Renders HTML template via `pickBannerStyle(style)` + `tmpl.Execute()`
5. Unknown/empty `style` -> random selection from 4 styles

### 4. Style selector in test page

Updated `web/public/banner-test.html` with a dropdown to select banner style, allowing visual comparison of all 4 templates.

### 5. Tests

Two new test functions added to `banner_test.go`:

- **TestPickBannerStyle** — verifies known styles return correct template, unknown styles return a valid template (random fallback)
- **TestBannerTemplateRender** — renders all 4 templates with test data and verifies essential content (thumbnail URL, username, click/hover URLs, dimensions) is present in output

All 31 tests pass (`go test ./...`).

## Query parameter: `style`

| Value | Description |
|-------|-------------|
| `bold` | Bright, high-contrast with pink accents |
| `elegant` | Sophisticated with gold/serif styling |
| `minimalist` | Clean, unobtrusive overlay |
| `card` | Dark card layout with play button |
| *(empty/unknown)* | Random selection from all 4 styles |

Example usage:
```html
<iframe src="https://api.temptguide.com/b/serve?size=300x250&style=elegant" width="300" height="250"></iframe>
```

## Files changed

| File | Change |
|------|--------|
| `api/internal/store/admin_store.go` | Extended `ServableBanner` struct with `ThumbnailURL` and `Username` fields; updated `ListServableBanners` query to JOIN videos + accounts |
| `api/internal/handler/banner.go` | Updated `ServeDynamic` to render HTML templates instead of static `<a><img>`, added `style` query param parsing |
| `api/internal/handler/banner_templates.go` | **NEW:** 4 HTML banner template styles (bold, elegant, minimalist, card) with Go `html/template` |
| `api/internal/handler/banner_test.go` | Added `TestPickBannerStyle` and `TestBannerTemplateRender` tests |
| `web/public/banner-test.html` | Added style selector dropdown |

## Database changes

None. Uses existing tables. The `ListServableBanners` query was extended with JOINs but no schema changes.

## Template rendering flow

```
GET /b/serve?size=300x250&style=bold&cat=blonde
  -> parseBannerSize() -> 300x250
  -> getBannerPool() -> Redis cache / SQL query -> []ServableBanner
  -> selectBestBanner() -> CTR-based selection from pool
  -> pickBannerStyle("bold") -> *template.Template for bold
  -> thumbURL = banner.ThumbnailURL || banner.ImageURL
  -> tmpl.Execute(w, bannerTemplateData{
       ThumbnailURL: thumbURL,
       Username:     banner.Username,
       ClickURL:     "/b/{id}/click?src=...&click_id=...",
       HoverURL:     "/b/{id}/hover?src=...&click_id=...",
       Width:        300,
       Height:       250,
     })
  -> Response: interactive HTML with CSS hover effects
```

## Design decisions

1. **System fonts only** — no Google Fonts CDN or external font loading. Templates use `'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` (and Georgia for elegant). This eliminates external requests and FOUT.

2. **Raw thumbnail over static JPEG** — using `thumbnail_lg_url` (810x1440 portrait) provides higher quality source material than the pre-generated JPEG banner. The browser handles the resize via `object-fit: cover`.

3. **Go html/template (not text/template)** — automatic HTML escaping of user-provided data (username, URLs) prevents XSS.

4. **CSS-only hover effects** — no JS-based animations. All transitions use CSS `transition` property for GPU-accelerated performance. Only JS is the one-time mouseenter handler for hover tracking.

5. **Random default style** — when no `style` param is specified, a random style is chosen. This provides visual variety across banner placements and allows A/B testing which style performs best.

## Future improvements

- **A/B testing by style** — track CTR per style in ClickHouse, auto-select best-performing style per placement
- **Publisher style preference** — allow publishers to lock a preferred style via embed config
- **Animated transitions** — subtle CSS keyframe animations on load (fade-in, slide-up)
- **Dark/light mode** — style variants that adapt to publisher page background
- **Video thumbnail preview** — show animated thumbnail on hover (from preview_url)
