import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveStoredLocalPath } from "../db/asset-paths.mjs";
import { defaultDatabasePath, openDatabase } from "../db/database.mjs";
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
  assert.match(senderPlan, /idx_postcards_sender_found_date/);
  assert.match(curationPlan, /idx_postcards_curation_status_rating/);
  assert.match(localPathPlan, /idx_assets_local_path/);

  console.log(
    JSON.stringify(
      {
        integrity,
        foreign_key_violations: 0,
        round_trip: "exact",
        local_assets_verified: localAssetCount,
        query_plans: {
          sender_timeline: senderPlan,
          curation_filter: curationPlan,
          local_asset_lookup: localPathPlan,
        },
      },
      null,
      2,
    ),
  );
} finally {
  database.close();
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
