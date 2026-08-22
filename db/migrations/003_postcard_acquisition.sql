ALTER TABLE postcards ADD COLUMN acquisition_type TEXT NOT NULL DEFAULT 'unknown'
CHECK (acquisition_type IN ('self_found', 'received', 'unknown'));

ALTER TABLE postcards ADD COLUMN sender_status TEXT NOT NULL DEFAULT 'unknown'
CHECK (sender_status IN ('not_applicable', 'confirmed', 'unknown'));

ALTER TABLE postcards ADD COLUMN acquisition_confidence TEXT NOT NULL DEFAULT 'low'
CHECK (acquisition_confidence IN ('high', 'medium', 'low'));

ALTER TABLE postcards ADD COLUMN acquisition_evidence_json TEXT NOT NULL DEFAULT '["insufficient-ui-evidence"]'
CHECK (json_valid(acquisition_evidence_json));

UPDATE postcards
SET
  acquisition_type = 'received',
  sender_status = 'confirmed',
  acquisition_confidence = 'high',
  acquisition_evidence_json = '["sender-confirmed"]'
WHERE sender IS NOT NULL;

CREATE TRIGGER trg_postcards_validate_acquisition_insert
BEFORE INSERT ON postcards
WHEN
  (NEW.sender IS NOT NULL AND (NEW.acquisition_type <> 'received' OR NEW.sender_status <> 'confirmed'))
  OR (NEW.sender IS NULL AND NEW.sender_status = 'confirmed')
  OR (NEW.acquisition_type = 'self_found' AND NEW.sender_status <> 'not_applicable')
  OR (NEW.sender_status = 'not_applicable' AND NEW.acquisition_type <> 'self_found')
  OR (NEW.acquisition_type = 'unknown' AND NEW.sender_status <> 'unknown')
  OR json_array_length(NEW.acquisition_evidence_json) = 0
BEGIN
  SELECT RAISE(ABORT, 'inconsistent postcard acquisition data');
END;

CREATE TRIGGER trg_postcards_validate_acquisition_update
BEFORE UPDATE OF sender, acquisition_type, sender_status, acquisition_evidence_json ON postcards
WHEN
  (NEW.sender IS NOT NULL AND (NEW.acquisition_type <> 'received' OR NEW.sender_status <> 'confirmed'))
  OR (NEW.sender IS NULL AND NEW.sender_status = 'confirmed')
  OR (NEW.acquisition_type = 'self_found' AND NEW.sender_status <> 'not_applicable')
  OR (NEW.sender_status = 'not_applicable' AND NEW.acquisition_type <> 'self_found')
  OR (NEW.acquisition_type = 'unknown' AND NEW.sender_status <> 'unknown')
  OR json_array_length(NEW.acquisition_evidence_json) = 0
BEGIN
  SELECT RAISE(ABORT, 'inconsistent postcard acquisition data');
END;

CREATE INDEX idx_postcards_acquisition_type
ON postcards(acquisition_type);
