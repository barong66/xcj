# Content Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/admin/content` page showing all videos with their extracted frames, allowing per-frame selection and deletion, with an accordion-style per-card edit mode.

**Architecture:** New Go store methods + handler endpoints sit in existing `admin_store.go` / `admin.go`. Frontend adds a new Next.js page at `web/src/app/admin/content/page.tsx` using existing patterns (ToastProvider, adminFetch, Tailwind dark theme).

**Tech Stack:** Go + pgx (store), Chi (routing), Next.js 14 App Router + Tailwind (frontend), TypeScript

---

## Chunk 1: Go API

### Task 1: Store types and ListContentVideos

**Files:**
- Modify: `api/internal/store/admin_store.go` (append to end of file)
- Test: `api/internal/handler/admin_test.go` (handler-level tests cover store via integration)

- [ ] **Step 1: Add ContentFrame and ContentVideo types to admin_store.go**

Append to `api/internal/store/admin_store.go`:

```go
// ─── Content (frame management) ──────────────────────────────────────────────

// ContentFrame is a single extracted frame of a video.
type ContentFrame struct {
	ID          int64    `json:"id"`
	FrameIndex  int      `json:"frame_index"`
	ImageURL    string   `json:"image_url"`
	Score       *float64 `json:"score"`
	IsSelected  bool     `json:"is_selected"`
	TimestampMS int      `json:"timestamp_ms"`
}

// ContentVideo is a video with all its frames, for the content admin page.
type ContentVideo struct {
	ID           int64          `json:"id"`
	AccountID    int64          `json:"account_id"`
	Username     string         `json:"username"`
	Platform     string         `json:"platform"`
	MediaType    string         `json:"media_type"`
	Width        *int           `json:"width"`
	Height       *int           `json:"height"`
	ViewCount    int64          `json:"view_count"`
	CreatedAt    time.Time      `json:"created_at"`
	ThumbnailURL string         `json:"thumbnail_url"`
	Categories   []string       `json:"categories"`
	Sites        []string       `json:"sites"`
	Frames       []ContentFrame `json:"frames"`
}

// ContentListResult is the paginated result for ListContentVideos.
type ContentListResult struct {
	Videos  []ContentVideo `json:"videos"`
	Total   int            `json:"total"`
	Page    int            `json:"page"`
	PerPage int            `json:"per_page"`
}

// ContentFilter holds filter parameters for ListContentVideos.
type ContentFilter struct {
	Platform     string // "instagram" | "twitter" | ""
	AccountID    int64  // 0 = all
	CategorySlug string // "" = all
	SiteID       int64  // 0 = all
	AspectRatio  string // "9:16" | "16:9" | "" = all
	Page         int    // 1-based
	PerPage      int    // default 20
}
```

- [ ] **Step 2: Add ListContentVideos method**

Append after the types above:

