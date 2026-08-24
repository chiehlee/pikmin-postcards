ALTER TABLE ai_jobs RENAME TO ai_jobs_before_cancellation;

CREATE TABLE ai_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('add', 'reresearch')),
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'in_progress', 'applying', 'completed', 'failed', 'cancelled')
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
  completed_at TEXT,
  provider TEXT NOT NULL DEFAULT 'openai_api'
    CHECK (provider IN ('openai_api', 'local_codex')),
  reasoning_effort TEXT NOT NULL DEFAULT 'high'
    CHECK (reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max')),
  workflow TEXT NOT NULL DEFAULT 'full_research'
    CHECK (workflow IN ('metadata_only', 'full_research')),
  batch_id TEXT,
  input_label TEXT,
  user_note TEXT
) STRICT;

INSERT INTO ai_jobs (
  id, kind, status, postcard_id, intake_sha256, openai_response_id, model,
  skill_path, skill_sha256, prompt, result_json, error, created_at, started_at,
  updated_at, completed_at, provider, reasoning_effort, workflow, batch_id,
  input_label, user_note
)
SELECT
  id, kind, status, postcard_id, intake_sha256, openai_response_id, model,
  skill_path, skill_sha256, prompt, result_json, error, created_at, started_at,
  updated_at, completed_at, provider, reasoning_effort, workflow, batch_id,
  input_label, user_note
FROM ai_jobs_before_cancellation;

DROP TABLE ai_jobs_before_cancellation;

CREATE INDEX idx_ai_jobs_status_updated
ON ai_jobs(status, updated_at DESC);

CREATE INDEX idx_ai_jobs_postcard_created
ON ai_jobs(postcard_id, created_at DESC);

CREATE INDEX idx_ai_jobs_provider_created
ON ai_jobs(provider, created_at DESC);

CREATE INDEX idx_ai_jobs_reasoning_created
ON ai_jobs(reasoning_effort, created_at DESC);

CREATE INDEX idx_ai_jobs_batch_created
ON ai_jobs(batch_id, created_at);

PRAGMA optimize;
