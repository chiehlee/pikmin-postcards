ALTER TABLE postcards ADD COLUMN read_at TEXT;

UPDATE postcards
SET read_at = COALESCE(
  modified_at,
  archived_at,
  CASE
    WHEN archived_on IS NOT NULL THEN archived_on || 'T00:00:00Z'
    ELSE NULL
  END,
  CURRENT_TIMESTAMP
);

UPDATE postcards
SET document_json = json_set(
  document_json,
  '$.reading',
  json_object(
    'is_read', json('true'),
    'read_at', read_at
  )
);
