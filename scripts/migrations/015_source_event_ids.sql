-- Migration 015: Move event_id to per-source configuration.
-- Different ad networks may number their conversions differently (1-9),
-- so event_id needs to be per (account, ad_source, event_type) instead of per (account, event_type).

CREATE TABLE account_source_event_ids (
    id           SERIAL PRIMARY KEY,
    account_id   INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    ad_source_id INT NOT NULL REFERENCES ad_sources(id) ON DELETE CASCADE,
    event_type   VARCHAR(64) NOT NULL,
    event_id     INT NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, ad_source_id, event_type)
);

CREATE INDEX idx_asei_account_source ON account_source_event_ids(account_id, ad_source_id);
