CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  link_key TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  section TEXT NOT NULL,
  description TEXT NOT NULL,
  tags TEXT NOT NULL,
  ip_key TEXT NOT NULL,
  created INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'submitted',
  test INTEGER NOT NULL DEFAULT 0,
  approval_id TEXT UNIQUE,
  opinion TEXT,
  public_reason TEXT,
  edited TEXT,
  decided INTEGER,
  published INTEGER,
  updated INTEGER NOT NULL,
  next_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  leased_until INTEGER,
  publish_dispatch_at INTEGER,
  last_error TEXT
);

CREATE INDEX submission_created ON submissions(created);
CREATE INDEX submission_ip ON submissions(ip_key, created);
CREATE INDEX submission_work ON submissions(state, next_at);
CREATE INDEX submission_results ON submissions(test, state, decided DESC);

-- D1 serializes this trigger and its insert as one write. Windows roll from
-- the latest arrival, including every new submission.
CREATE TRIGGER admission BEFORE INSERT ON submissions BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM submissions WHERE created > NEW.created - 300000 LIMIT 1 OFFSET 4
  ) OR EXISTS (
    SELECT 1 FROM submissions WHERE created > NEW.created - 86400000 LIMIT 1 OFFSET 29
  ) THEN RAISE(ABORT, 'admission_limit') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM submissions
      WHERE ip_key = NEW.ip_key AND created > NEW.created - 3600000 LIMIT 1 OFFSET 4
  ) THEN RAISE(ABORT, 'recipient_limit') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM submissions
      WHERE state IN ('submitted', 'review', 'edit', 'publish', 'deploy')
      LIMIT 1 OFFSET 99
  ) THEN RAISE(ABORT, 'backlog_limit') END;
END;
