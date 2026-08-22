import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveStoredLocalPath } from "../db/asset-paths.mjs";
import { openDatabase } from "../db/database.mjs";
import { exportSnapshots, loadSnapshots, replaceDatabaseFromSnapshots } from "../db/snapshots.mjs";

test("SQLite migration preserves every snapshot field exactly", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-db-test-"));
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  const snapshots = await loadSnapshots();
  const database = await openDatabase(databasePath);

  try {
    replaceDatabaseFromSnapshots(database, snapshots);
    assert.deepEqual(exportSnapshots(database), snapshots);
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(database.prepare("SELECT count(*) AS count FROM postcards").get().count, 148);
    assert.equal(database.prepare("SELECT count(*) AS count FROM research_details").get().count, 148);
    assert.deepEqual(
      database
        .prepare("SELECT status, count(*) AS count FROM research_details GROUP BY status ORDER BY status")
        .all()
        .map((row) => ({ ...row })),
      [
        { status: "not_recovered", count: 107 },
        { status: "raw_preserved", count: 20 },
        { status: "structured_preserved", count: 21 },
      ],
    );
    const assets = database.prepare("SELECT local_path FROM assets").all();
    assert.equal(assets.length, 149);
    assert.ok(assets.every((asset) => asset.local_path.startsWith("public/images/")));
    assert.ok(assets.every((asset) => path.isAbsolute(resolveStoredLocalPath(asset.local_path))));

    const senderPlan = database
      .prepare("EXPLAIN QUERY PLAN SELECT id FROM postcards WHERE sender = ? ORDER BY found_date DESC")
      .all("柳柳")
      .map((row) => row.detail)
      .join(" | ");
    assert.match(senderPlan, /idx_postcards_sender_found_date/);
    const acquisitionPlan = database
      .prepare("EXPLAIN QUERY PLAN SELECT id FROM postcards WHERE acquisition_type = ?")
      .all("self_found")
      .map((row) => row.detail)
      .join(" | ");
    assert.match(acquisitionPlan, /idx_postcards_acquisition_type/);
  } finally {
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
