-- 016: Add NeuroScore quality scoring columns to video_frames
-- Enables AI-based thumbnail selection: score frames, pick the best one.

ALTER TABLE video_frames ADD COLUMN score REAL;
ALTER TABLE video_frames ADD COLUMN is_selected BOOLEAN NOT NULL DEFAULT false;

-- Fast lookup for the selected frame per video
CREATE INDEX idx_video_frames_selected ON video_frames(video_id) WHERE is_selected = true;
