# Pikmin Postcards — Source Session Bundle

This ZIP is a **single source-session export** intended to be merged later into a master `pikmin-postcards` repository.

## Scope

- Source: **this ChatGPT conversation only**
- Generated: 2026-08-23
- Original screenshot upload occurrences exported: **131**
  - Postcard/detail screenshots: **130**
  - Postcard-list/context screenshots: **1**
- The `screenshots/` files are byte-for-byte copies of the original mounted attachments. They were **renamed only**, not edited or recompressed.
- SHA-256 hashes are recorded in both manifests.
- Byte-identical screenshots that were pasted again later in the chat are **still kept as separate files**, because the request was to preserve every original screenshot occurrence. `byte_identical_occurrence_group` links them.
- Derived crops (`shrine_crop.png`, `crop.png`) were excluded because a full original screenshot was available.
- Analysis-only contact sheets generated while making this export are **not** included.
- No files/research from the other postcard chat's existing bundle were merged into this one.

## Files

- `screenshots/` — original full Pikmin Bloom screenshots with stable readable names.
- `postcards_manifest.json` — rich structured manifest. This is the preferred machine-readable source.
- `postcards_manifest.csv` — flattened UTF-8 CSV for quick inspection / import.
- `SESSION_RESEARCH.md` — per-postcard research preservation.
- `SESSION_NOTES.md` — curation rules and archive conventions that emerged in this chat.
- `README.md` — this file.

## Important field semantics

- `found_date` = Pikmin Bloom `見つけた日`. **Do not interpret it as a send date.**
- `sender` is copied only when visible / confirmed. `null` means unknown; do not infer.
- `poi_name` preserves the Niantic / Wayspot text even when research suggests the name is wrong, informal, translated badly, obsolete, or humorous.
- `research_status` distinguishes detailed research recovered from this session from entries whose older assistant research turn was not recoverable from the compacted transcript.
- `confirmed_facts`, `inferences`, and `unresolved_questions` are deliberately separate.
- `source_urls` contains URLs that were referenced in the conversation when they were recoverable.
- `byte_identical_occurrence_group` identifies repeated uploads with identical bytes; both copies remain in `screenshots/`.
- `star_visible_in_screenshot` is only UI evidence; it is not automatically the same as the assistant's recommendation.

## Research preservation limitation

The conversation is long enough that some older assistant turns were compacted out of the transcript context available during export. For those postcards, this bundle preserves the original screenshot and visible metadata but marks the old research as `prior_research_not_recovered_from_compacted_context`.

This is intentional: the export does **not** fabricate a replacement history and does not silently re-research those entries. A future merge process can enrich those rows if the original source-session transcript or another explicit export of the same session becomes available.

## Merge guidance

1. Preserve source-session provenance for every imported row.
2. Use screenshot SHA-256 to detect byte-identical duplicates, but do not discard an occurrence unless the master repo explicitly chooses to collapse repeated uploads.
3. Do not collapse distinct screenshots of the same POI if they show different UI/location/sender evidence.
4. Merge research by evidence provenance, not by overwriting the original Wayspot name.
5. Keep conflicting interpretations side by side until resolved.
