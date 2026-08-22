ALTER TABLE postcard_relations ADD COLUMN note TEXT
CHECK (note IS NULL OR length(trim(note)) BETWEEN 1 AND 240);

CREATE INDEX idx_postcards_poi_name
ON postcards(poi_name);

CREATE INDEX idx_postcards_location_raw
ON postcards(location_raw);

CREATE INDEX idx_postcards_location_display
ON postcards(location_display);

CREATE INDEX idx_postcard_tags_tag_postcard
ON postcard_tags(tag, postcard_id);

CREATE INDEX idx_research_sources_url_postcard
ON research_sources(url, postcard_id);

CREATE INDEX idx_postcards_coordinates
ON postcards(latitude, longitude)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