```go
// ListContentVideos returns paginated videos with all their frames, applying filters.
func (s *AdminStore) ListContentVideos(ctx context.Context, f ContentFilter) (*ContentListResult, error) {
	if f.Page < 1 {
		f.Page = 1
	}
	if f.PerPage < 1 || f.PerPage > 100 {
		f.PerPage = 20
	}
	offset := (f.Page - 1) * f.PerPage

	// Build WHERE clauses dynamically
	args := []any{}
	where := []string{"v.is_active = true"}
	argN := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}

	if f.Platform != "" {
		where = append(where, "a.platform = "+argN(f.Platform))
	}
	if f.AccountID > 0 {
		where = append(where, "v.account_id = "+argN(f.AccountID))
	}

	// Category filter via subquery
	categoryJoin := ""
	if f.CategorySlug != "" {
		categoryJoin = `JOIN video_categories vc ON vc.video_id = v.id
		JOIN categories cat ON cat.id = vc.category_id AND cat.slug = ` + argN(f.CategorySlug)
	}

	// Site filter via subquery
	siteJoin := ""
	if f.SiteID > 0 {
		siteJoin = `JOIN video_sites vs ON vs.video_id = v.id AND vs.site_id = ` + argN(f.SiteID)
	}

	// Aspect ratio filter
	if f.AspectRatio != "" {
		parts := strings.SplitN(f.AspectRatio, ":", 2)
		if len(parts) == 2 {
			aw, err1 := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
			ah, err2 := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
			if err1 == nil && err2 == nil && ah > 0 && aw > 0 {
				ratio := aw / ah
				lo := ratio * 0.92
				hi := ratio * 1.08
				where = append(where, fmt.Sprintf(
					"v.width IS NOT NULL AND v.height IS NOT NULL AND v.height > 0 AND (v.width::float/v.height::float) BETWEEN %s AND %s",
					argN(lo), argN(hi),
				))
			}
		}
	}

	whereClause := "WHERE " + strings.Join(where, " AND ")

	// Count query
	countSQL := fmt.Sprintf(`
		SELECT COUNT(DISTINCT v.id)
		FROM videos v
		JOIN accounts a ON a.id = v.account_id
		%s %s
		%s`, categoryJoin, siteJoin, whereClause)

	var total int
	if err := s.pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count content videos: %w", err)
	}

	if total == 0 {
		return &ContentListResult{Videos: []ContentVideo{}, Total: 0, Page: f.Page, PerPage: f.PerPage}, nil
	}

	// IDs query (paginated)
	limitArg := argN(f.PerPage)
	offsetArg := argN(offset)
	idsSQL := fmt.Sprintf(`
		SELECT DISTINCT v.id
		FROM videos v
		JOIN accounts a ON a.id = v.account_id
		%s %s
		%s
		ORDER BY v.id DESC
		LIMIT %s OFFSET %s`, categoryJoin, siteJoin, whereClause, limitArg, offsetArg)

	rows, err := s.pool.Query(ctx, idsSQL, args...)
	if err != nil {
		return nil, fmt.Errorf("query content video ids: %w", err)
	}
	var videoIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		videoIDs = append(videoIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(videoIDs) == 0 {
		return &ContentListResult{Videos: []ContentVideo{}, Total: total, Page: f.Page, PerPage: f.PerPage}, nil
	}

	// Fetch videos + frames for the page
	dataSQL := `
		SELECT
			v.id, v.account_id, v.media_type,
			v.width, v.height, v.view_count, v.created_at, v.thumbnail_url,
			a.username, a.platform,
			COALESCE((
				SELECT STRING_AGG(c.slug, ',' ORDER BY c.slug)
				FROM video_categories vc2
				JOIN categories c ON c.id = vc2.category_id
				WHERE vc2.video_id = v.id
			), '') AS categories,
			COALESCE((
				SELECT STRING_AGG(s.domain, ',' ORDER BY s.domain)
				FROM video_sites vs2
				JOIN sites s ON s.id = vs2.site_id
				WHERE vs2.video_id = v.id
			), '') AS sites,
			vf.id, vf.frame_index, vf.image_url, vf.score, vf.is_selected, vf.timestamp_ms
		FROM videos v
		JOIN accounts a ON a.id = v.account_id
		LEFT JOIN video_frames vf ON vf.video_id = v.id
		WHERE v.id = ANY($1)
		ORDER BY v.id DESC, vf.score DESC NULLS LAST, vf.frame_index ASC`

	rows2, err := s.pool.Query(ctx, dataSQL, videoIDs)
	if err != nil {
		return nil, fmt.Errorf("query content videos data: %w", err)
	}
	defer rows2.Close()

	videoMap := make(map[int64]*ContentVideo)
	videoOrder := make([]int64, 0, len(videoIDs))

	for rows2.Next() {
		var (
			v           ContentVideo
			categoriesCSV string
			sitesCSV      string
			frameID     *int64
			frameIndex  *int
			frameURL    *string
			frameScore  *float64
			frameSelected *bool
			frameTS     *int
		)
		if err := rows2.Scan(
			&v.ID, &v.AccountID, &v.MediaType,
			&v.Width, &v.Height, &v.ViewCount, &v.CreatedAt, &v.ThumbnailURL,
			&v.Username, &v.Platform,
			&categoriesCSV, &sitesCSV,
			&frameID, &frameIndex, &frameURL, &frameScore, &frameSelected, &frameTS,
		); err != nil {
			return nil, fmt.Errorf("scan content video row: %w", err)
		}

		if _, exists := videoMap[v.ID]; !exists {
			v.Categories = splitCSV(categoriesCSV)
			v.Sites = splitCSV(sitesCSV)
			v.Frames = []ContentFrame{}
			videoMap[v.ID] = &v
			videoOrder = append(videoOrder, v.ID)
		}

		if frameID != nil {
			frame := ContentFrame{
				ID:          *frameID,
				FrameIndex:  *frameIndex,
				ImageURL:    *frameURL,
				Score:       frameScore,
				IsSelected:  *frameSelected,
				TimestampMS: *frameTS,
			}
			videoMap[v.ID].Frames = append(videoMap[v.ID].Frames, frame)
		}
	}
	if err := rows2.Err(); err != nil {
		return nil, err
	}

	videos := make([]ContentVideo, 0, len(videoOrder))
	for _, id := range videoOrder {
		videos = append(videos, *videoMap[id])
	}

	return &ContentListResult{
		Videos:  videos,
		Total:   total,
		Page:    f.Page,
		PerPage: f.PerPage,
	}, nil
}

// splitCSV splits a comma-separated string into a slice, returning empty slice for "".
func splitCSV(s string) []string {
	if s == "" {
		return []string{}
	}
	return strings.Split(s, ",")
}
```

