# Content Page Design
**Date:** 2026-03-12
**Status:** Approved

## Overview

New admin section `/admin/content` for curating video thumbnails (frames). Shows all videos with their extracted frames, allows selecting the best frame per video and bulk-deleting unwanted frames.

## UX: Two States (No Toggle)

The page has no mode switcher. It's one list with accordion behavior:

- **Default (compact):** All videos listed vertically. Each card shows only the best (selected) frame + NeuroScore + "✏ Ред." button.
- **Expanded (edit):** Clicking "Ред." on a card expands it inline to show all frames with actions. Other cards stay compact.

## Page Layout

### Filters (pill style, top of page)
- Источник (Instagram / Twitter)
- Аккаунт (dropdown)
- Категория (dropdown)
- Сайт (dropdown)
- Формат / соотношение сторон (9:16, 16:9, 4:5, etc.)
- "✕ сбросить" reset link

### Bulk Action Bar (appears when frames are checked)
- "✓ N фреймов выбрано"
- "🗑 Удалить выбранные" button
- "Снять выделение" button

### Video List (20 per page, vertical scroll)

Each compact card:
- Checkbox (video-level)
- Mini video thumbnail
- Account name
- Badges: source, category, site, aspect ratio
- Date / views / ID
- "☑ выбрать все" button (right side)
- "✏ Ред." button (right side)

When expanded (edit mode):
- Header stays, "✕ Свернуть" replaces "✏ Ред."
- Horizontal scroll row of all frames

## Frame Card (202×360px display, source 810×1440)

Frames sorted by NeuroScore descending. Low-score frames visually dimmed (opacity).

### Top-left
- **Best frame:** `★ выбран` green badge (replaces checkbox)
- **Other frames:** 24×24 checkbox for bulk selection (click image center also toggles)

### Top-right
- NeuroScore badge: 15px bold, color-coded
  - ≥7.0: green (`rgba(34,197,94)`)
  - 4.0–6.9: neutral gray
  - <4.0: dimmed (`opacity: 0.55` → `0.28` gradient)

### Bottom overlay (always visible, gradient over image)
- **Best frame:** only "🗑 Удалить"
- **Other frames:** "★ Выбрать" + "🗑 Удалить"
- Semi-transparent, backdrop-filter blur

### Selection state
- Bulk-selected: blue border (`#3b82f6`)
- Best frame: green border (`#22c55e`)

### Image posts (media_type = 'image')
- Same card layout, no NeuroScore badge
- Photos numbered (фото 1, фото 2...)
- Same select/delete actions

## API Endpoints (Go)

### `GET /api/v1/admin/content`
List videos with their frames.

Query params:
- `source` — instagram | twitter
- `account_id` — filter by account
- `category` — filter by category slug
- `site_id` — filter by site
- `aspect_ratio` — e.g. "9:16", "16:9"
- `page`, `limit` (default 20)

Response:
```json
{
  "data": {
    "videos": [
      {
        "id": 4821,
        "account": "@blonde_model",
        "source": "instagram",
        "category": "blonde",
        "site": "temptguide.com",
        "width": 810, "height": 1440,
        "views": 2100000,
        "created_at": "2026-03-12T...",
        "thumbnail_url": "https://media.temptguide.com/...",
        "frames": [
          {
            "id": 12345,
            "frame_index": 0,
            "image_url": "https://media.temptguide.com/...",
            "score": 9.2,
            "is_selected": true
          }
        ]
      }
    ],
    "total": 1248,
    "page": 1,
    "limit": 20
  },
  "status": "ok"
}
```

### `POST /api/v1/admin/frames/:id/select`
Mark frame as selected (sets `is_selected=true` for this frame, `false` for all others of same video).

### `DELETE /api/v1/admin/frames/:id`
Delete a single frame (removes from `video_frames` table and R2).

### `DELETE /api/v1/admin/frames/bulk`
Bulk delete frames.

Body: `{"ids": [123, 456, 789]}`

## Frontend (Next.js)

### Files
- `web/src/app/admin/content/page.tsx` — main page
- `web/src/lib/admin-api.ts` — add new API calls

### State
- `expandedVideoId: number | null` — which card is in edit mode
- `selectedFrameIds: Set<number>` — frames checked for bulk delete
- Filter state (source, accountId, categoryId, siteId, aspectRatio, page)

### Key behaviors
- Clicking "✏ Ред." → sets `expandedVideoId`, collapses previously expanded card
- Clicking image center → toggles frame in `selectedFrameIds` (blue border)
- Clicking bulk checkbox → same as clicking image center
- Shift+click support for range selection across frames in a row
- "★ Выбрать" → calls `POST /frames/:id/select`, updates local state (new frame gets green border, old loses it)
- "🗑 Удалить" (single) → calls `DELETE /frames/:id`, removes from local state
- "🗑 Удалить выбранные" → calls `DELETE /frames/bulk`, clears selection

## DB Changes
None required. Uses existing:
- `video_frames` (id, video_id, frame_index, image_url, score, is_selected)
- `videos` (id, width, height, media_type, thumbnail_url, thumbnail_lg_url)

## Navigation
Add "Контент" link to admin sidebar between "Videos" and "Promo".
