# SEO: Comprehensive Audit + Fixes

> Date: 2026-03-07
> Status: Done
> ClickUp: https://app.clickup.com/t/869ccz7c5

---

## Summary

Comprehensive SEO audit performed with Lighthouse. All identified issues fixed. Final Lighthouse SEO score: **100/100**.

## Lighthouse Scores

| Metric | Score |
|--------|-------|
| Performance | 76 |
| SEO | 100 |
| Best Practices | 96 |
| Accessibility | 79 |
| LCP (mobile) | 5.9s |

## New Files Created

### `web/src/app/opengraph-image.tsx`
Dynamic OG image generation using Next.js `ImageResponse`. Produces a 1200x630 PNG with:
- Dark gradient background
- TemptGuide branding (logo text + tagline)
- Used automatically by social platforms when sharing any page

### `web/src/app/twitter-image.tsx`
Same as OG image but specifically for Twitter Cards. Ensures proper preview when links are shared on Twitter/X.

## Files Modified (13 total)

### 1. `web/src/app/page.tsx`
- Added `canonical` URL to homepage metadata (`https://temptguide.com`)
- Added hidden `<h1>` heading for SEO (visually hidden but accessible to crawlers)

### 2. `web/src/components/JsonLd.tsx`
- Fixed `uploadDate` in VideoJsonLd: was using `new Date()` (current date), now correctly uses `video.published_at` (actual publication date)

### 3. `web/src/app/video/[id]/page.tsx`
- Added fallback for emoji-only video titles in meta tags
- When title contains no text characters (only emoji), generates "Video by @username on Platform" for better SEO
- Prevents empty or meaningless meta titles/descriptions

### 4. `web/src/app/model/[slug]/page.tsx`
- Added complete `twitter` card metadata:
  - `card: 'summary_large_image'`
  - `title`, `description`, `images`
- Sanitized bio for meta description: strip newlines (`\n` -> ` `), limit to 155 characters

### 5. `web/src/app/category/[slug]/page.tsx`
- Added `twitter` metadata (card, title, description)
- Changed heading from `<p>` to `<h1>` for proper heading hierarchy

### 6. `web/src/app/country/[code]/page.tsx`
- Added `twitter` metadata (card, title, description)

### 7. `web/src/app/account/[platform]/[username]/page.tsx`
- Added `twitter` metadata (card, title, description)
- Changed `<p>` to `<h1>` for username heading

### 8. `web/src/app/categories/page.tsx`
- Improved meta description (more descriptive)
- Added `canonical` URL
- Changed `<p>` to `<h1>` for "Browse Categories" heading

### 9. `web/src/app/sitemap.ts`
Massively expanded sitemap coverage:
- **Before:** homepage + videos only
- **After:**
  - Homepage (`/`)
  - `/categories` page
  - Model profile pages (`/model/{slug}`) via `getAccounts()` API
  - Account pages (`/account/{platform}/{username}`) via `getAccounts()` API
  - 15 country pages (`/country/{code}`)
  - Paginated videos: up to 500 videos (5 pages of 100, via `getVideos()` pagination)

### 10. `web/src/app/robots.ts`
- Added `/admin` to disallow list (was only blocking `/api/` and `/search`)

### 11. `web/next.config.mjs`
- Restricted image domains from wildcard `**` to specific CDN domains:
  - `media.temptguide.com` (R2 CDN)
  - `*.cdninstagram.com` (Instagram)
  - `*.fbcdn.net` (Facebook CDN / Instagram)
  - `pbs.twimg.com` (Twitter)
  - `abs.twimg.com` (Twitter)
- Prevents arbitrary external image loading (security + performance)

## Known Issues (Not Fixed)

### LCP 5.9s on Mobile
- Largest Contentful Paint is 5.9 seconds on mobile
- Root cause: VideoCard images in the feed are lazy-loaded by default (expected behavior for below-fold items)
- Hero image on `/video/[id]` pages already has `priority` attribute (loads eagerly)
- Fix would require: preloading first N VideoCard images in the feed, or implementing a dedicated hero section on homepage
- Tracked as a separate optimization task

## SEO Checklist (All Passing)

- [x] All pages have unique `<title>` tags
- [x] All pages have meta descriptions
- [x] Open Graph tags on all pages
- [x] Twitter Card tags on all dynamic pages
- [x] Dynamic OG/Twitter images
- [x] Proper heading hierarchy (single `<h1>` per page)
- [x] Canonical URLs on key pages
- [x] Comprehensive sitemap (models, accounts, countries, videos)
- [x] robots.txt blocks admin, API, search
- [x] Structured data: VideoObject, Person, BreadcrumbList, WebSite+SearchAction
- [x] Image domains restricted to known CDNs
- [x] uploadDate uses actual publication date (not current date)
- [x] Emoji-only titles have text fallback
