# HTML-Only Banner Overlay (Remove Pillow Overlay)

> Completed: 2026-03-08
> ClickUp: https://app.clickup.com/t/869ccwqxd

## Problem

Banner generation pipeline had double-enhancement:
1. **Pillow** (`_pillow_overlay()` in `parser/utils/image.py`) baked gradient, text overlay ("WATCH ME NOW", "EXCLUSIVE CONTENT"), pink border, and dark tint directly into JPEG images
2. **HTML templates** (`banner_templates.go`) applied CSS `filter: contrast(1.15) saturate(1.2) brightness(1.05)` on top of already-enhanced images

This resulted in over-processed, unnatural-looking banners. Additionally, baked-in overlay prevented interactive hover effects from looking clean.

## Solution

Remove overlay from image generation (Pillow), render all visual overlay exclusively in HTML templates:

**BEFORE:**
```
image -> crop + enhance + Pillow overlay (gradient+text+border) -> JPEG -> R2 -> HTML template adds CSS filters (double enhancement)
```

**AFTER:**
```
image -> crop + enhance -> clean JPEG -> R2 -> HTML template renders all overlay (gradient, text, CTA, hover effects)
```

## Changes

### parser/utils/image.py
- Removed `_pillow_overlay()` call from `generate_banner()` function
- Banner images now store clean photos: smart crop + Pillow enhance (contrast, saturation, sharpness, brightness) + JPEG encode
- `_pillow_overlay()` function still exists in code but is no longer called

### api/internal/handler/banner_templates.go
- Removed CSS `filter: contrast(1.15) saturate(1.2) brightness(1.05)` from all 4 HTML templates (bold, elegant, minimalist, card)
- Image enhancement is already applied by Pillow during generation, so CSS filters caused double-enhancement
- Hover effects (scale, glow, opacity) remain intact

### api/internal/store/admin_store.go
- Added `ThumbnailURL` field to `AdminBanner` struct
- Updated `GetBannerByID` query to join `videos.thumbnail_lg_url` for admin preview access

### api/internal/handler/banner.go
- Updated `PreviewBanner` handler to use raw thumbnail URL (via `ThumbnailURL` field from store)
- Now consistent with `ServeDynamic` which already used raw thumbnails

## Additional Fixes (same session)

### Raise per_page limit for account banners (commit `6eaa569`)
- `api/internal/store/admin_store.go`: Changed per_page limit from 100 to 1000 in `ListAccountBanners`
- Needed because accounts with multi-frame banners can have hundreds of banners

### Fix banner deletion: filter by is_active and prevent resurrection (commit `0d91f81`)
- `api/internal/store/admin_store.go`: Added `b.is_active = true` filter to `ListAccountBanners` query -- deactivated banners no longer appear in admin banner list
- `parser/storage/db.py`: Removed `is_active = true` from ON CONFLICT clauses in `insert_banner` -- regeneration no longer reactivates manually deactivated banners (upsert only updates `image_url`)

## Deployment

- Deployed updated code to production
- Enqueued banner regeneration for all 14 active paid accounts
- All existing banners replaced with clean (no overlay) versions
- Banner deletion now properly persists through regeneration cycles
