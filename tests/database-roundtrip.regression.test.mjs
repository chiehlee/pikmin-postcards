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
  for (const postcardId of ["pc-0111", "pc-0112"]) {
    const postcard = snapshots.postcards.postcards.find((record) => record.id === postcardId);
    postcard.related_postcards[0].note = "相同 POI、日期與地點的兩張獨立遊戲截圖。";
  }
  const database = await openDatabase(databasePath);

  try {
    replaceDatabaseFromSnapshots(database, snapshots);
    database.prepare(`
      INSERT INTO ai_jobs (
        id, kind, status, postcard_id, model, skill_path, skill_sha256, prompt,
        created_at, updated_at
      ) VALUES ('job-roundtrip', 'reresearch', 'queued', 'pc-0001', 'test-model',
        '.agents/skills/pikmin-postcard-intake/SKILL.md', 'abc123', 'test prompt',
        '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')
    `).run();
    replaceDatabaseFromSnapshots(database, snapshots);
    assert.deepEqual(exportSnapshots(database), snapshots);
    assert.equal(database.prepare("SELECT count(*) AS count FROM ai_jobs WHERE id = 'job-roundtrip'").get().count, 1);
    assert.ok(database.prepare("PRAGMA table_info(postcards)").all().some((column) => column.name === "deleted_at"));
    assert.equal(
      database.prepare(`
        SELECT note FROM postcard_relations
        WHERE postcard_id = 'pc-0111' AND related_postcard_id = 'pc-0112'
      `).get().note,
      "相同 POI、日期與地點的兩張獨立遊戲截圖。",
    );
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
        { status: "raw_preserved", count: 20 },
        { status: "structured_preserved", count: 128 },
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
