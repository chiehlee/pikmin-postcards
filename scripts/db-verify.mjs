import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveStoredLocalPath } from "../db/asset-paths.mjs";
import { defaultDatabasePath, openDatabase, projectRoot } from "../db/database.mjs";
import { exportSnapshots, loadSnapshots } from "../db/snapshots.mjs";

const databasePath = argument("--database")
  ? path.resolve(argument("--database"))
  : defaultDatabasePath;
const expected = await loadSnapshots();
const database = await openDatabase(databasePath);

try {
  const integrity = database.prepare("PRAGMA integrity_check").get().integrity_check;
  assert.equal(integrity, "ok");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.deepEqual(exportSnapshots(database), expected);
  const localAssetCount = await verifyLocalImages(database);
  const researchDetailCount = await verifyResearchDetails(database);

  const senderPlan = database
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM postcards WHERE sender = ? ORDER BY found_date DESC")
    .all("柳柳")
    .map((row) => row.detail)
    .join(" | ");
  const curationPlan = database
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM postcards WHERE curation_status = ? ORDER BY rating DESC")
    .all("keep")
    .map((row) => row.detail)
    .join(" | ");
  const localPathPlan = database
    .prepare("EXPLAIN QUERY PLAN SELECT sha256 FROM assets WHERE local_path = ?")
    .all("public/images/postcards/example.png")
    .map((row) => row.detail)
    .join(" | ");
  const acquisitionPlan = database
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM postcards WHERE acquisition_type = ?")
    .all("self_found")
    .map((row) => row.detail)
    .join(" | ");
  const poiPlan = database
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM postcards WHERE poi_name = ? LIMIT 16")
    .all("鉄のドンキホーテ")
    .map((row) => row.detail)
    .join(" | ");
  const rawLocationPlan = database
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM postcards WHERE location_raw = ? LIMIT 16")
    .all("Setagaya, Sangenjaya 1-Chōme")
    .map((row) => row.detail)
    .join(" | ");
  const displayLocationPlan = database
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM postcards WHERE location_display = ? LIMIT 16")
    .all("臺北市信義區")
    .map((row) => row.detail)
    .join(" | ");
  const endonymLocationPlan = database
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM postcards WHERE location_endonym = ? LIMIT 16")
    .all("那須町湯本")
    .map((row) => row.detail)
    .join(" | ");
  const zhTwLocationPlan = database
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM postcards WHERE location_zh_tw = ? LIMIT 16")
    .all("首爾特別市")
    .map((row) => row.detail)
    .join(" | ");
  const tagPlan = database
    .prepare("EXPLAIN QUERY PLAN SELECT postcard_id FROM postcard_tags WHERE tag = ? LIMIT 16")
    .all("商業景觀")
    .map((row) => row.detail)
    .join(" | ");
  const sourcePlan = database
    .prepare("EXPLAIN QUERY PLAN SELECT postcard_id FROM research_sources WHERE url = ? LIMIT 16")
    .all("https://example.com")
    .map((row) => row.detail)
    .join(" | ");
  const coordinatePlan = database
    .prepare(`
      EXPLAIN QUERY PLAN
      SELECT id FROM postcards
      WHERE latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
      LIMIT 16
    `)
    .all(24, 26, 120, 122)
    .map((row) => row.detail)
    .join(" | ");
  assert.match(senderPlan, /idx_postcards_sender_found_date/);
  assert.match(curationPlan, /idx_postcards_curation_status_rating/);
  assert.match(localPathPlan, /idx_assets_local_path/);
  assert.match(acquisitionPlan, /idx_postcards_acquisition_type/);
  assert.match(poiPlan, /idx_postcards_poi_name/);
  assert.match(rawLocationPlan, /idx_postcards_location_raw/);
  assert.match(displayLocationPlan, /idx_postcards_location_display/);
  assert.match(endonymLocationPlan, /idx_postcards_location_endonym/);
  assert.match(zhTwLocationPlan, /idx_postcards_location_zh_tw/);
  assert.match(tagPlan, /idx_postcard_tags_tag_postcard/);
  assert.match(sourcePlan, /idx_research_sources_url_postcard/);
  assert.match(coordinatePlan, /idx_postcards_coordinates/);

  console.log(
    JSON.stringify(
      {
        integrity,
        foreign_key_violations: 0,
        round_trip: "exact",
        local_assets_verified: localAssetCount,
        research_details_verified: researchDetailCount,
        query_plans: {
          sender_timeline: senderPlan,
          curation_filter: curationPlan,
          local_asset_lookup: localPathPlan,
          acquisition_filter: acquisitionPlan,
          related_poi_lookup: poiPlan,
          related_raw_location_lookup: rawLocationPlan,
          related_display_location_lookup: displayLocationPlan,
          related_endonym_location_lookup: endonymLocationPlan,
          related_zh_tw_location_lookup: zhTwLocationPlan,
          related_tag_lookup: tagPlan,
          related_source_lookup: sourcePlan,
          related_coordinate_lookup: coordinatePlan,
        },
      },
      null,
      2,
    ),
  );
} finally {
  database.close();
}

async function verifyResearchDetails(database) {
  const postcardCount = database.prepare("SELECT count(*) AS count FROM postcards").get().count;
  const records = database
    .prepare("SELECT postcard_id, status, body, source_path, preservation_note FROM research_details")
    .all();
  assert.equal(records.length, postcardCount, "Every postcard must have one research detail record");

  for (const record of records) {
    await readFile(path.join(projectRoot, record.source_path), "utf8");
    if (record.status === "not_recovered") {
      assert.equal(record.body, null, `${record.postcard_id} must not fabricate missing detail`);
      assert.ok(record.preservation_note, `${record.postcard_id} must explain the missing detail`);
    } else {
      assert.ok(record.body?.trim(), `${record.postcard_id} must preserve its detail body`);
      assert.equal(record.preservation_note, null);
    }
  }
  return records.length;
}

async function verifyLocalImages(database) {
  const records = [
    ...database.prepare("SELECT sha256, local_path, bytes FROM assets").all(),
    ...database.prepare("SELECT sha256, local_path, bytes FROM image_intake").all(),
  ];
  for (const record of records) {
    assert.ok(record.local_path, `Missing local path for ${record.sha256}`);
    const bytes = await readFile(resolveStoredLocalPath(record.local_path));
    assert.equal(bytes.length, record.bytes, `Byte count mismatch for ${record.local_path}`);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      record.sha256,
      `SHA-256 mismatch for ${record.local_path}`,
    );
  }
  return records.length;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
