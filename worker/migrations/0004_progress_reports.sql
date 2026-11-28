ALTER TABLE submissions ADD COLUMN progress_reported_at INTEGER;
ALTER TABLE submissions ADD COLUMN progress_done INTEGER NOT NULL DEFAULT 0;
UPDATE submissions SET progress_done = 1 WHERE state IN ('published', 'rejected', 'test_edited');
