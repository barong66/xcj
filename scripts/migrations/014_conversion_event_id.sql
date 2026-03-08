-- Migration 014: Add event_id to conversion prices and postbacks.
-- Supports ad networks with numbered conversion types (1-9).

ALTER TABLE account_conversion_prices ADD COLUMN event_id INT NOT NULL DEFAULT 1;
ALTER TABLE conversion_postbacks ADD COLUMN event_id INT;
