ALTER TABLE postcards ADD COLUMN location_geocode_status TEXT
CHECK (location_geocode_status IS NULL OR location_geocode_status IN ('resolved', 'unresolved'));

ALTER TABLE postcards ADD COLUMN location_geocode_provider TEXT
CHECK (location_geocode_provider IS NULL OR location_geocode_provider IN (
  'nominatim', 'research_source', 'manual', 'visible_coordinates', 'legacy'
));

ALTER TABLE postcards ADD COLUMN location_geocode_query TEXT;
ALTER TABLE postcards ADD COLUMN location_geocode_precision TEXT;
ALTER TABLE postcards ADD COLUMN location_geocode_confidence TEXT
CHECK (location_geocode_confidence IS NULL OR location_geocode_confidence IN ('high', 'medium', 'low'));
ALTER TABLE postcards ADD COLUMN location_geocode_resolved_at TEXT;
ALTER TABLE postcards ADD COLUMN location_geocode_attribution TEXT;
ALTER TABLE postcards ADD COLUMN location_geocode_document_json TEXT
CHECK (location_geocode_document_json IS NULL OR json_valid(location_geocode_document_json));

CREATE INDEX idx_postcards_location_geocode_status
ON postcards(location_geocode_status, location_geocode_resolved_at);

PRAGMA optimize;
