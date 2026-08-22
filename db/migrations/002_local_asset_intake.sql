ALTER TABLE assets ADD COLUMN local_path TEXT;

UPDATE assets
SET local_path = 'public' || path;

CREATE UNIQUE INDEX idx_assets_local_path
ON assets(local_path)
WHERE local_path IS NOT NULL;

CREATE TRIGGER trg_assets_require_local_path_insert
BEFORE INSERT ON assets
WHEN NEW.local_path IS NULL OR trim(NEW.local_path) = ''
BEGIN
  SELECT RAISE(ABORT, 'assets.local_path is required');
END;

CREATE TRIGGER trg_assets_require_local_path_update
BEFORE UPDATE OF local_path ON assets
WHEN NEW.local_path IS NULL OR trim(NEW.local_path) = ''
BEGIN
  SELECT RAISE(ABORT, 'assets.local_path is required');
END;

CREATE TABLE image_intake (
  sha256 TEXT PRIMARY KEY,
  local_path TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  media_type TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'canonicalized')),
  asset_sha256 TEXT REFERENCES assets(sha256) ON DELETE SET NULL ON UPDATE CASCADE,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE image_intake_sources (
  id INTEGER PRIMARY KEY,
  intake_sha256 TEXT NOT NULL REFERENCES image_intake(sha256) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('local', 'remote')),
  source_locator TEXT NOT NULL,
  source_locator_sha256 TEXT NOT NULL,
  original_filename TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (intake_sha256, source_locator_sha256)
) STRICT;

CREATE INDEX idx_image_intake_status_last_seen
ON image_intake(status, last_seen_at DESC);

CREATE INDEX idx_image_intake_sources_sha256
ON image_intake_sources(intake_sha256);
