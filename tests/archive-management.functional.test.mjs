import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../db/database.mjs";
import { archiveOverview, cancelJob, softDeletePostcard } from "../server/archive-manager.mjs";

test("GPT-5.6 job migrations preserve old jobs and accept new reasoning and cancellation states", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-reasoning-migration-"));
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  const legacy = new DatabaseSync(databasePath);
  try {
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;
      CREATE TABLE ai_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('add', 'reresearch')),
        status TEXT NOT NULL CHECK (status IN ('queued', 'in_progress', 'applying', 'completed', 'failed')),
        postcard_id TEXT,
        intake_sha256 TEXT,
        openai_response_id TEXT UNIQUE,
        model TEXT NOT NULL,
        skill_path TEXT NOT NULL,
        skill_sha256 TEXT NOT NULL,
        prompt TEXT NOT NULL,
        result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        provider TEXT NOT NULL DEFAULT 'openai_api' CHECK (provider IN ('openai_api', 'local_codex')),
        reasoning_effort TEXT NOT NULL DEFAULT 'high' CHECK (reasoning_effort IN ('minimal', 'low', 'medium', 'high', 'xhigh')),
        workflow TEXT NOT NULL DEFAULT 'full_research' CHECK (workflow IN ('metadata_only', 'full_research')),
        batch_id TEXT,
        input_label TEXT,
        user_note TEXT
      ) STRICT;
      CREATE TABLE postcards (
        id TEXT PRIMARY KEY
      ) STRICT;
      INSERT INTO ai_jobs (
        id, kind, status, model, skill_path, skill_sha256, prompt, created_at,
        updated_at, provider, reasoning_effort, workflow
      ) VALUES (
        'legacy-minimal', 'add', 'failed', 'gpt-5.6-sol', 'skill', 'sha',
        'legacy prompt', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:01.000Z',
        'local_codex', 'minimal', 'metadata_only'
      );
    `);
    const migration = legacy.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)");
    for (let version = 1; version <= 13; version += 1) migration.run(version, `legacy-${version}.sql`);
  } finally {
    legacy.close();
  }

  const database = await openDatabase(databasePath);
  try {
    assert.equal(database.prepare("SELECT reasoning_effort FROM ai_jobs WHERE id = 'legacy-minimal'").get().reasoning_effort, "minimal");
    const insert = database.prepare(`
      INSERT INTO ai_jobs (
        id, kind, status, model, skill_path, skill_sha256, prompt, created_at,
        updated_at, provider, reasoning_effort, workflow
      ) VALUES (?, 'add', 'queued', 'gpt-5.6-sol', 'skill', 'sha', 'prompt',
        '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z',
        'local_codex', ?, 'metadata_only')
    `);
    insert.run("quick-none", "none");
    insert.run("deep-max", "max");
    database.prepare(`
      INSERT INTO ai_jobs (
        id, kind, status, model, skill_path, skill_sha256, prompt, created_at,
        updated_at, provider, reasoning_effort, workflow
      ) VALUES ('cancelled-job', 'add', 'cancelled', 'gpt-5.6-sol', 'skill', 'sha',
        'preserved prompt', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:01.000Z',
        'local_codex', 'high', 'full_research')
    `).run();
    assert.deepEqual(
      database.prepare("SELECT reasoning_effort FROM ai_jobs WHERE id IN ('quick-none', 'deep-max') ORDER BY id").all().map((row) => row.reasoning_effort),
      ["max", "none"],
    );
    assert.ok(database.prepare("PRAGMA index_list(ai_jobs)").all().some((index) => index.name === "idx_ai_jobs_reasoning_created"));
    assert.equal(database.prepare("SELECT prompt FROM ai_jobs WHERE id = 'cancelled-job'").get().prompt, "preserved prompt");
    assert.ok(database.prepare("SELECT 1 FROM schema_migrations WHERE version = 15").get());
    assert.ok(database.prepare("SELECT 1 FROM schema_migrations WHERE version = 16").get());
    const postcardColumns = new Set(database.prepare("PRAGMA table_info(postcards)").all().map((column) => column.name));
    assert.ok(postcardColumns.has("location_geocode_status"));
    assert.ok(postcardColumns.has("location_geocode_document_json"));
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally {
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("cancelling a queued job is terminal, preserves evidence, and removes it from the active overview", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-cancel-job-"));
  const snapshotDirectory = path.join(temporaryDirectory, "data");
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  await cp(new URL("../data", import.meta.url), snapshotDirectory, { recursive: true, dereference: true });
  const database = await openDatabase(databasePath);
  try {
    database.prepare(`
      INSERT INTO ai_jobs (
        id, kind, status, postcard_id, model, skill_path, skill_sha256, prompt,
        created_at, updated_at, provider, reasoning_effort, workflow, input_label
      ) VALUES (
        'job-cancel-functional', 'reresearch', 'queued', 'pc-0001', 'gpt-5.6-sol',
        '.agents/skills/pikmin-postcard-intake/SKILL.md', 'skill-sha', '完整 prompt 仍需保留',
        '2026-08-24T01:02:03.000Z', '2026-08-24T01:02:03.000Z',
        'local_codex', 'high', 'full_research', 'cancel-functional.png'
      )
    `).run();
  } finally {
    database.close();
  }

  try {
    const cancelled = await cancelJob("job-cancel-functional", { databasePath, snapshotDirectory });
    assert.equal(cancelled.status, "cancelled");
    assert.ok(cancelled.completed_at);
    assert.equal(cancelled.postcard_id, "pc-0001");
    assert.equal((await cancelJob("job-cancel-functional", { databasePath, snapshotDirectory })).status, "cancelled");

    const applyingDatabase = await openDatabase(databasePath);
    try {
      applyingDatabase.prepare(`
        INSERT INTO ai_jobs (
          id, kind, status, postcard_id, model, skill_path, skill_sha256, prompt,
          created_at, updated_at, provider, reasoning_effort, workflow
        ) VALUES (
          'job-applying-functional', 'reresearch', 'applying', 'pc-0001', 'gpt-5.6-sol',
          'skill', 'sha', 'applying prompt', '2026-08-24T01:02:03.000Z',
          '2026-08-24T01:02:04.000Z', 'local_codex', 'high', 'full_research'
        )
      `).run();
    } finally {
      applyingDatabase.close();
    }
    await assert.rejects(
      cancelJob("job-applying-functional", { databasePath, snapshotDirectory }),
      (error) => error.status === 409 && /更新資料庫/.test(error.message),
    );

    const providerDatabase = await openDatabase(databasePath);
    try {
      providerDatabase.prepare(`
        INSERT INTO ai_jobs (
          id, kind, status, postcard_id, openai_response_id, model, skill_path,
          skill_sha256, prompt, created_at, started_at, updated_at, provider,
          reasoning_effort, workflow
        ) VALUES (
          'job-openai-cancel-functional', 'reresearch', 'in_progress', 'pc-0001',
          'resp-functional-cancel', 'gpt-5.6', 'skill', 'sha', 'provider prompt',
          '2026-08-24T01:02:03.000Z', '2026-08-24T01:02:04.000Z',
          '2026-08-24T01:02:05.000Z', 'openai_api', 'high', 'full_research'
        )
      `).run();
    } finally {
      providerDatabase.close();
    }
    const previousApiKey = process.env.OPENAI_API_KEY;
    let providerCancellation;
    process.env.OPENAI_API_KEY = "functional-cancel-key";
    try {
      await cancelJob("job-openai-cancel-functional", {
        databasePath,
        snapshotDirectory,
        cancelOpenAI: async (options) => {
          providerCancellation = options;
          return { id: options.responseId, status: "cancelled" };
        },
      });
    } finally {
      if (previousApiKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousApiKey;
    }
    assert.deepEqual(providerCancellation, {
      apiKey: "functional-cancel-key",
      responseId: "resp-functional-cancel",
    });

    const overview = await archiveOverview({ databasePath, snapshotDirectory });
    assert.equal(overview.jobs.some((job) => job.id === "job-cancel-functional"), false);

    const verification = await openDatabase(databasePath);
    try {
      const row = verification.prepare("SELECT * FROM ai_jobs WHERE id = ?").get("job-cancel-functional");
      assert.equal(row.status, "cancelled");
      assert.equal(row.prompt, "完整 prompt 仍需保留");
      assert.equal(row.input_label, "cancel-functional.png");
      assert.equal(row.error, null);
      assert.ok(row.completed_at);
      assert.equal(verification.prepare("SELECT status FROM ai_jobs WHERE id = 'job-applying-functional'").get().status, "applying");
      assert.equal(verification.prepare("SELECT status FROM ai_jobs WHERE id = 'job-openai-cancel-functional'").get().status, "cancelled");
    } finally {
      verification.close();
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("soft delete hides one postcard while preserving its image, research, DB row, and relations", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-soft-delete-"));
  const snapshotDirectory = path.join(temporaryDirectory, "data");
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  const canonicalSnapshot = new URL("../data/postcards.json", import.meta.url);
  const canonicalBefore = await readFile(canonicalSnapshot);
  await cp(new URL("../data", import.meta.url), snapshotDirectory, {
    recursive: true,
    dereference: true,
  });
  const before = JSON.parse(await readFile(path.join(snapshotDirectory, "postcards.json"), "utf8"));
  const friendsBefore = JSON.parse(await readFile(path.join(snapshotDirectory, "friends.json"), "utf8"));
  const activeBefore = before.postcards.filter((record) => !record.lifecycle?.deleted_at).length;
  const deletedBefore = before.postcards.length - activeBefore;
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
    assert.deepEqual(
      JSON.parse(await readFile(path.join(snapshotDirectory, "friends.json"), "utf8")),
      friendsBefore,
    );

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
    const staleSnapshot = structuredClone(after);
    staleSnapshot.postcards.find((record) => record.id === relatedId).poi_name = "STALE CLIENT SNAPSHOT MUST NOT WIN";
    await writeFile(path.join(snapshotDirectory, "postcards.json"), `${JSON.stringify(staleSnapshot, null, 2)}\n`);
    const overview = await archiveOverview({ snapshotDirectory, databasePath });
    assert.equal(overview.totals.active, activeBefore - 1);
    assert.equal(overview.totals.deleted, deletedBefore + 1);
    assert.ok(!overview.postcards.some((record) => record.id === "pc-0001"));
    assert.ok(overview.postcards.some((record) => record.id === relatedId));
    assert.notEqual(overview.postcards.find((record) => record.id === relatedId).poi_name, "STALE CLIENT SNAPSHOT MUST NOT WIN");
    assert.deepEqual(overview.friends, friendsBefore.profiles);
    assert.deepEqual(overview.jobs.map((job) => job.id), ["job-resume-test"]);
    assert.equal(overview.jobs[0].workflow, "full_research");
    assert.equal(overview.jobs[0].batch_id, null);
    assert.equal(overview.jobs[0].reasoning_effort, "high");
    assert.equal("prompt" in overview.jobs[0], false);

    const database = await openDatabase(databasePath);
    try {
      const row = database.prepare("SELECT deleted_at, deleted_reason, document_json FROM postcards WHERE id = ?").get("pc-0001");
      assert.ok(row.deleted_at);
      assert.equal(row.deleted_reason, "functional test");
      assert.equal(JSON.parse(row.document_json).asset.sha256, original.asset.sha256);
      assert.equal(database.prepare("SELECT count(*) AS count FROM research_details WHERE postcard_id = ?").get("pc-0001").count, 1);
      assert.equal(database.prepare("SELECT count(*) AS count FROM postcard_relations WHERE postcard_id = ?").get("pc-0001").count, original.related_postcards.length);
      const jobColumns = database.prepare("PRAGMA table_info(ai_jobs)").all().map((column) => column.name);
      assert.ok(jobColumns.includes("workflow"));
      assert.ok(jobColumns.includes("batch_id"));
      assert.ok(jobColumns.includes("input_label"));
      assert.ok(jobColumns.includes("user_note"));
      assert.ok(database.prepare("PRAGMA table_info(postcard_provenance)").all().some((column) => column.name === "user_note"));
      assert.ok(database.prepare("PRAGMA index_list(ai_jobs)").all().some((index) => index.name === "idx_ai_jobs_batch_created"));
      assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      database.close();
    }
  } finally {
    assert.deepEqual(await readFile(canonicalSnapshot), canonicalBefore);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
