ALTER TABLE postcards ADD COLUMN deleted_at TEXT;
ALTER TABLE postcards ADD COLUMN deleted_reason TEXT;

CREATE INDEX idx_postcards_active_sort
ON postcards(sort_order)
WHERE deleted_at IS NULL;

CREATE TABLE ai_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('add', 'reresearch')),
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'in_progress', 'applying', 'completed', 'failed')
  ),
  postcard_id TEXT,
  intake_sha256 TEXT,
  openai_response_id TEXT UNIQUE,
  model TEXT NOT NULL,
  skill_path TEXT NOT NULL,
  skill_sha256 TEXT NOT NULL,
  prompt TEXT NOT NULL,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE INDEX idx_ai_jobs_status_updated
ON ai_jobs(status, updated_at DESC);

CREATE INDEX idx_ai_jobs_postcard_created
ON ai_jobs(postcard_id, created_at DESC);
