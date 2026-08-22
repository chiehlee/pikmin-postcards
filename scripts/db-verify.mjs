import assert from "node:assert/strict";
import path from "node:path";
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
  assert.match(senderPlan, /idx_postcards_sender_found_date/);
  assert.match(curationPlan, /idx_postcards_curation_status_rating/);

  console.log(
    JSON.stringify(
      {
        integrity,
        foreign_key_violations: 0,
        round_trip: "exact",
        query_plans: { sender_timeline: senderPlan, curation_filter: curationPlan },
      },
      null,
      2,
    ),
  );
} finally {
  database.close();
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