- [ ] **Step 3: Verify the file compiles**

```bash
cd api && go build ./...
```

Expected: no errors. If `strings` or `strconv` are missing from imports, add them.

- [ ] **Step 4: Commit**

```bash
git add api/internal/store/admin_store.go
git commit -m "feat(store): add ContentVideo types and ListContentVideos"
```

---

### Task 2: Store methods — SelectFrame, DeleteFrame, BulkDeleteFrames

**Files:**
- Modify: `api/internal/store/admin_store.go` (append after ListContentVideos)

- [ ] **Step 1: Add SelectFrame**

```go
// SelectFrame sets is_selected=true for the given frame and false for all other
// frames of the same video. Returns "frame not found" if the frame doesn't exist.
func (s *AdminStore) SelectFrame(ctx context.Context, frameID int64) error {
	// Get video_id for the frame
	var videoID int64
	err := s.pool.QueryRow(ctx,
		`SELECT video_id FROM video_frames WHERE id = $1`, frameID,
	).Scan(&videoID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("frame not found")
		}
		return fmt.Errorf("get frame video_id: %w", err)
	}

	// Update all frames of this video in one statement
	_, err = s.pool.Exec(ctx,
		`UPDATE video_frames SET is_selected = (id = $1) WHERE video_id = $2`,
		frameID, videoID,
	)
	if err != nil {
		return fmt.Errorf("select frame: %w", err)
	}
	return nil
}

// DeleteFrame removes a frame from video_frames and returns its image_url for
// optional R2 cleanup. Returns "frame not found" if id doesn't exist.
func (s *AdminStore) DeleteFrame(ctx context.Context, frameID int64) (imageURL string, err error) {
	err = s.pool.QueryRow(ctx,
		`DELETE FROM video_frames WHERE id = $1 RETURNING image_url`, frameID,
	).Scan(&imageURL)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", fmt.Errorf("frame not found")
		}
		return "", fmt.Errorf("delete frame: %w", err)
	}
	return imageURL, nil
}

// BulkDeleteFrames removes multiple frames. Returns the count of deleted rows.
func (s *AdminStore) BulkDeleteFrames(ctx context.Context, ids []int64) (int64, error) {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM video_frames WHERE id = ANY($1)`, ids,
	)
	if err != nil {
		return 0, fmt.Errorf("bulk delete frames: %w", err)
	}
	return tag.RowsAffected(), nil
}
```

- [ ] **Step 2: Compile**

```bash
cd api && go build ./...
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add api/internal/store/admin_store.go
git commit -m "feat(store): add SelectFrame, DeleteFrame, BulkDeleteFrames"
```

---

### Task 3: Handler methods

**Files:**
- Modify: `api/internal/handler/admin.go` (append new handler methods)
- Modify: `api/internal/handler/router.go` (register routes)
- Modify: `api/internal/handler/admin_test.go` (add tests)

- [ ] **Step 1: Write failing tests for handler input validation**

Add to `api/internal/handler/admin_test.go`:

```go
func TestSelectFrame_InvalidID(t *testing.T) {
	h := &AdminHandler{}
	tests := []struct {
		name    string
		idParam string
		want    int
	}{
		{"non-numeric", "abc", http.StatusBadRequest},
		{"float", "1.5", http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/admin/frames/"+tt.idParam+"/select", nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("id", tt.idParam)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
			rr := httptest.NewRecorder()
			h.SelectFrame(rr, req)
			if rr.Code != tt.want {
				t.Errorf("SelectFrame(%q) status = %d, want %d", tt.idParam, rr.Code, tt.want)
			}
		})
	}
}

func TestDeleteFrame_InvalidID(t *testing.T) {
	h := &AdminHandler{}
	tests := []struct {
		name    string
		idParam string
		want    int
	}{
		{"non-numeric", "xyz", http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodDelete, "/admin/frames/"+tt.idParam, nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("id", tt.idParam)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
			rr := httptest.NewRecorder()
			h.DeleteFrame(rr, req)
			if rr.Code != tt.want {
				t.Errorf("DeleteFrame(%q) status = %d, want %d", tt.idParam, rr.Code, tt.want)
			}
		})
	}
}

