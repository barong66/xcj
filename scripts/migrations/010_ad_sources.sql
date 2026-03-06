-- PostgreSQL migration: ad sources and conversion postbacks
-- Supports S2S postback to ad networks with {click_id}, {event} template placeholders

CREATE TABLE ad_sources (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(64) NOT NULL UNIQUE,
    postback_url TEXT NOT NULL DEFAULT '',
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE conversion_postbacks (
    id            BIGSERIAL PRIMARY KEY,
    ad_source_id  INT NOT NULL REFERENCES ad_sources(id),
    click_id      VARCHAR(255) NOT NULL,
    event_type    VARCHAR(64) NOT NULL,
    account_id    INT,
    video_id      BIGINT,
    status        VARCHAR(16) NOT NULL DEFAULT 'pending',
    response_code INT,
    response_body TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at       TIMESTAMPTZ
);

CREATE INDEX idx_conversion_postbacks_status ON conversion_postbacks(status, created_at);
CREATE INDEX idx_conversion_postbacks_click_id ON conversion_postbacks(click_id);
