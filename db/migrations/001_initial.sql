CREATE TABLE assets (
  sha256 TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  media_type TEXT NOT NULL,
  original_filename TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE postcards (
  id TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL UNIQUE,
  record_type TEXT NOT NULL DEFAULT 'postcard' CHECK (record_type = 'postcard'),
  poi_name TEXT NOT NULL,
  found_date TEXT,
  received_at TEXT,
  archived_on TEXT NOT NULL,
  sender TEXT,
  location_raw TEXT NOT NULL,
  location_display TEXT NOT NULL,
  location_city TEXT,
  location_district TEXT,
  location_locality TEXT,
  location_region TEXT,
  location_county TEXT,
  location_country TEXT,
  location_country_code TEXT,
  latitude REAL,
  longitude REAL,
  location_confidence TEXT,
  asset_sha256 TEXT NOT NULL UNIQUE REFERENCES assets(sha256) ON UPDATE CASCADE,
  rating REAL CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  rating_raw TEXT,
  rating_min REAL,
  rating_max REAL,
  recommendation TEXT,
  curation_status TEXT NOT NULL CHECK (curation_status IN ('keep', 'representative', 'candidate', 'delete', 'unreviewed')),
  personal_relevance TEXT,
  star_visible INTEGER CHECK (star_visible IS NULL OR star_visible IN (0, 1)),
  deletion_toast_visible INTEGER CHECK (deletion_toast_visible IS NULL OR deletion_toast_visible IN (0, 1)),
  research_status TEXT NOT NULL,
  research_confidence TEXT NOT NULL,
  research_confidence_label TEXT NOT NULL,
  research_summary TEXT NOT NULL,
  document_json TEXT NOT NULL CHECK (json_valid(document_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE postcard_tags (
  postcard_id TEXT NOT NULL REFERENCES postcards(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (postcard_id, tag)
) WITHOUT ROWID;

CREATE TABLE research_notes (
  postcard_id TEXT NOT NULL REFERENCES postcards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('confirmed_fact', 'inference', 'unresolved_question')),
  sort_order INTEGER NOT NULL,
  note TEXT NOT NULL,
  PRIMARY KEY (postcard_id, kind, sort_order)
) WITHOUT ROWID;

CREATE TABLE research_sources (
  postcard_id TEXT NOT NULL REFERENCES postcards(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (postcard_id, sort_order)
) WITHOUT ROWID;

CREATE TABLE postcard_provenance (
  id INTEGER PRIMARY KEY,
  postcard_id TEXT NOT NULL REFERENCES postcards(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  source_session TEXT NOT NULL,
  source_sequence INTEGER,
  source_bundle TEXT,
  source_bundle_sha256 TEXT,
  source_screenshot TEXT,
  original_filename TEXT,
  byte_identical_occurrence_group_json TEXT CHECK (byte_identical_occurrence_group_json IS NULL OR json_valid(byte_identical_occurrence_group_json)),
  screenshot_notes TEXT,
  research_status TEXT,
  UNIQUE (postcard_id, sort_order)
) STRICT;

CREATE TABLE postcard_relations (
  postcard_id TEXT NOT NULL REFERENCES postcards(id) ON DELETE CASCADE,
  related_postcard_id TEXT NOT NULL REFERENCES postcards(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,
  PRIMARY KEY (postcard_id, related_postcard_id, relationship),
  CHECK (postcard_id <> related_postcard_id)
) WITHOUT ROWID;

CREATE TABLE friends (
  name TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL UNIQUE,
  evidence_count INTEGER NOT NULL CHECK (evidence_count >= 1),
  likely_base_area TEXT,
  likely_base_status TEXT NOT NULL,
  likely_base_confidence TEXT NOT NULL,
  likely_base_confidence_label TEXT NOT NULL,
  likely_base_reason TEXT NOT NULL,
  avoid_send_reason TEXT NOT NULL,
  document_json TEXT NOT NULL CHECK (json_valid(document_json)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE friend_evidence (
  friend_name TEXT NOT NULL REFERENCES friends(name) ON DELETE CASCADE ON UPDATE CASCADE,
  postcard_id TEXT NOT NULL REFERENCES postcards(id) ON DELETE CASCADE,
  PRIMARY KEY (friend_name, postcard_id)
) WITHOUT ROWID;

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL UNIQUE,
  source_session TEXT,
  archived_on TEXT,
  bundle_path TEXT NOT NULL,
  bundle_sha256 TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  document_json TEXT NOT NULL CHECK (json_valid(document_json))
) STRICT;

CREATE TABLE context_records (
  id TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  captured_on TEXT,
  notes TEXT,
  asset_sha256 TEXT NOT NULL UNIQUE REFERENCES assets(sha256) ON UPDATE CASCADE,
  document_json TEXT NOT NULL CHECK (json_valid(document_json))
) STRICT;

CREATE TABLE context_provenance (
  id INTEGER PRIMARY KEY,
  context_id TEXT NOT NULL REFERENCES context_records(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  source_session TEXT NOT NULL,
  source_sequence INTEGER,
  source_bundle TEXT,
  source_bundle_sha256 TEXT,
  source_screenshot TEXT,
  original_filename TEXT,
  screenshot_notes TEXT,
  UNIQUE (context_id, sort_order)
) STRICT;

CREATE TABLE snapshot_headers (
  name TEXT PRIMARY KEY CHECK (name IN ('postcards', 'friends', 'imports', 'context')),
  header_json TEXT NOT NULL CHECK (json_valid(header_json))
) STRICT;

CREATE INDEX idx_postcards_sender_found_date
ON postcards(sender, found_date DESC);

CREATE INDEX idx_postcards_found_date
ON postcards(found_date DESC);

CREATE INDEX idx_postcards_location_country
ON postcards(location_country);

CREATE INDEX idx_postcards_curation_status_rating
ON postcards(curation_status, rating DESC);

CREATE INDEX idx_postcards_research_status
ON postcards(research_status);

CREATE INDEX idx_postcard_provenance_session_sequence
ON postcard_provenance(source_session, source_sequence);

CREATE INDEX idx_postcard_relations_related
ON postcard_relations(related_postcard_id);

CREATE INDEX idx_friend_evidence_postcard
ON friend_evidence(postcard_id);
