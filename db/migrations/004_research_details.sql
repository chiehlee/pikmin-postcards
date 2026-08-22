CREATE TABLE research_details (
  postcard_id TEXT PRIMARY KEY REFERENCES postcards(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('raw_preserved', 'structured_preserved', 'not_recovered')),
  body TEXT,
  source_path TEXT NOT NULL,
  preservation_note TEXT,
  document_json TEXT NOT NULL CHECK (json_valid(document_json)),
  CHECK (
    (status = 'not_recovered' AND body IS NULL AND preservation_note IS NOT NULL)
    OR
    (status <> 'not_recovered' AND body IS NOT NULL AND preservation_note IS NULL)
  )
) STRICT;
