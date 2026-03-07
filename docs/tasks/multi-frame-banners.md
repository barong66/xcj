# Multi-Frame Banner Extraction + Image Post Support

> Date: 2026-03-07
> Status: Done
> ClickUp: https://app.clickup.com/t/869ccyfmj

## Goal

Extract multiple frames from videos during parsing and support image posts (Instagram photos, carousels, Twitter image tweets) to generate more diverse banner variants per model. CTR-based selection then naturally picks the best-performing variant.

## Problem

Previously, each video had exactly one banner per size, generated from the thumbnail. This limited the visual variety of banners and missed opportunities to use the best-looking frame from a video. Additionally, Instagram photo posts and carousels were completely ignored by the parser.

## Solution

### Multi-frame extraction from videos
- During parsing, 4 frames are extracted at evenly-spaced timestamps from each video using ffmpeg
- Frames stored in new `video_frames` table with R2 URLs
- Banner worker generates banners from both thumbnail AND extracted frames (up to 5 variants per video per size)

### Image post support
- Instagram photo posts now parsed (not just videos) with `media_type = 'image'`
- Instagram carousel images stored as additional frames in `video_frames` (each carousel image = one frame)
- Twitter image tweets now parsed for banners
- New `media_type` column on `videos` table distinguishes video vs image content

### Banner generation refactored
- Banner worker iterates over thumbnail + all frames for each video
- Each source image goes through the same pipeline: OpenCV smart crop -> Lanczos resize -> ImageEnhance -> overlay -> JPEG
- Thumbnail-based banners: `video_frame_id = NULL`, unique per (video_id, banner_size_id)
- Frame-based banners: `video_frame_id = frame.id`, unique per (video_id, banner_size_id, video_frame_id)
- No changes needed to serving logic -- existing CTR-based selection handles multiple variants naturally

## Database Migration 011

File: `scripts/migrations/011_video_frames.sql`

```sql
-- Add media_type to videos (video vs image posts)
ALTER TABLE videos ADD COLUMN media_type VARCHAR(8) NOT NULL DEFAULT 'video';

-- Frames extracted from videos (or carousel images)
CREATE TABLE video_frames (
    id           BIGSERIAL PRIMARY KEY,
    video_id     BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    frame_index  SMALLINT NOT NULL,
    timestamp_ms INT NOT NULL DEFAULT 0,
    image_url    TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(video_id, frame_index)
);
CREATE INDEX idx_video_frames_video ON video_frames(video_id);

-- Allow multiple banners per video (one per frame + one from thumbnail)
ALTER TABLE banners DROP CONSTRAINT banners_video_id_banner_size_id_key;
ALTER TABLE banners ADD COLUMN video_frame_id BIGINT REFERENCES video_frames(id) ON DELETE SET NULL;

-- Thumbnail-based banners: one per video per size (video_frame_id IS NULL)
CREATE UNIQUE INDEX uq_banners_thumb_size
    ON banners(video_id, banner_size_id) WHERE video_frame_id IS NULL;

-- Frame-based banners: one per video per frame per size
CREATE UNIQUE INDEX uq_banners_frame_size
    ON banners(video_id, banner_size_id, video_frame_id) WHERE video_frame_id IS NOT NULL;
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `frame_extraction_count` | 4 | Number of frames to extract per video |
| `frame_extraction_quality` | 85 | JPEG quality for extracted frames |

## Files Changed

### New files
- `scripts/migrations/011_video_frames.sql` -- database migration

### Parser (Python)
- `parser/parsers/base.py` -- added `media_type` and `frame_paths` fields to `ParsedVideo`
- `parser/utils/image.py` -- added `extract_frames()` function (ffmpeg-based)
- `parser/storage/s3.py` -- added `upload_frame()`, updated `upload_banner()` for frame banners
- `parser/storage/db.py` -- added `insert_video_frame()`, `get_video_frames()`, updated `insert_video()` and `insert_banner()`
- `parser/config/settings.py` -- added `frame_extraction_count`, `frame_extraction_quality`
- `parser/parsers/instagram.py` -- image post support, carousel support, frame extraction on video parse
- `parser/parsers/twitter.py` -- image tweet support, frame extraction on video parse
- `parser/tasks/parse_worker.py` -- frame upload to S3, media_type handling, cleanup
- `parser/tasks/banner_worker.py` -- refactored to generate from frames + thumbnail

### API (Go)
- `api/internal/store/admin_store.go` -- `VideoFrameID` field in banner model, updated `InsertBanner` for new unique constraint

## How It Works

### Parsing flow
```
Parser finds video/post
-> Determines media_type (video/image)
-> Downloads thumbnail, generates preview (video only)
-> Frame extraction:
   - Video: ffmpeg extracts 4 frames at evenly-spaced timestamps
   - Instagram photo: image saved as frame_index=0
   - Instagram carousel: each image saved as frame_index=0,1,2...
   - Twitter image: image saved as frame_index=0
-> Uploads frames to S3: frames/{platform}/{platform_id}_f{index}.jpg
-> INSERT into videos + video_frames + site_videos
```

### Banner generation flow
```
Banner Worker picks task from banner_queue
-> For each video:
   1. Generate banner from thumbnail (video_frame_id=NULL)
   2. Fetch frames from video_frames
   3. Generate banner from each frame (video_frame_id=frame.id)
   -> Each banner: smart crop -> resize -> enhance -> overlay -> JPEG -> R2
-> Result: up to 5 banner variants per video per size
```

### Banner selection (unchanged)
```
/b/serve request
-> Load banner pool from Redis/DB
-> CTR-based selection picks banner with highest CTR
-> Equal CTR -> random fallback
-> Multiple variants per video = more data -> better selection over time
```
