ALTER TABLE submissions ADD COLUMN review_channel TEXT NOT NULL DEFAULT 'native' CHECK (review_channel IN ('native', 'card'));
ALTER TABLE submissions ADD COLUMN card_key TEXT;
ALTER TABLE submissions ADD COLUMN card_issued_at INTEGER;
ALTER TABLE submissions ADD COLUMN card_message_id TEXT;
ALTER TABLE submissions ADD COLUMN card_view TEXT NOT NULL DEFAULT 'main';
ALTER TABLE submissions ADD COLUMN card_rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submissions ADD COLUMN card_decision TEXT;
ALTER TABLE submissions ADD COLUMN card_decider TEXT;
ALTER TABLE submissions ADD COLUMN card_event_id TEXT;
