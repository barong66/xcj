-- Migration 013: Per-account conversion prices (CPA)
-- Stores CPA price per model per conversion event type for postback {cpa} placeholder.

CREATE TABLE account_conversion_prices (
    id         SERIAL PRIMARY KEY,
    account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL,
    price      NUMERIC(10,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, event_type)
);

CREATE INDEX idx_acp_account_id ON account_conversion_prices(account_id);

-- Store CPA amount on postback records for auditing and retry consistency.
ALTER TABLE conversion_postbacks ADD COLUMN cpa_amount NUMERIC(10,4);
