ALTER TABLE ai_jobs
ADD COLUMN provider TEXT NOT NULL DEFAULT 'openai_api'
CHECK (provider IN ('openai_api', 'local_codex'));

CREATE INDEX idx_ai_jobs_provider_created
ON ai_jobs(provider, created_at DESC);
