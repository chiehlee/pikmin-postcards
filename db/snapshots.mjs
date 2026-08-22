import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateAcquisition } from "../lib/acquisition.mjs";
import { publicPathToLocalPath } from "./asset-paths.mjs";
import { projectRoot } from "./database.mjs";

const snapshotDefinitions = {
  postcards: { file: "postcards.json", collection: "postcards", table: "postcards" },
  friends: { file: "friends.json", collection: "profiles", table: "friends" },
  imports: { file: "imports.json", collection: "imports", table: "imports" },
  context: { file: "context.json", collection: "records", table: "context_records" },
};

export async function loadSnapshots(directory = path.join(projectRoot, "data")) {
  const snapshots = {};
  for (const [name, definition] of Object.entries(snapshotDefinitions)) {
    snapshots[name] = JSON.parse(
      await readFile(path.join(directory, definition.file), "utf8"),
    );
  }
  return snapshots;
}

export function replaceDatabaseFromSnapshots(database, snapshots) {
  validateSnapshots(snapshots);
  const deleteOrder = [
    "context_provenance",
    "context_records",
    "friend_evidence",
    "friends",
    "postcard_relations",
    "postcard_provenance",
    "research_sources",
    "research_notes",
    "postcard_tags",
    "postcards",
    "imports",
    "assets",
    "snapshot_headers",
  ];

  const insertAsset = database.prepare(`
    INSERT INTO assets (sha256, path, local_path, bytes, media_type, original_filename)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertPostcard = database.prepare(`
    INSERT INTO postcards (
      id, sort_order, record_type, poi_name, found_date, received_at, archived_on, sender,
      acquisition_type, sender_status, acquisition_confidence, acquisition_evidence_json,
      location_raw, location_display, location_city, location_district, location_locality,
      location_region, location_county, location_country, location_country_code, latitude,
      longitude, location_confidence, asset_sha256, rating, rating_raw, rating_min, rating_max,
      recommendation, curation_status, personal_relevance, star_visible,
      deletion_toast_visible, research_status, research_confidence,
      research_confidence_label, research_summary, document_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTag = database.prepare(
    "INSERT INTO postcard_tags (postcard_id, tag, sort_order) VALUES (?, ?, ?)",
  );
  const insertNote = database.prepare(
    "INSERT INTO research_notes (postcard_id, kind, sort_order, note) VALUES (?, ?, ?, ?)",
  );
  const insertSource = database.prepare(
    "INSERT INTO research_sources (postcard_id, sort_order, url) VALUES (?, ?, ?)",
  );
  const insertProvenance = database.prepare(`
    INSERT INTO postcard_provenance (
      postcard_id, sort_order, source_session, source_sequence, source_bundle,
      source_bundle_sha256, source_screenshot, original_filename,
      byte_identical_occurrence_group_json, screenshot_notes, research_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRelation = database.prepare(`
    INSERT INTO postcard_relations (postcard_id, related_postcard_id, relationship)
    VALUES (?, ?, ?)
  `);
  const insertFriend = database.prepare(`
    INSERT INTO friends (
      name, sort_order, evidence_count, likely_base_area, likely_base_status,
      likely_base_confidence, likely_base_confidence_label, likely_base_reason,
      avoid_send_reason, document_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFriendEvidence = database.prepare(
    "INSERT INTO friend_evidence (friend_name, postcard_id) VALUES (?, ?)",
  );
  const insertImport = database.prepare(`
    INSERT INTO imports (
      id, sort_order, source_session, archived_on, bundle_path, bundle_sha256, status, document_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertContext = database.prepare(`
    INSERT INTO context_records (
      id, sort_order, title, captured_on, notes, asset_sha256, document_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertContextProvenance = database.prepare(`
    INSERT INTO context_provenance (
      context_id, sort_order, source_session, source_sequence, source_bundle,
      source_bundle_sha256, source_screenshot, original_filename, screenshot_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertHeader = database.prepare(
    "INSERT INTO snapshot_headers (name, header_json) VALUES (?, ?)",
  );

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const table of deleteOrder) database.exec(`DELETE FROM ${table}`);

    const allAssetRecords = [
      ...snapshots.postcards.postcards,
      ...snapshots.context.records,
    ];
    for (const record of allAssetRecords) {
      insertAsset.run(
        record.asset.sha256,
        record.asset.path,
        publicPathToLocalPath(record.asset.path),
        record.asset.bytes,
        record.asset.media_type,
        record.asset.original_filename ?? null,
      );
    }

    snapshots.postcards.postcards.forEach((record, recordIndex) => {
      const acquisition = validateAcquisition(record);
      insertPostcard.run(
        record.id,
        recordIndex,
        record.record_type ?? "postcard",
        record.poi_name,
        record.found_date,
        record.received_at,
        record.archived_on,
        record.sender,
        acquisition.type,
        acquisition.sender_status,
        acquisition.confidence,
        JSON.stringify(acquisition.evidence),
        record.location.raw,
        record.location.display,
        record.location.city ?? null,
        record.location.district ?? null,
        record.location.locality ?? null,
        record.location.region ?? null,
        record.location.county ?? null,
        record.location.country ?? null,
        record.location.country_code ?? null,
        record.location.latitude ?? null,
        record.location.longitude ?? null,
        record.location.normalization_confidence ?? null,
        record.asset.sha256,
        record.curation.rating,
        record.curation.rating_raw ?? null,
        record.curation.rating_range?.[0] ?? null,
        record.curation.rating_range?.[1] ?? null,
        record.curation.recommendation,
        record.curation.status,
        record.curation.personal_relevance,
        nullableBoolean(record.curation.star_visible_in_screenshot),
        nullableBoolean(record.curation.deletion_toast_visible),
        record.research.status,
        record.research.confidence,
        record.research.confidence_label,
        record.research.summary,
        JSON.stringify(record),
      );

      (record.curation.tags ?? []).forEach((tag, index) =>
        insertTag.run(record.id, tag, index),
      );
      insertResearchNotes(insertNote, record.id, "confirmed_fact", record.research.confirmed_facts);
      insertResearchNotes(insertNote, record.id, "inference", record.research.inferences);
      insertResearchNotes(insertNote, record.id, "unresolved_question", record.research.unresolved_questions);
      (record.research.sources ?? []).forEach((url, index) =>
        insertSource.run(record.id, index, url),
      );
      (record.provenance ?? []).forEach((provenance, index) =>
        insertProvenance.run(
          record.id,
          index,
          provenance.source_session,
          provenance.source_sequence ?? null,
          provenance.source_bundle ?? null,
          provenance.source_bundle_sha256 ?? null,
          provenance.source_screenshot ?? null,
          provenance.original_filename ?? null,
          provenance.byte_identical_occurrence_group == null
            ? null
            : JSON.stringify(provenance.byte_identical_occurrence_group),
          provenance.screenshot_notes ?? null,
          provenance.research_status ?? null,
        ),
      );
    });

    for (const record of snapshots.postcards.postcards) {
      for (const relation of record.related_postcards ?? []) {
        insertRelation.run(record.id, relation.id, relation.relationship);
      }
    }

    snapshots.friends.profiles.forEach((profile, index) => {
      insertFriend.run(
        profile.name,
        index,
        profile.evidence_postcard_ids.length,
        profile.likely_base.area,
        profile.likely_base.status,
        profile.likely_base.confidence,
        profile.likely_base.confidence_label,
        profile.likely_base.reason,
        profile.avoid_send.reason,
        JSON.stringify(profile),
      );
      for (const postcardId of profile.evidence_postcard_ids) {
        insertFriendEvidence.run(profile.name, postcardId);
      }
    });

    snapshots.imports.imports.forEach((record, index) =>
      insertImport.run(
        record.id,
        index,
        record.source_session ?? null,
        record.archived_on ?? null,
        record.bundle,
        record.bundle_sha256,
        record.status,
        JSON.stringify(record),
      ),
    );

    snapshots.context.records.forEach((record, index) => {
      insertContext.run(
        record.id,
        index,
        record.title,
        record.captured_on,
        record.notes,
        record.asset.sha256,
        JSON.stringify(record),
      );
      (record.provenance ?? []).forEach((provenance, provenanceIndex) =>
        insertContextProvenance.run(
          record.id,
          provenanceIndex,
          provenance.source_session,
          provenance.source_sequence ?? null,
          provenance.source_bundle ?? null,
          provenance.source_bundle_sha256 ?? null,
          provenance.source_screenshot ?? null,
          provenance.original_filename ?? null,
          provenance.screenshot_notes ?? null,
        ),
      );
    });

    for (const [name, definition] of Object.entries(snapshotDefinitions)) {
      const header = { ...snapshots[name] };
      delete header[definition.collection];
      insertHeader.run(name, JSON.stringify(header));
    }

    database.exec(`
      UPDATE image_intake
      SET
        asset_sha256 = sha256,
        status = 'canonicalized',
        local_path = (
          SELECT assets.local_path
          FROM assets
          WHERE assets.sha256 = image_intake.sha256
        ),
        last_seen_at = CURRENT_TIMESTAMP
      WHERE EXISTS (
        SELECT 1 FROM assets WHERE assets.sha256 = image_intake.sha256
      );

      UPDATE image_intake
      SET status = 'pending'
      WHERE asset_sha256 IS NULL;
    `);

    database.exec("COMMIT");
    database.exec("PRAGMA optimize");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function exportSnapshots(database) {
  const output = {};
  for (const [name, definition] of Object.entries(snapshotDefinitions)) {
    const headerRow = database
      .prepare("SELECT header_json FROM snapshot_headers WHERE name = ?")
      .get(name);
    if (!headerRow) throw new Error(`Missing snapshot header for ${name}`);
    const rows = database
      .prepare(`SELECT document_json FROM ${definition.table} ORDER BY sort_order`)
      .all();
    output[name] = {
      ...JSON.parse(headerRow.header_json),
      [definition.collection]: rows.map((row) => JSON.parse(row.document_json)),
    };
  }
  return output;
}

export async function writeSnapshots(snapshots, directory = path.join(projectRoot, "data")) {
  for (const [name, definition] of Object.entries(snapshotDefinitions)) {
    const target = path.join(directory, definition.file);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshots[name], null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }
}

function insertResearchNotes(statement, postcardId, kind, values = []) {
  (values ?? []).forEach((note, index) => statement.run(postcardId, kind, index, note));
}

function nullableBoolean(value) {
  if (value == null) return null;
  return value ? 1 : 0;
}

function validateSnapshots(snapshots) {
  for (const [name, definition] of Object.entries(snapshotDefinitions)) {
    if (!snapshots[name] || !Array.isArray(snapshots[name][definition.collection])) {
      throw new Error(`Invalid ${name} snapshot`);
    }
  }
}
