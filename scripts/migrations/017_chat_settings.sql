-- 017: Add AI chat widget settings to accounts
-- Enables per-model AI companion chat powered by Grok.

ALTER TABLE accounts ADD COLUMN chat_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN chat_prompt TEXT;
ALTER TABLE accounts ADD COLUMN chat_ad_text TEXT;
