ALTER TABLE postcards ADD COLUMN location_endonym TEXT;
ALTER TABLE postcards ADD COLUMN location_zh_tw TEXT;
ALTER TABLE postcards ADD COLUMN location_language TEXT;
ALTER TABLE postcards ADD COLUMN location_name_status TEXT
CHECK (location_name_status IS NULL OR location_name_status IN ('researched', 'provisional'));
ALTER TABLE postcards ADD COLUMN location_name_confidence TEXT
CHECK (location_name_confidence IS NULL OR location_name_confidence IN ('high', 'medium', 'low'));

CREATE INDEX idx_postcards_location_endonym
ON postcards(location_endonym);

CREATE INDEX idx_postcards_location_zh_tw
ON postcards(location_zh_tw)
WHERE location_zh_tw IS NOT NULL;
