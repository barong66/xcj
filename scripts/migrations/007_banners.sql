-- Banner sizes (global, not per-account)
CREATE TABLE banner_sizes (
    id          SERIAL PRIMARY KEY,
    width       INT NOT NULL,
    height      INT NOT NULL,
    label       VARCHAR(64) NOT NULL DEFAULT '',
    type        VARCHAR(16) NOT NULL DEFAULT 'image',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(width, height)
);

INSERT INTO banner_sizes (width, height, label, type) VALUES
    (300, 250, 'Medium Rectangle', 'image');

-- Banners (generated images)
CREATE TABLE banners (
    id              BIGSERIAL PRIMARY KEY,
    account_id      INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    video_id        BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    banner_size_id  INT NOT NULL REFERENCES banner_sizes(id) ON DELETE CASCADE,
    image_url       TEXT NOT NULL,
    width           INT NOT NULL,
    height          INT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(video_id, banner_size_id)
);
CREATE INDEX idx_banners_account ON banners(account_id);

-- Banner generation queue
CREATE TABLE banner_queue (
    id          BIGSERIAL PRIMARY KEY,
    account_id  INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    video_id    BIGINT REFERENCES videos(id) ON DELETE CASCADE,
    status      VARCHAR(16) NOT NULL DEFAULT 'pending',
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);
CREATE INDEX idx_banner_queue_status ON banner_queue(status, created_at);
