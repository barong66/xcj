# Admin Promo Embed Code: Switch from iframe to loader.js + Style Selector

> Status: **Done** (2026-03-07)
> ClickUp: *(needs manual update — API token expired)*

---

## Problem

The admin promo page (`/admin/promo`) generated embed codes as raw `<iframe>` snippets pointing directly to `/b/serve?size=...`. This had several issues:
- Publishers had to manually configure category/keyword parameters in the iframe URL
- No way to select a banner style from the admin UI for the embed code
- Category and keyword controls in the admin UI were redundant — loader.js handles contextual targeting automatically by extracting page content

## Solution

Updated the admin promo embed code section to generate `<script>` tags using `loader.js` instead of raw `<iframe>` tags, and added a style selector dropdown.

## What was implemented

### 1. loader.js `data-style` attribute support

In `api/internal/handler/banner.go`, the `loaderJS` constant was updated to:
- Read `data-style` attribute from the `<script>` tag
- Pass it as `&style=...` parameter to the `/b/serve` URL in the dynamically created iframe

### 2. Admin promo page embed code rewrite

In `web/src/app/admin/promo/page.tsx`, the `EmbedCodeSection` component was rewritten:

**Before:**
```html
<iframe src="https://temptguide.com/b/serve?size=300x250&cat=xxx&kw=yyy" ...></iframe>
```

**After:**
```html
<script async src="https://temptguide.com/b/loader.js" data-size="300x250" data-style="bold"></script>
```

**Changes:**
- Embed code now generates `<script async src="/b/loader.js" data-size="...">`
- Added style dropdown selector (Bold, Elegant, Minimalist, Card, Random)
- Removed category/keywords controls — loader.js handles contextual targeting automatically via page content extraction
- Preview still uses iframe (`/b/serve` URL) for live rendering in the admin UI
- Removed unused imports (`getAdminCategories`, `AdminCategory`)

## Files changed

| File | Change |
|------|--------|
| `api/internal/handler/banner.go` | Added `data-style` attribute reading to `loaderJS` constant; passes `&style=` to `/b/serve` URL |
| `web/src/app/admin/promo/page.tsx` | `EmbedCodeSection` rewrite: script tag generation, style dropdown, removed category/keyword controls |

## Database changes

None.

## How embed code generation works now

1. Admin opens `/admin/promo` → Banners tab
2. Selects optional **source** (ad network) from dropdown
3. Selects optional **style** (Bold/Elegant/Minimalist/Card/Random) from dropdown
4. For each active banner size, the UI generates a copyable `<script>` tag:
   ```html
   <script async src="https://temptguide.com/b/loader.js" data-size="300x250" data-style="bold" data-src="exoclick"></script>
   ```
5. "Preview" button shows a live iframe rendering of `/b/serve` with the selected style
6. "Copy" button copies the script tag to clipboard

## Style options

| Value | Label | Description |
|-------|-------|-------------|
| *(empty)* | Random style | Server picks a random template on each impression |
| `bold` | Bold | Pink border, gradient CTA pill "Watch Me Now" |
| `elegant` | Elegant | Gold accents, serif font, diamond ornament |
| `minimalist` | Minimalist | Clean overlay, subtle watermark, arrow CTA |
| `card` | Card | Dark bottom bar, play button, red accent |