func TestBulkDeleteFrames_InvalidBody(t *testing.T) {
	h := &AdminHandler{}
	tests := []struct {
		name string
		body string
		want int
	}{
		{"empty body", "", http.StatusBadRequest},
		{"not json", "not-json", http.StatusBadRequest},
		{"empty ids", `{"ids":[]}`, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodDelete, "/admin/frames/bulk",
				strings.NewReader(tt.body))
			rr := httptest.NewRecorder()
			h.BulkDeleteFrames(rr, req)
			if rr.Code != tt.want {
				t.Errorf("BulkDeleteFrames(%q) status = %d, want %d", tt.body, rr.Code, tt.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run tests — expect compile failure (methods don't exist yet)**

```bash
cd api && go test ./internal/handler/ -run "TestSelectFrame|TestDeleteFrame|TestBulkDelete" -v 2>&1 | head -20
```

Expected: compile error — `h.SelectFrame undefined`

- [ ] **Step 3: Add handler methods to admin.go**

Append to `api/internal/handler/admin.go` (find section comment pattern and add after existing sections):

```go
// ─── Content (frame management) ──────────────────────────────────────────────

func (h *AdminHandler) GetContent(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	filter := store.ContentFilter{
		Platform:     q.Get("source"),
		AccountID:    int64Param(r, "account_id", 0),
		CategorySlug: q.Get("category"),
		SiteID:       int64Param(r, "site_id", 0),
		AspectRatio:  q.Get("aspect_ratio"),
		Page:         intParam(r, "page", 1),
		PerPage:      intParam(r, "per_page", 20),
	}
	result, err := h.admin.ListContentVideos(r.Context(), filter)
	if err != nil {
		slog.Error("admin: list content videos", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list content")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *AdminHandler) SelectFrame(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid frame id")
		return
	}
	if err := h.admin.SelectFrame(r.Context(), id); err != nil {
		if err.Error() == "frame not found" {
			writeError(w, http.StatusNotFound, "frame not found")
			return
		}
		slog.Error("admin: select frame", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to select frame")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *AdminHandler) DeleteFrame(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid frame id")
		return
	}
	_, err = h.admin.DeleteFrame(r.Context(), id)
	if err != nil {
		if err.Error() == "frame not found" {
			writeError(w, http.StatusNotFound, "frame not found")
			return
		}
		slog.Error("admin: delete frame", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to delete frame")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type bulkDeleteFramesInput struct {
	IDs []int64 `json:"ids"`
}

func (h *AdminHandler) BulkDeleteFrames(w http.ResponseWriter, r *http.Request) {
	var input bulkDeleteFramesInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(input.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids required")
		return
	}
	count, err := h.admin.BulkDeleteFrames(r.Context(), input.IDs)
	if err != nil {
		slog.Error("admin: bulk delete frames", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to delete frames")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": count})
}
```

Note: `int64Param` helper — check if it exists in admin.go. If not, add:

```go
func int64Param(r *http.Request, key string, def int64) int64 {
	s := r.URL.Query().Get(key)
	if s == "" {
		return def
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return def
	}
	return v
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd api && go test ./internal/handler/ -run "TestSelectFrame|TestDeleteFrame|TestBulkDelete" -v
```

Expected: all PASS

- [ ] **Step 5: Register routes in router.go**

In `api/internal/handler/router.go`, find the block of admin routes (after `r.Post("/enqueue-banners", ...)` or similar) and add:

```go
// Content / frame management
r.Get("/content", adminHandler.GetContent)
r.Post("/frames/{id}/select", adminHandler.SelectFrame)
r.Delete("/frames/{id}", adminHandler.DeleteFrame)
r.Delete("/frames/bulk", adminHandler.BulkDeleteFrames)
```

- [ ] **Step 6: Compile and run all API tests**

```bash
cd api && go build ./... && go test ./...
```

Expected: all pass, no compilation errors.

- [ ] **Step 7: Commit**

```bash
git add api/internal/handler/admin.go api/internal/handler/router.go api/internal/handler/admin_test.go
git commit -m "feat(api): add content page endpoints (GetContent, SelectFrame, DeleteFrame, BulkDeleteFrames)"
```

---

## Chunk 2: Frontend

### Task 4: API client types and functions

**Files:**
- Modify: `web/src/lib/admin-api.ts` (append new types + functions)

- [ ] **Step 1: Add types and functions to admin-api.ts**

Append to `web/src/lib/admin-api.ts`:

```typescript
// ─── Content (frame management) ──────────────────────────────────────────────

export interface ContentFrame {
  id: number;
  frame_index: number;
  image_url: string;
  score: number | null;
  is_selected: boolean;
  timestamp_ms: number;
}

export interface ContentVideo {
  id: number;
  account_id: number;
  username: string;
  platform: string;
  media_type: string;
  width: number | null;
  height: number | null;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  categories: string[];
  sites: string[];
  frames: ContentFrame[];
}

export interface ContentList {
  videos: ContentVideo[];
  total: number;
  page: number;
  per_page: number;
}

export async function getAdminContent(params?: {
  source?: string;
  account_id?: number;
  category?: string;
  site_id?: number;
  aspect_ratio?: string;
  page?: number;
  per_page?: number;
}): Promise<ContentList> {
  const sp = new URLSearchParams();
  if (params?.source) sp.set("source", params.source);
  if (params?.account_id) sp.set("account_id", String(params.account_id));
  if (params?.category) sp.set("category", params.category);
  if (params?.site_id) sp.set("site_id", String(params.site_id));
  if (params?.aspect_ratio) sp.set("aspect_ratio", params.aspect_ratio);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.per_page) sp.set("per_page", String(params.per_page));
  const qs = sp.toString();
  // Note: admin handlers use writeJSON directly (no {"data":...} wrapper)
  return adminFetch<ContentList>(`/content${qs ? `?${qs}` : ""}`);
}

export async function selectFrame(frameId: number): Promise<void> {
  await adminFetch(`/frames/${frameId}/select`, { method: "POST" });
}

export async function deleteFrame(frameId: number): Promise<void> {
  await adminFetch(`/frames/${frameId}`, { method: "DELETE" });
}

export async function bulkDeleteFrames(ids: number[]): Promise<{ deleted: number }> {
  return adminFetch<{ deleted: number }>("/frames/bulk", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to admin-api.ts

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/admin-api.ts
git commit -m "feat(web): add content page API client types and functions"
```

---

### Task 5: Content page component

**Files:**
- Create: `web/src/app/admin/content/page.tsx`

- [ ] **Step 1: Create the page file**

Create `web/src/app/admin/content/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAdminContent,
  selectFrame,
  deleteFrame,
  bulkDeleteFrames,
  type ContentVideo,
  type ContentFrame,
} from "@/lib/admin-api";
import { ToastProvider, useToast } from "../Toast";

// ─── Filter helpers ───────────────────────────────────────────────────────────

const ASPECT_RATIOS = ["9:16", "16:9", "4:5", "1:1"];

function aspectLabel(w: number | null, h: number | null): string {
  if (!w || !h || h === 0) return "";
  const r = w / h;
  if (r < 0.7) return "9:16";
  if (r > 1.5) return "16:9";
  if (r < 0.85) return "4:5";
  return "1:1";
}

// ─── Frame card ───────────────────────────────────────────────────────────────

function FrameCard({
  frame,
  isChecked,
  onToggleCheck,
  onSelect,
  onDelete,
}: {
  frame: ContentFrame;
  isChecked: boolean;
  onToggleCheck: (id: number) => void;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const score = frame.score;
  const scoreClass =
    score === null
      ? ""
      : score >= 7
      ? "bg-green-900/30 text-green-400 border border-green-800/40"
      : score >= 4
      ? "bg-black/70 text-neutral-500 border border-neutral-800"
      : "bg-black/50 text-neutral-700 border border-neutral-900";

  const opacity =
    score === null ? 1 : score >= 7 ? 1 : score >= 4 ? 0.9 : score >= 3 ? 0.55 : 0.35;

  return (
    <div
      className="relative flex-shrink-0 rounded-lg overflow-hidden cursor-pointer"
      style={{ width: 202, height: 360, opacity }}
      onClick={() => onToggleCheck(frame.id)}
    >
      {/* Thumbnail image */}
      <img
        src={frame.image_url}
        alt=""
        className="w-full h-full object-cover rounded-lg"
        style={{
          border: `3px solid ${
            frame.is_selected ? "#22c55e" : isChecked ? "#3b82f6" : "transparent"
          }`,
          borderRadius: 8,
        }}
        draggable={false}
      />

      {/* Top-left: star badge (selected) or bulk checkbox */}
      <div
        className="absolute top-2 left-2 z-10"
        onClick={(e) => {
          e.stopPropagation();
          if (!frame.is_selected) onToggleCheck(frame.id);
        }}
      >
        {frame.is_selected ? (
          <span className="bg-green-900/30 text-green-400 border border-green-700/50 rounded-full px-2.5 py-1 text-xs font-bold backdrop-blur-sm">
            ★ выбран
          </span>
        ) : (
          <div
            className={`w-6 h-6 rounded-md flex items-center justify-center text-sm backdrop-blur-sm border ${
              isChecked
                ? "bg-blue-500/85 border-blue-400 text-white"
                : "bg-black/70 border-neutral-600"
            }`}
          >
            {isChecked ? "✓" : ""}
          </div>
        )}
      </div>

      {/* Top-right: score */}
      {score !== null && (
        <div
          className={`absolute top-2 right-2 z-10 rounded-full px-2.5 py-1 text-base font-extrabold backdrop-blur-sm pointer-events-none ${scoreClass}`}
        >
          {score.toFixed(1)}
        </div>
      )}
      {frame.score === null && (
        <div className="absolute top-2 right-2 z-10 rounded-full px-2.5 py-1 text-xs text-neutral-700 backdrop-blur-sm pointer-events-none">
          фото {frame.frame_index + 1}
        </div>
      )}

      {/* Bottom overlay: action buttons */}
      <div
        className="absolute bottom-0 left-0 right-0 flex gap-1.5 p-2 pt-10 z-10"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.45) 55%, transparent 100%)",
          borderRadius: "0 0 6px 6px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {!frame.is_selected && (
          <button
            className="flex-1 h-9 rounded-lg text-xs font-semibold text-green-400 border border-green-800/40 bg-green-900/25 backdrop-blur-sm hover:bg-green-900/40 transition-colors"
            onClick={() => onSelect(frame.id)}
          >
            ★ Выбрать
          </button>
        )}
        <button
          className="flex-1 h-9 rounded-lg text-xs font-semibold text-red-400 border border-red-900/40 bg-red-950/20 backdrop-blur-sm hover:bg-red-950/40 transition-colors"
          onClick={() => onDelete(frame.id)}
        >
          🗑 Удалить
        </button>
      </div>
    </div>
  );
}

// ─── Video card ───────────────────────────────────────────────────────────────

function VideoCard({
  video,
  isExpanded,
  checkedFrames,
  onToggleExpand,
  onToggleFrameCheck,
  onSelectAll,
  onSelectFrame,
  onDeleteFrame,
}: {
  video: ContentVideo;
  isExpanded: boolean;
  checkedFrames: Set<number>;
  onToggleExpand: (id: number) => void;
  onToggleFrameCheck: (id: number) => void;
  onSelectAll: (videoId: number) => void;
  onSelectFrame: (frameId: number) => void;
  onDeleteFrame: (frameId: number) => void;
}) {
  const ratio = aspectLabel(video.width, video.height);

  return (
    <div
      className={`rounded-xl overflow-hidden border ${
        isExpanded ? "border-green-900/50" : "border-[#1e1e1e]"
      } bg-[#111]`}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-start gap-3 border-b border-[#181818]">
        <div className="mt-0.5 w-14 h-8 bg-[#1e1e1e] rounded flex items-center justify-center text-[9px] text-neutral-600 flex-shrink-0">
          {video.media_type === "image" ? "🖼 img" : "▶ vid"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-sm mb-1.5">
            @{video.username}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-1">
            <Badge color="purple">{video.platform}</Badge>
            {video.categories.map((c) => (
              <Badge key={c} color="green">{c}</Badge>
            ))}
            {video.sites.map((s) => (
              <Badge key={s} color="blue">{s}</Badge>
            ))}
            {ratio && <Badge color="yellow">{ratio}</Badge>}
          </div>
          <div className="text-xs text-neutral-700">
            {new Date(video.created_at).toLocaleDateString("ru-RU")} ·{" "}
            {video.view_count > 0
              ? `${(video.view_count / 1_000_000).toFixed(1)}M просмотров · `
              : ""}
            ID {video.id}
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0 items-center">
          {isExpanded && (
            <button
              className="text-xs text-neutral-600 px-3 py-1.5 border border-[#1e1e1e] rounded-full hover:text-neutral-400 hover:border-[#333] transition-colors"
              onClick={() => onSelectAll(video.id)}
            >
              ☑ все
            </button>
          )}
          <button
            className={`text-xs px-3 py-1.5 border rounded-full transition-colors ${
              isExpanded
                ? "text-green-400 border-green-900/50 hover:border-green-700"
                : "text-neutral-600 border-[#1e1e1e] hover:text-neutral-400 hover:border-[#333]"
            }`}
            onClick={() => onToggleExpand(video.id)}
          >
            {isExpanded ? "✕ Свернуть" : "✏ Ред."}
          </button>
        </div>
      </div>

      {/* Compact view: just the best frame */}
      {!isExpanded && (
        <div className="p-3">
          {video.frames.filter((f) => f.is_selected).map((frame) => (
            <div key={frame.id} className="relative inline-block rounded-lg overflow-hidden" style={{ width: 202, height: 360 }}>
              <img
                src={frame.image_url}
                alt=""
                className="w-full h-full object-cover rounded-lg"
                style={{ border: "3px solid #22c55e", borderRadius: 8 }}
              />
              {frame.score !== null && (
                <div className="absolute top-2 right-2 bg-green-900/30 text-green-400 border border-green-800/40 rounded-full px-2.5 py-1 text-base font-extrabold backdrop-blur-sm">
                  {frame.score.toFixed(1)}
                </div>
              )}
              <div className="absolute top-2 left-2">
                <span className="bg-green-900/30 text-green-400 border border-green-700/50 rounded-full px-2.5 py-1 text-xs font-bold backdrop-blur-sm">
                  ★ выбран
                </span>
              </div>
            </div>
          ))}
          {video.frames.filter((f) => f.is_selected).length === 0 && (
            <div className="text-xs text-neutral-700 py-2">нет выбранного фрейма</div>
          )}
        </div>
      )}

      {/* Expanded view: all frames */}
      {isExpanded && (
        <div
          className="flex gap-2.5 overflow-x-auto p-3"
          style={{ scrollbarWidth: "thin", scrollbarColor: "#222 transparent" }}
        >
          {video.frames.map((frame) => (
            <FrameCard
              key={frame.id}
              frame={frame}
              isChecked={checkedFrames.has(frame.id)}
              onToggleCheck={onToggleFrameCheck}
              onSelect={onSelectFrame}
              onDelete={onDeleteFrame}
            />
          ))}
          {video.frames.length === 0 && (
            <div className="text-xs text-neutral-700 py-4 px-2">нет фреймов</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "purple" | "green" | "blue" | "yellow";
}) {
  const cls = {
    purple: "bg-purple-900/15 text-purple-400",
    green: "bg-green-900/15 text-green-400",
    blue: "bg-blue-900/15 text-blue-400",
    yellow: "bg-yellow-900/15 text-yellow-400",
  }[color];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cls}`}>
      {children}
    </span>
  );
}

// ─── Filter pill ──────────────────────────────────────────────────────────────

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs border transition-colors ${
        active
          ? "bg-green-950/20 border-green-900/50 text-green-400"
          : "bg-[#161616] border-[#252525] text-neutral-500 hover:text-neutral-300 hover:border-[#333]"
      }`}
    >
      {label}
    </button>
  );
}

// ─── Main content component ───────────────────────────────────────────────────

function ContentPageContent() {
  const { toast } = useToast();

  // Filters
  const [source, setSource] = useState<string>("");
  const [accountId, setAccountId] = useState<number | undefined>(undefined);
  const [category, setCategory] = useState<string>("");
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [aspectRatio, setAspectRatio] = useState<string>("");
  const [page, setPage] = useState(1);

  // Data
  const [data, setData] = useState<{ videos: ContentVideo[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);

  // UI state
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [checkedFrames, setCheckedFrames] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getAdminContent({
        source: source || undefined,
        account_id: accountId,
        category: category || undefined,
        site_id: siteId,
        aspect_ratio: aspectRatio || undefined,
        page,
        per_page: 20,
      });
      setData(result);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Ошибка загрузки", "error");
    } finally {
      setLoading(false);
    }
  }, [source, accountId, category, siteId, aspectRatio, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset page on filter change
  const resetPage = () => setPage(1);

  // Expand/collapse accordion
  const handleToggleExpand = (videoId: number) => {
    setExpandedId((prev) => (prev === videoId ? null : videoId));
    setCheckedFrames(new Set());
  };

  // Toggle single frame check
  const handleToggleFrameCheck = (frameId: number) => {
    setCheckedFrames((prev) => {
      const next = new Set(prev);
      if (next.has(frameId)) next.delete(frameId);
      else next.add(frameId);
      return next;
    });
  };

  // Select all frames in a video
  const handleSelectAll = (videoId: number) => {
    const video = data?.videos.find((v) => v.id === videoId);
    if (!video) return;
    setCheckedFrames((prev) => {
      const next = new Set(prev);
      video.frames.forEach((f) => next.add(f.id));
      return next;
    });
  };

  // Select a frame as best
  const handleSelectFrame = async (frameId: number) => {
    try {
      await selectFrame(frameId);
      toast("Фрейм выбран как лучший");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Ошибка", "error");
    }
  };

  // Delete single frame
  const handleDeleteFrame = async (frameId: number) => {
    if (!confirm("Удалить фрейм?")) return;
    try {
      await deleteFrame(frameId);
      toast("Фрейм удалён");
      setCheckedFrames((prev) => {
        const next = new Set(prev);
        next.delete(frameId);
        return next;
      });
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Ошибка удаления", "error");
    }
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    const ids = Array.from(checkedFrames);
    if (ids.length === 0) return;
    if (!confirm(`Удалить ${ids.length} фреймов?`)) return;
    try {
      const result = await bulkDeleteFrames(ids);
      toast(`Удалено ${result.deleted} фреймов`);
      setCheckedFrames(new Set());
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Ошибка удаления", "error");
    }
  };

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  return (
    <div className="p-6 max-w-screen-2xl">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-white tracking-tight">Контент</h1>
        <p className="text-xs text-neutral-600 mt-1">
          {data ? `${data.total} видео` : "Загрузка..."}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center mb-5">
        {(["instagram", "twitter"] as const).map((s) => (
          <FilterPill
            key={s}
            label={s === "instagram" ? "📷 Instagram" : "🐦 Twitter"}
            active={source === s}
            onClick={() => {
              setSource(source === s ? "" : s);
              resetPage();
            }}
          />
        ))}
        <div className="w-px h-5 bg-[#1e1e1e] mx-1" />
        {ASPECT_RATIOS.map((ar) => (
          <FilterPill
            key={ar}
            label={ar}
            active={aspectRatio === ar}
            onClick={() => {
              setAspectRatio(aspectRatio === ar ? "" : ar);
              resetPage();
            }}
          />
        ))}
        {(source || aspectRatio || category) && (
          <>
            <div className="w-px h-5 bg-[#1e1e1e] mx-1" />
            <button
              className="text-xs text-neutral-700 hover:text-neutral-400 px-2 py-1.5 transition-colors"
              onClick={() => {
                setSource("");
                setAspectRatio("");
                setCategory("");
                setSiteId(undefined);
                setAccountId(undefined);
                resetPage();
              }}
            >
              ✕ сбросить
            </button>
          </>
        )}
      </div>

      {/* Bulk action bar */}
      {checkedFrames.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-[#0d0d1f] border border-indigo-900/40 rounded-lg">
          <span className="text-indigo-400 text-xs font-medium">
            ✓ {checkedFrames.size} фреймов выбрано
          </span>
          <button
            onClick={handleBulkDelete}
            className="text-xs font-medium px-3 py-1.5 rounded-full bg-red-950/20 text-red-400 border border-red-900/30 hover:bg-red-950/40 transition-colors"
          >
            🗑 Удалить выбранные
          </button>
          <button
            onClick={() => setCheckedFrames(new Set())}
            className="text-xs text-neutral-600 px-3 py-1.5 border border-[#1e1e1e] rounded-full hover:text-neutral-400 transition-colors"
          >
            Снять выделение
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-neutral-600 text-sm">
          Загрузка...
        </div>
      ) : data && data.videos.length > 0 ? (
        <>
          <div className="flex flex-col gap-2.5">
            {data.videos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                isExpanded={expandedId === video.id}
                checkedFrames={checkedFrames}
                onToggleExpand={handleToggleExpand}
                onToggleFrameCheck={handleToggleFrameCheck}
                onSelectAll={handleSelectAll}
                onSelectFrame={handleSelectFrame}
                onDeleteFrame={handleDeleteFrame}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <span className="text-xs text-neutral-600">
                Стр. {page} из {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1.5 text-xs rounded bg-[#1e1e1e] text-neutral-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  ← Назад
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1.5 text-xs rounded bg-[#1e1e1e] text-neutral-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Вперёд →
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="bg-[#141414] rounded-xl border border-[#1e1e1e] p-8 text-center text-neutral-600 text-sm">
          Ничего не найдено
        </div>
      )}
    </div>
  );
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function ContentPage() {
  return (
    <ToastProvider>
      <ContentPageContent />
    </ToastProvider>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors in `content/page.tsx`

- [ ] **Step 3: Commit**

```bash
git add web/src/app/admin/content/page.tsx
git commit -m "feat(web): add Content admin page with accordion frame editing"
```

---

### Task 6: Add "Контент" to admin navigation

**Files:**
- Modify: `web/src/app/admin/AdminShell.tsx`

- [ ] **Step 1: Add nav item**

In `web/src/app/admin/AdminShell.tsx`, find the `navItems` array. The spec requires inserting "Контент" between "Videos" and "Promo". Find the entry with `href: "/admin/promo"` and insert the new item **immediately before it**:

```tsx
{
  label: "Контент",
  href: "/admin/content",
  icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  ),
},
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Smoke-test in dev**

```bash
cd web && npm run dev &
sleep 5
curl -s http://localhost:3000/admin/content | grep -c "Content" || true
```

Expected: page loads without 500 errors (will show login redirect without auth)

- [ ] **Step 4: Commit**

```bash
git add web/src/app/admin/AdminShell.tsx
git commit -m "feat(web): add Контент nav item to admin sidebar"
```

---

### Task 7: Run full test suite

- [ ] **Step 1: Go tests**

```bash
cd api && go test ./... -v 2>&1 | tail -20
```

Expected: all PASS

- [ ] **Step 2: TypeScript build**

```bash
cd web && npm run build 2>&1 | tail -20
```

Expected: successful build, no type errors

- [ ] **Step 3: Commit**

```bash
git add api/ web/
git commit -m "chore: fix any remaining build issues from full test run"
```
