ALTER TABLE postcards ADD COLUMN location_country_endonym TEXT;
ALTER TABLE postcards ADD COLUMN location_address_local TEXT;
ALTER TABLE postcards ADD COLUMN location_precision TEXT
CHECK (
  location_precision IS NULL
  OR location_precision IN (
    'country', 'region', 'city', 'district', 'locality', 'road', 'full_address', 'coordinates', 'unknown'
  )
);

CREATE INDEX idx_postcards_location_address_local
ON postcards(location_address_local);
