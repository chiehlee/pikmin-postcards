CREATE TEMP TABLE merged_sender_resolution (
  alias TEXT PRIMARY KEY,
  canonical TEXT NOT NULL
) WITHOUT ROWID;

WITH RECURSIVE merge_chain(alias, current, path) AS (
  SELECT
    name,
    merged_into,
    '|' || name || '|' || merged_into || '|'
  FROM friends
  WHERE merged_into IS NOT NULL

  UNION ALL

  SELECT
    merge_chain.alias,
    friends.merged_into,
    merge_chain.path || friends.merged_into || '|'
  FROM merge_chain
  JOIN friends ON friends.name = merge_chain.current
  WHERE friends.merged_into IS NOT NULL
    AND instr(merge_chain.path, '|' || friends.merged_into || '|') = 0
)
INSERT INTO merged_sender_resolution(alias, canonical)
SELECT merge_chain.alias, merge_chain.current
FROM merge_chain
LEFT JOIN friends AS next_friend ON next_friend.name = merge_chain.current
WHERE next_friend.name IS NOT NULL
  AND next_friend.deleted_at IS NULL
  AND next_friend.merged_into IS NULL;

UPDATE postcards
SET
  document_json = json_set(
    document_json,
    '$.sender',
    (SELECT canonical FROM merged_sender_resolution WHERE alias = postcards.sender),
    '$.sender_history',
    json_insert(
      json(COALESCE(json_extract(document_json, '$.sender_history'), '[]')),
      '$[#]',
      json_object(
        'previous_name', sender,
        'next_name', (SELECT canonical FROM merged_sender_resolution WHERE alias = postcards.sender),
        'reason', 'merged-alias-normalization',
        'changed_at', COALESCE(
          modified_at,
          archived_at,
          CASE WHEN archived_on IS NOT NULL THEN archived_on || 'T00:00:00Z' END,
          CURRENT_TIMESTAMP
        )
      )
    )
  ),
  sender = (SELECT canonical FROM merged_sender_resolution WHERE alias = postcards.sender)
WHERE sender IN (SELECT alias FROM merged_sender_resolution);

INSERT OR IGNORE INTO friend_evidence(friend_name, postcard_id)
SELECT postcards.sender, postcards.id
FROM postcards
JOIN friends ON friends.name = postcards.sender
WHERE friends.deleted_at IS NULL;

UPDATE friends
SET
  evidence_count = (
    SELECT COUNT(*) FROM friend_evidence WHERE friend_name = friends.name
  ),
  document_json = json_set(
    document_json,
    '$.evidence_postcard_ids',
    json((
      SELECT json_group_array(postcard_id)
      FROM (
        SELECT postcard_id
        FROM friend_evidence
        WHERE friend_name = friends.name
        ORDER BY postcard_id
      )
    )),
    '$.base_analysis.evidence_count',
    (SELECT COUNT(*) FROM friend_evidence WHERE friend_name = friends.name)
  )
WHERE deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM friend_evidence WHERE friend_name = friends.name);

DROP TABLE merged_sender_resolution;
