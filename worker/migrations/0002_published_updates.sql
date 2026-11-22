DROP INDEX submission_results;
ALTER TABLE submissions DROP COLUMN public_reason;
CREATE INDEX published_updates ON submissions(test, state, published DESC, id DESC);
