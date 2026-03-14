# NeuroScore Thumbnail Selection

**Completed:** 2026-03-14
**ClickUp:** https://app.clickup.com/t/869cfucjq
**Commit:** `2744a16` — "Add NeuroScore thumbnail selection: extract 10 frames, score via API, pick best"

---

## What it does

Automatically selects the best video frame as the thumbnail using NeuroScore Score API. Instead of relying on the platform-provided thumbnail or arbitrarily picking the first extracted frame, the parser extracts 10 frames, scores them all via an external AI scoring API, and uses the highest-scoring frame as the video's thumbnail.

---

## How it works

```
Video → extract 10 frames (ffmpeg) → upload all frames to R2
      → submit R2 URLs to NeuroScore Score API
      → poll until scored
      → select frame with highest score (is_selected=True, score stored in DB)
      → resize best frame to SM (480×270) and LG (810×1440)
      → upload thumbnails to R2
      → save thumbnail_url / thumbnail_lg_url on the video
```

### Frame extraction

10 frames are extracted from the video at evenly-spaced timestamps using ffmpeg:
- Timestamps: `[duration * i / (count+1) for i in range(1, count+1)]`
- Each frame saved as JPEG (quality=85) to a temporary path
- Uploaded to R2 at `frames/{platform}/{platform_id}_f{index}.jpg`

For image posts (Instagram photos/carousels, Twitter image tweets), the images themselves are used directly as frames without ffmpeg.

### NeuroScore API flow

`parser/services/neuroscore.py` — `NeuroScoreClient`:

1. `submit(urls: list[str]) -> job_id` — POST to Score API with list of public image URLs
2. `poll(job_id) -> dict | None` — GET job status; returns results dict when done, None if still running
3. `score_urls(urls) -> dict[url, float]` — full pipeline: submit + poll loop → returns `{url: score}` mapping

The polling loop retries up to `NEUROSCORE_MAX_POLL_RETRIES` times with `NEUROSCORE_POLL_INTERVAL_SEC` sleep between attempts.

### Thumbnail generation from best frame

After scoring, the best frame (highest score) is:
- Marked `is_selected=True` in `video_frames` DB record
- Its score stored in the `score` column
- Passed to `resize_thumbnails(src_path)` which creates:
  - SM thumbnail: 480×270 (standard landscape)
  - LG thumbnail: 810×1440 (portrait, used for banner source)
- Both uploaded to R2 under `thumbnails/` and `thumbnails_lg/`
- URLs saved as `videos.thumbnail_url` and `videos.thumbnail_lg_url`

### Fallback chain

If NeuroScore API is unavailable or scoring fails:

1. **Best NeuroScore frame** (primary) — the frame with the highest score
2. **First extracted frame** — if scoring failed but frames were extracted
3. **Platform thumbnail** — the thumbnail URL from the original platform (Twitter/Instagram)
4. **NULL** — if no thumbnail source is available at all

The fallback is implemented in `_upload_and_save()` in `parser/tasks/parse_worker.py`.

---

## Database changes

### Migration 016 (`scripts/migrations/016_neuroscore_frames.sql`)

```sql
ALTER TABLE video_frames ADD COLUMN score REAL NULL;
ALTER TABLE video_frames ADD COLUMN is_selected BOOLEAN NOT NULL DEFAULT false;
```

Apply with:
```bash
cat scripts/migrations/016_neuroscore_frames.sql | docker exec -i traforama-postgres psql -U xcj -d xcj
```

---

## Config settings

| Setting | Default | Description |
|---------|---------|-------------|
| `NEUROSCORE_API_KEY` | — | **Required.** NeuroScore Score API key |
| `NEUROSCORE_API_URL` | `https://api.neuroscore.io` | NeuroScore API base URL |
| `NEUROSCORE_POLL_INTERVAL_SEC` | `2.0` | Seconds between poll attempts |
| `NEUROSCORE_MAX_POLL_RETRIES` | `30` | Max poll attempts before fallback (60 sec total at default interval) |
| `FRAME_EXTRACTION_COUNT` | `10` | Frames extracted per video (was 4 before this feature) |

Add to `.env`:
```
NEUROSCORE_API_KEY=your_key_here
```

---

## Files changed

| File | Change |
|------|--------|
| `scripts/migrations/016_neuroscore_frames.sql` | New migration: `score` and `is_selected` columns on `video_frames` |
| `parser/services/neuroscore.py` | New: NeuroScore Score API client (`NeuroScoreClient`) |
| `parser/config/settings.py` | Added `neuroscore_api_key`, `neuroscore_api_url`, `neuroscore_poll_interval_sec`, `neuroscore_max_poll_retries`; changed `frame_extraction_count` 4 → 10 |
| `parser/storage/db.py` | Extended `insert_video_frame()` with optional `score` and `is_selected` params; added `update_video_thumbnails()` |
| `parser/utils/image.py` | Extracted shared `resize_thumbnails(src_path) → (sm_path, lg_path)` function from instagram.py/twitter.py |
| `parser/tasks/parse_worker.py` | Restructured `_upload_and_save()`: upload frames → score via NeuroScore → use best frame as thumbnail with full fallback chain |
| `parser/tests/test_neuroscore.py` | New: 15 unit tests for NeuroScore service; all 65 total parser tests pass |

---

## Tests

```bash
cd /path/to/xcj
python3 -m pytest parser/tests/test_neuroscore.py -v    # 15 NeuroScore tests
python3 -m pytest parser/tests/ -v                      # all 65 parser tests
```
