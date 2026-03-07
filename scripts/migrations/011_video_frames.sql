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
