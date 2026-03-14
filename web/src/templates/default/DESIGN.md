# Template: default

## Concept
Instagram-inspired mobile feed. Single-column layout, 430px max-width, dark-only UI, magenta accent. No desktop layout — the site IS a mobile app in a browser.

---

## Color Tokens

| CSS Variable    | Value     | Usage                            |
|-----------------|-----------|----------------------------------|
| `--bg`          | `#0f0f0f` | Page background                  |
| `--bg-card`     | `#1a1a1a` | Cards, inputs                    |
| `--bg-hover`    | `#252525` | Hover state surfaces             |
| `--bg-elevated` | `#2a2a2a` | Elevated surfaces, avatar rings  |
| `--accent`      | `#e040fb` | CTA buttons, links, hashtags     |
| `--accent-hover`| `#ea80fc` | Accent hover state               |
| `--txt`         | `#ffffff` | Primary text                     |
| `--txt-secondary`| `#a0a0a0`| Secondary text, stats            |
| `--txt-muted`   | `#808080` | Timestamps, meta, placeholders   |
| `--border`      | `#2a2a2a` | Dividers, card borders           |
| `--border-hover`| `#3a3a3a` | Hover borders                    |

---

## Typography

| Element         | Size  | Weight | Notes                   |
|-----------------|-------|--------|-------------------------|
| Site name       | 22px  | 700    | Italic, tracking-tight  |
| Username (feed) | 13px  | 600    |                         |
| Body text       | 13px  | 400    | Line-height 18px        |
| Meta / time     | 13px  | 400    | `txt-muted`             |
| Category tags   | 13px  | 400    | `accent` color          |
| Profile name    | 16px  | 700    |                         |
| Section headers | 13px  | 600    |                         |

Font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

---

## Layout

- **Max width**: 430px, centered with `mx-auto`
- **Content padding**: `px-4` (16px)
- **Bottom nav height**: 48px + safe-area-inset
- **Header height**: 44px (main row) + 36px (profile sub-bar, optional)
- **Main padding-bottom**: `pb-14` (56px, clears bottom nav)

---

## Components

### Header
Sticky top bar with site logo. When on a model's profile page, shows a sticky sub-bar with the model's avatar, name, and an "Follow me" button linking to their OnlyFans. State managed via `OnlyFansContext`.

### BottomNav
Fixed bottom navigation with three tabs: Home (`/`), Search (`/search`), Shuffle (`/?sort=random`). Active tab shown in `txt`, inactive in `txt-muted`.

### VideoCard
Instagram-style post card. Shows: avatar, username, platform icon, timestamp, 4:5 thumbnail, view count, share button, title, category hashtags. Clicking the thumbnail navigates to the model's profile page with `?v={id}` to scroll to the video.

### ProfileGrid
Full-width single-column video grid. Each item links to the original social media post (`video.original_url`). Supports infinite scroll via `sentinelRef`. Videos shown at 4:5 aspect ratio.

### ProfileHeader
Profile page header: 80px avatar, display name, username, video count, bio, social link buttons (Instagram, OnlyFans, Fansly, X).

### SimilarModels
3-column grid of videos from accounts in the same category. Each cell links to the model's profile. Overlays avatar + name on a gradient.

### Footer
Minimal: copyright + sitemap link.

---

## UX Principles

1. **Mobile-first** — 430px max, no desktop breakpoints
2. **No modals** — navigation happens via page transitions only
3. **Hover = color only** — no scale, translate, or box-shadow on hover
4. **Content over chrome** — header and nav are minimal; content fills the screen
5. **External links open in new tab** — `target="_blank"` for all social/original URLs
6. **Analytics on every interaction** — impressions via IntersectionObserver, clicks tracked

---

## How to Create a New Template

1. Copy this folder: `cp -r templates/default templates/your-name`
2. Update `theme.ts` with your color scheme
3. Rewrite components as needed
4. Update `index.ts` to export your `template` object
5. Write your own `DESIGN.md`
6. Register in `_shared/registry.ts`:
   ```ts
   import { template as yourTemplate } from "../your-name";
   export const templates = { default: ..., "your-name": yourTemplate };
   ```
7. Set `NEXT_PUBLIC_TEMPLATE=your-name` in the site's `.env`
