import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveStoredLocalPath } from "../db/asset-paths.mjs";
import { openDatabase } from "../db/database.mjs";
import { exportSnapshots, replaceDatabaseFromSnapshots } from "../db/snapshots.mjs";
import { createSyntheticSnapshots } from "./fixtures/archive-snapshots.mjs";

test("SQLite migration preserves every snapshot field exactly", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-db-test-"));
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  const snapshots = createSyntheticSnapshots();
  snapshots.postcards.postcards[0].research.images = [{
    path: "/images/research/pc-9001/job-test-1-abc123.png",
    sha256: "a".repeat(64),
    bytes: 1234,
    media_type: "image/png",
    source_page_url: "https://example.com/story",
    source_page_url_sha256: "b".repeat(64),
    source_image_url: "https://example.com/photo.png",
    source_image_url_sha256: "c".repeat(64),
    caption: "研究故事的參考圖片",
    alt: "測試地點的外觀",
    credit: "Example Museum",
  }];
  snapshots.postcards.postcards[0].user_contributions = [{
    kind: "reresearch_note",
    body: "我親身到過這裡。",
    recorded_at: "2026-08-23T01:02:03.000Z",
    job_id: "job-roundtrip",
  }];
  snapshots.postcards.postcards[0].provenance[0].user_note = "我親身到過這裡。";
  for (const postcard of snapshots.postcards.postcards) postcard.related_postcards[0].note = "相同測試系列的兩張合成遊戲截圖。";
  const database = await openDatabase(databasePath);

  try {
    replaceDatabaseFromSnapshots(database, snapshots);
    database.prepare(`
      INSERT INTO ai_jobs (
        id, kind, status, postcard_id, user_note, model, skill_path, skill_sha256, prompt,
        created_at, updated_at
      ) VALUES ('job-roundtrip', 'reresearch', 'queued', 'pc-9001', '我親身到過這裡。', 'test-model',
        '.agents/skills/pikmin-postcard-intake/SKILL.md', 'abc123', 'test prompt',
        '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')
    `).run();
    replaceDatabaseFromSnapshots(database, snapshots);
    assert.deepEqual(exportSnapshots(database), snapshots);
    assert.equal(database.prepare("SELECT count(*) AS count FROM ai_jobs WHERE id = 'job-roundtrip'").get().count, 1);
    assert.equal(database.prepare("SELECT provider FROM ai_jobs WHERE id = 'job-roundtrip'").get().provider, "openai_api");
    assert.equal(database.prepare("SELECT reasoning_effort FROM ai_jobs WHERE id = 'job-roundtrip'").get().reasoning_effort, "high");
    assert.equal(database.prepare("SELECT user_note FROM ai_jobs WHERE id = 'job-roundtrip'").get().user_note, "我親身到過這裡。");
    assert.equal(database.prepare("SELECT user_note FROM postcard_provenance WHERE postcard_id = 'pc-9001' AND sort_order = 0").get().user_note, "我親身到過這裡。");
    assert.ok(database.prepare("PRAGMA table_info(postcards)").all().some((column) => column.name === "deleted_at"));
    assert.ok(database.prepare("PRAGMA table_info(postcards)").all().some((column) => column.name === "archived_at"));
    assert.ok(database.prepare("PRAGMA table_info(postcards)").all().some((column) => column.name === "location_geocode_status"));
    const resolvedLocations = database.prepare(`
      SELECT count(*) AS count FROM postcards
      WHERE location_geocode_status = 'resolved' AND latitude IS NOT NULL AND longitude IS NOT NULL
    `).get().count;
    assert.equal(resolvedLocations, snapshots.postcards.postcards.length);
    assert.equal(
      database.prepare(`
        SELECT note FROM postcard_relations
        WHERE postcard_id = 'pc-9001' AND related_postcard_id = 'pc-9002'
      `).get().note,
      "相同測試系列的兩張合成遊戲截圖。",
    );
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    const postcardCount = snapshots.postcards.postcards.length;
    assert.equal(database.prepare("SELECT count(*) AS count FROM postcards").get().count, postcardCount);
    assert.equal(database.prepare("SELECT count(*) AS count FROM research_details").get().count, postcardCount);
    const expectedResearchStatuses = Object.entries(
      snapshots.postcards.postcards.reduce((counts, postcard) => {
        const status = postcard.research.detail.status;
        counts[status] = (counts[status] ?? 0) + 1;
        return counts;
      }, {}),
    )
      .map(([status, count]) => ({ status, count }))
      .sort((left, right) => left.status.localeCompare(right.status));
    assert.deepEqual(
      database
        .prepare("SELECT status, count(*) AS count FROM research_details GROUP BY status ORDER BY status")
        .all()
        .map((row) => ({ ...row })),
      expectedResearchStatuses,
    );
    const assets = database.prepare("SELECT local_path FROM assets").all();
    assert.equal(assets.length, postcardCount + snapshots.context.records.length);
    assert.ok(assets.every((asset) => asset.local_path.startsWith("public/images/")));
    assert.ok(assets.every((asset) => path.isAbsolute(resolveStoredLocalPath(asset.local_path))));

    const senderPlan = database
      .prepare("EXPLAIN QUERY PLAN SELECT id FROM postcards WHERE sender = ? ORDER BY found_date DESC")
      .all("synthetic-sender")
      .map((row) => row.detail)
      .join(" | ");
    assert.match(senderPlan, /idx_postcards_sender_found_date/);
    assert.ok(
      database.prepare("PRAGMA index_list(postcards)").all()
        .some((index) => index.name === "idx_postcards_acquisition_type"),
    );
  } finally {
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
