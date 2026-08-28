ALTER TABLE friends ADD COLUMN modified_at TEXT;
ALTER TABLE friends ADD COLUMN deleted_at TEXT;
ALTER TABLE friends ADD COLUMN deleted_reason TEXT;
ALTER TABLE friends ADD COLUMN merged_into TEXT;

UPDATE friends
SET modified_at = COALESCE(
  (
    SELECT MAX(postcards.modified_at)
    FROM friend_evidence
    JOIN postcards ON postcards.id = friend_evidence.postcard_id
    WHERE friend_evidence.friend_name = friends.name
  ),
  updated_at
);

UPDATE friends
SET document_json = json_set(document_json, '$.modified_at', modified_at)
WHERE modified_at IS NOT NULL;
