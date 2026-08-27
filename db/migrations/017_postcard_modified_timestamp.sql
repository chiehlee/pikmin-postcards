ALTER TABLE postcards ADD COLUMN modified_at TEXT;

UPDATE postcards
SET modified_at = COALESCE(
  archived_at,
  CASE
    WHEN archived_on IS NOT NULL THEN archived_on || 'T00:00:00Z'
    ELSE NULL
  END
);

UPDATE postcards
SET document_json = json_set(document_json, '$.modified_at', modified_at)
WHERE modified_at IS NOT NULL;
