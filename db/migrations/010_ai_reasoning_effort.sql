ALTER TABLE ai_jobs
ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'high'
CHECK (reasoning_effort IN ('minimal', 'low', 'medium', 'high', 'xhigh'));

CREATE INDEX idx_ai_jobs_reasoning_created
ON ai_jobs(reasoning_effort, created_at DESC);
