import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../db/database.mjs";
import { archiveOverview, softDeletePostcard } from "../server/archive-manager.mjs";

test("soft delete hides one postcard while preserving its image, research, DB row, and relations", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-soft-delete-"));
  const snapshotDirectory = path.join(temporaryDirectory, "data");
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  await cp(new URL("../data", import.meta.url), snapshotDirectory, { recursive: true });
  const before = JSON.parse(await readFile(path.join(snapshotDirectory, "postcards.json"), "utf8"));
  const original = before.postcards.find((record) => record.id === "pc-0001");
  const relatedId = original.related_postcards[0].id;

  try {
    const deleted = await softDeletePostcard(
      "pc-0001",
      "functional test",
      { snapshotDirectory, databasePath },
    );
    assert.equal(deleted.lifecycle.status, "deleted");
    assert.equal(deleted.lifecycle.deleted_reason, "functional test");

    const after = JSON.parse(await readFile(path.join(snapshotDirectory, "postcards.json"), "utf8"));
    assert.equal(after.postcards.length, before.postcards.length);
    const preserved = after.postcards.find((record) => record.id === "pc-0001");
    assert.deepEqual(preserved.asset, original.asset);
    assert.deepEqual(preserved.research, original.research);
    assert.deepEqual(preserved.related_postcards, original.related_postcards);
    assert.ok(after.postcards.some((record) => record.id === relatedId));

    const jobDatabase = await openDatabase(databasePath);
    try {
      jobDatabase.prepare(`
        INSERT INTO ai_jobs (
          id, kind, status, postcard_id, model, skill_path, skill_sha256, prompt,
          created_at, started_at, updated_at
        ) VALUES (?, 'reresearch', 'in_progress', ?, 'test-model', 'test-skill',
          'test-sha', 'test-prompt', ?, ?, ?)
      `).run(
        "job-resume-test",
        relatedId,
        "2026-08-23T00:00:00.000Z",
        "2026-08-23T00:00:01.000Z",
        "2026-08-23T00:00:02.000Z",
      );
    } finally {
      jobDatabase.close();
    }
    const overview = await archiveOverview({ snapshotDirectory, databasePath });
    assert.equal(overview.totals.active, before.postcards.length - 1);
    assert.equal(overview.totals.deleted, 1);
    assert.ok(!overview.postcards.some((record) => record.id === "pc-0001"));
    assert.ok(overview.postcards.some((record) => record.id === relatedId));
    assert.deepEqual(overview.jobs.map((job) => job.id), ["job-resume-test"]);
    assert.equal("prompt" in overview.jobs[0], false);

    const database = await openDatabase(databasePath);
    try {
      const row = database.prepare("SELECT deleted_at, deleted_reason, document_json FROM postcards WHERE id = ?").get("pc-0001");
      assert.ok(row.deleted_at);
      assert.equal(row.deleted_reason, "functional test");
      assert.equal(JSON.parse(row.document_json).asset.sha256, original.asset.sha256);
      assert.equal(database.prepare("SELECT count(*) AS count FROM research_details WHERE postcard_id = ?").get("pc-0001").count, 1);
      assert.equal(database.prepare("SELECT count(*) AS count FROM postcard_relations WHERE postcard_id = ?").get("pc-0001").count, original.related_postcards.length);
      assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      database.close();
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
