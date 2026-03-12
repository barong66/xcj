# Admin Content Page — Frame Management

**Completed:** 2026-03-12
**ClickUp:** https://app.clickup.com/t/869cetq3f

---

## What the feature does

New `/admin/content` page for curating video thumbnails and frames across all accounts. Allows admin to review all extracted frames per video, select the best frame, and delete unwanted frames individually or in bulk.

Use case: after the parser extracts 4+ frames per video and scores them via NeuroScore, the admin can manually review and curate which frame best represents each video for banner generation.

---

## UX Description

### Accordion layout

Each video is rendered as an accordion row:
- **Collapsed (default):** shows video title, account, platform, and the currently selected (best) frame as a compact card
- **Expanded ("Ред." button):** shows all extracted frames for that video as a grid of cards

### Frame cards

- Size: **202x360px** (portrait, 9:16 friendly)
- Show: frame thumbnail image
- **NeuroScore badge:** visual score indicator in corner
- **Selection state:** highlighted border when this frame is the selected/best frame
- **Bulk-select checkbox:** allows selecting multiple frames for bulk delete

### Filters

- **Source:** Instagram / Twitter
- **Aspect ratio:** 9:16, 16:9, 4:5, 1:1

### Bulk delete

- Select multiple frames via checkboxes
- "Delete selected" button appears
- Confirmation dialog before deletion

---

## Key files modified

| File | Change |
|------|--------|
| `api/internal/store/admin_store.go` | Added `ContentFrame`, `ContentVideo` types; `ListContentVideos`, `SelectFrame`, `DeleteFrame`, `BulkDeleteFrames` methods |
| `api/internal/handler/admin.go` | Added `GetContent`, `SelectFrame`, `DeleteFrame`, `BulkDeleteFrames` HTTP handlers; `int64Param` helper |
| `api/internal/handler/router.go` | Registered 4 new admin routes |
| `api/internal/handler/admin_test.go` | Validation tests for new handlers |
| `web/src/lib/admin-api.ts` | Added `ContentFrame`, `ContentVideo`, `ContentList` TypeScript types + API call functions |
| `web/src/app/admin/content/page.tsx` | New page component (created) |
| `web/src/app/admin/AdminShell.tsx` | Added "Контент" nav item to sidebar |

---

## API endpoints added

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/content` | List videos with frames. Query params: `source`, `account_id`, `category`, `site_id`, `aspect_ratio`, `page`, `per_page` |
| POST | `/api/v1/admin/frames/{id}/select` | Mark a frame as selected (best frame) for its video |
| DELETE | `/api/v1/admin/frames/{id}` | Delete a single frame |
| DELETE | `/api/v1/admin/frames/bulk` | Bulk delete frames. Body: `{"ids": [1, 2, 3]}` |

### Response types

```typescript
interface ContentFrame {
  id: number;
  video_id: number;
  image_url: string;
  neuro_score?: number;
  is_selected: boolean;
  aspect_ratio?: string;
  created_at: string;
}

interface ContentVideo {
  id: number;
  title: string;
  platform: "twitter" | "instagram";
  account_username: string;
  account_id: number;
  frames: ContentFrame[];
  selected_frame?: ContentFrame;
}

interface ContentList {
  videos: ContentVideo[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}
```

---

## Store layer

`ListContentVideos` in `admin_store.go`:
- Queries `videos` joined with `video_frames`
- Supports filters: source (platform), account_id, category, site_id, aspect_ratio
- Pagination: page + per_page
- Returns `ContentVideo` list with nested `ContentFrame` slices

`SelectFrame`:
- Sets `is_selected = true` on the target frame
- Clears `is_selected` on all other frames for the same video

`DeleteFrame` / `BulkDeleteFrames`:
- Hard DELETE from `video_frames`
- Bulk version accepts slice of int64 IDs
