ALTER TABLE ai_jobs
ADD COLUMN phase TEXT NOT NULL DEFAULT 'research'
CHECK (phase IN ('metadata', 'research'));

UPDATE ai_jobs SET phase = 'metadata' WHERE workflow = 'metadata_only';
