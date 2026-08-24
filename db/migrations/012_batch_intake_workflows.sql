ALTER TABLE ai_jobs
ADD COLUMN workflow TEXT NOT NULL DEFAULT 'full_research'
CHECK (workflow IN ('metadata_only', 'full_research'));

ALTER TABLE ai_jobs
ADD COLUMN batch_id TEXT;

ALTER TABLE ai_jobs
ADD COLUMN input_label TEXT;

CREATE INDEX idx_ai_jobs_batch_created
ON ai_jobs(batch_id, created_at);
