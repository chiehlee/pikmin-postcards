import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../db/database.mjs";
import { replaceDatabaseFromSnapshots } from "../db/snapshots.mjs";
import {
  archiveOverview,
  cancelJob,
  editFriendProfile,
  mergeFriendProfiles,
  nextPostcardId,
  reassessFriendBase,
  setPostcardReadState,
  softDeleteFriend,
  softDeletePostcard,
  updatePostcard,
} from "../server/archive-manager.mjs";
import { rebuildFriends } from "../lib/friends.mjs";
import { createSyntheticSnapshots, writeSnapshots } from "./fixtures/archive-snapshots.mjs";

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
        id TEXT PRIMARY KEY,
        archived_on TEXT NOT NULL,
        archived_at TEXT,
        sender TEXT,
        document_json TEXT NOT NULL CHECK (json_valid(document_json))
      ) STRICT;
      CREATE TABLE friends (
        name TEXT PRIMARY KEY,
        evidence_count INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        document_json TEXT NOT NULL CHECK (json_valid(document_json))
      ) STRICT;
      CREATE TABLE friend_evidence (
        friend_name TEXT NOT NULL,
        postcard_id TEXT NOT NULL
      ) STRICT;
      INSERT INTO postcards (id, archived_on, archived_at, document_json)
      VALUES (
        'legacy-postcard',
        '2026-08-22',
        '2026-08-22T01:02:03Z',
        '{"id":"legacy-postcard","archived_on":"2026-08-22","archived_at":"2026-08-22T01:02:03Z"}'
      );
      INSERT INTO friends (name, updated_at, document_json)
      VALUES ('legacy-friend', '2026-08-22T02:03:04Z', '{"name":"legacy-friend","evidence_postcard_ids":["legacy-postcard"]}');
      INSERT INTO friend_evidence VALUES ('legacy-friend', 'legacy-postcard');
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
    assert.ok(database.prepare("SELECT 1 FROM schema_migrations WHERE version = 17").get());
    assert.ok(database.prepare("SELECT 1 FROM schema_migrations WHERE version = 18").get());
    assert.ok(database.prepare("SELECT 1 FROM schema_migrations WHERE version = 19").get());
    assert.ok(database.prepare("SELECT 1 FROM schema_migrations WHERE version = 20").get());
    const postcardColumns = new Set(database.prepare("PRAGMA table_info(postcards)").all().map((column) => column.name));
    assert.ok(postcardColumns.has("location_geocode_status"));
    assert.ok(postcardColumns.has("location_geocode_document_json"));
    assert.ok(postcardColumns.has("modified_at"));
    assert.ok(postcardColumns.has("read_at"));
    const migratedPostcard = database.prepare("SELECT modified_at, read_at, document_json FROM postcards WHERE id = 'legacy-postcard'").get();
    assert.equal(migratedPostcard.modified_at, "2026-08-22T01:02:03Z");
    assert.equal(JSON.parse(migratedPostcard.document_json).modified_at, "2026-08-22T01:02:03Z");
    assert.equal(migratedPostcard.read_at, "2026-08-22T01:02:03Z");
    assert.deepEqual(JSON.parse(migratedPostcard.document_json).reading, {
      is_read: true,
      read_at: "2026-08-22T01:02:03Z",
    });
    const friendColumns = new Set(database.prepare("PRAGMA table_info(friends)").all().map((column) => column.name));
    assert.ok(friendColumns.has("modified_at"));
    assert.ok(friendColumns.has("deleted_at"));
    assert.ok(friendColumns.has("merged_into"));
    const migratedFriend = database.prepare("SELECT modified_at, document_json FROM friends WHERE name = 'legacy-friend'").get();
    assert.equal(migratedFriend.modified_at, "2026-08-22T01:02:03Z");
    assert.equal(JSON.parse(migratedFriend.document_json).modified_at, "2026-08-22T01:02:03Z");
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally {
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("merged sender migration reconnects a newly seen old ID to its canonical friend", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-merged-sender-migration-"));
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE postcards (
        id TEXT PRIMARY KEY,
        sender TEXT,
        archived_on TEXT,
        archived_at TEXT,
        modified_at TEXT,
        document_json TEXT NOT NULL CHECK (json_valid(document_json))
      ) STRICT;
      CREATE TABLE friends (
        name TEXT PRIMARY KEY,
        evidence_count INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        merged_into TEXT,
        document_json TEXT NOT NULL CHECK (json_valid(document_json))
      ) STRICT;
      CREATE TABLE friend_evidence (
        friend_name TEXT NOT NULL,
        postcard_id TEXT NOT NULL,
        PRIMARY KEY (friend_name, postcard_id)
      ) STRICT;
      INSERT INTO postcards VALUES (
        'pc-new', 'レ', '2026-09-06', '2026-09-06T23:36:32Z', '2026-09-06T23:36:32Z',
        '{"id":"pc-new","sender":"レ","archived_on":"2026-09-06","archived_at":"2026-09-06T23:36:32Z","modified_at":"2026-09-06T23:36:32Z"}'
      );
      INSERT INTO friends VALUES (
        'V', 0, NULL, NULL,
        '{"name":"V","evidence_postcard_ids":[],"base_analysis":{"evidence_count":0}}'
      );
      INSERT INTO friends VALUES (
        'レ', 1, '2026-09-02T02:58:26Z', 'V',
        '{"name":"レ","evidence_postcard_ids":["pc-old"],"lifecycle":{"status":"deleted","deleted_at":"2026-09-02T02:58:26Z","merged_into":"V"}}'
      );
    `);
    database.exec(await readFile(path.join(process.cwd(), "db/migrations/020_merged_sender_aliases.sql"), "utf8"));

    const postcard = database.prepare("SELECT sender, document_json FROM postcards WHERE id = 'pc-new'").get();
    assert.equal(postcard.sender, "V");
    assert.deepEqual(JSON.parse(postcard.document_json).sender_history, [{
      previous_name: "レ",
      next_name: "V",
      reason: "merged-alias-normalization",
      changed_at: "2026-09-06T23:36:32Z",
    }]);
    assert.deepEqual(
      database.prepare("SELECT friend_name, postcard_id FROM friend_evidence").all()
        .map(({ friend_name, postcard_id }) => ({ friend_name, postcard_id })),
      [{ friend_name: "V", postcard_id: "pc-new" }],
    );
    assert.equal(database.prepare("SELECT evidence_count FROM friends WHERE name = 'V'").get().evidence_count, 1);
    assert.deepEqual(JSON.parse(database.prepare("SELECT document_json FROM friends WHERE name = 'V'").get().document_json).evidence_postcard_ids, ["pc-new"]);
  } finally {
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("postcard read state is durable, legacy-safe, and does not change archive sorting time", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-read-state-"));
  const snapshotDirectory = path.join(temporaryDirectory, "data");
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  const snapshots = createSyntheticSnapshots();
  for (const postcard of snapshots.postcards.postcards) delete postcard.reading;
  snapshots.postcards.schema_version = 6;
  await writeSnapshots(snapshotDirectory, snapshots);

  try {
    const initial = await archiveOverview({ snapshotDirectory, databasePath });
    assert.ok(initial.postcards.every((postcard) => postcard.reading.is_read));
    assert.ok(initial.postcards.every((postcard) => postcard.reading.read_at));
    const modifiedAt = initial.postcards[0].modified_at;

    const unread = await setPostcardReadState("pc-9001", false, { snapshotDirectory, databasePath });
    assert.deepEqual(unread.reading, { is_read: false, read_at: null });
    assert.equal(unread.modified_at, modifiedAt);

    let database = await openDatabase(databasePath);
    try {
      const row = database.prepare("SELECT read_at, modified_at, document_json FROM postcards WHERE id = ?").get("pc-9001");
      assert.equal(row.read_at, null);
      assert.equal(row.modified_at, modifiedAt);
      assert.deepEqual(JSON.parse(row.document_json).reading, { is_read: false, read_at: null });
    } finally {
      database.close();
    }

    const read = await setPostcardReadState("pc-9001", true, { snapshotDirectory, databasePath });
    assert.equal(read.reading.is_read, true);
    assert.match(read.reading.read_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(read.modified_at, modifiedAt);

    const saved = JSON.parse(await readFile(path.join(snapshotDirectory, "postcards.json"), "utf8"));
    assert.equal(saved.schema_version, 8);
    assert.deepEqual(saved.postcards.find((postcard) => postcard.id === "pc-9001").reading, read.reading);
    database = await openDatabase(databasePath);
    try {
      assert.equal(database.prepare("SELECT read_at FROM postcards WHERE id = ?").get("pc-9001").read_at, read.reading.read_at);
    } finally {
      database.close();
    }

    await assert.rejects(
      setPostcardReadState("missing-postcard", true, { snapshotDirectory, databasePath }),
      (error) => error.status === 404,
    );
    await assert.rejects(
      setPostcardReadState("pc-9001", "yes", { snapshotDirectory, databasePath }),
      (error) => error.status === 400,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("manual postcard name edits preserve the AI value and leave location and research evidence unchanged", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-postcard-name-edit-"));
  const snapshotDirectory = path.join(temporaryDirectory, "data");
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  const snapshots = createSyntheticSnapshots();
  const original = structuredClone(snapshots.postcards.postcards[0]);
  await writeSnapshots(snapshotDirectory, snapshots);

  try {
    const edited = await updatePostcard("pc-9001", { poi_name: "  圖  " }, { snapshotDirectory, databasePath });
    assert.equal(edited.poi_name, "圖");
    assert.match(edited.modified_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.deepEqual(edited.poi_name_history, [{
      previous_name: original.poi_name,
      next_name: "圖",
      reason: "manual-edit",
      changed_at: edited.modified_at,
    }]);
    assert.deepEqual(edited.location, original.location);
    assert.deepEqual(edited.research, original.research);

    const unchanged = await updatePostcard("pc-9001", { poi_name: "圖" }, { snapshotDirectory, databasePath });
    assert.equal(unchanged.modified_at, edited.modified_at);
    assert.equal(unchanged.poi_name_history.length, 1);

    const database = await openDatabase(databasePath);
    try {
      const row = database.prepare("SELECT poi_name, modified_at, document_json FROM postcards WHERE id = ?").get("pc-9001");
      assert.equal(row.poi_name, "圖");
      assert.equal(row.modified_at, edited.modified_at);
      assert.deepEqual(JSON.parse(row.document_json).poi_name_history, edited.poi_name_history);
    } finally {
      database.close();
    }

    await assert.rejects(
      updatePostcard("pc-9001", { poi_name: "   " }, { snapshotDirectory, databasePath }),
      (error) => error.status === 400,
    );
    await assert.rejects(
      updatePostcard("missing-postcard", { poi_name: "圖" }, { snapshotDirectory, databasePath }),
      (error) => error.status === 404,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("friend edit, base reassessment, merge, and soft delete preserve provenance and leave postcards recoverable", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-friend-management-"));
  const snapshotDirectory = path.join(temporaryDirectory, "data");
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  const snapshots = createSyntheticSnapshots();
  for (const [index, card] of snapshots.postcards.postcards.entries()) {
    card.sender = index === 0 ? "Alice" : "Bob";
    card.acquisition = { type: "received", sender_status: "confirmed", confidence: "high", evidence: ["sender-visible"] };
  }
  snapshots.friends = rebuildFriends(snapshots.postcards.postcards);
  snapshots.friends.profiles.forEach((profile, index) => {
    profile.modified_at = `2026-08-24T00:00:0${index}Z`;
  });
  await writeSnapshots(snapshotDirectory, snapshots);

  try {
    const edited = await editFriendProfile("Alice", {
      name: "Alicia",
      likely_base_area: "臺北市北投區",
    }, { snapshotDirectory, databasePath });
    assert.equal(edited.name, "Alicia");
    assert.equal(edited.likely_base.area, "臺北市北投區");
    assert.equal(edited.likely_base.status, "manual");
    assert.deepEqual(edited.aliases, ["Alice"]);

    const reassessed = await reassessFriendBase("Alicia", { snapshotDirectory, databasePath });
    assert.equal(reassessed.likely_base.area, null);
    assert.equal(reassessed.likely_base.status, "insufficient-evidence");
    assert.equal(reassessed.base_analysis.origin, "none");
    assert.equal(reassessed.manual_overrides, undefined);
    assert.equal(reassessed.base_assessment_history.length, 1);
    assert.equal(reassessed.base_assessment_history[0].trigger, "user_requested_reassessment");
    assert.equal(reassessed.base_assessment_history[0].previous_likely_base.area, "臺北市北投區");

    const merged = await mergeFriendProfiles("Alicia", "Bob", { snapshotDirectory, databasePath });
    assert.equal(merged.friend.name, "Bob");
    assert.ok(merged.friend.aliases.includes("Alicia"));
    assert.equal(merged.merged_friend.lifecycle.merged_into, "Bob");

    const deleted = await softDeleteFriend("Bob", "functional friend delete", { snapshotDirectory, databasePath });
    assert.equal(deleted.lifecycle.deleted_reason, "functional friend delete");
    const overview = await archiveOverview({ snapshotDirectory, databasePath });
    assert.deepEqual(overview.friends, []);
    assert.deepEqual(overview.orphaned_sender_names, ["Bob"]);
    assert.ok(overview.postcards.every((card) => card.sender === "Bob"));
    assert.deepEqual(
      overview.postcards.find((card) => card.id === "pc-9001").sender_history.map((change) => change.reason),
      ["rename", "merge"],
    );

    const database = await openDatabase(databasePath);
    try {
      const source = database.prepare("SELECT deleted_at, merged_into, document_json FROM friends WHERE name = 'Alicia'").get();
      assert.ok(source.deleted_at);
      assert.equal(source.merged_into, "Bob");
      const target = database.prepare("SELECT deleted_at, document_json FROM friends WHERE name = 'Bob'").get();
      assert.ok(target.deleted_at);
      assert.equal(JSON.parse(target.document_json).lifecycle.deleted_reason, "functional friend delete");
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      database.close();
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("postcard ID allocation skips canonical image files left by a previously failed apply", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-postcard-id-"));
  try {
    const orphanDirectory = path.join(temporaryDirectory, "2026", "05");
    await mkdir(orphanDirectory, { recursive: true });
    await writeFile(path.join(orphanDirectory, "pc-0168.png"), "preserved orphan bytes");
    assert.equal(
      await nextPostcardId([{ id: "pc-0167" }], { imageDirectory: temporaryDirectory }),
      "pc-0169",
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("cancelling a queued job is terminal, preserves evidence, and removes it from the active overview", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-cancel-job-"));
  const snapshotDirectory = path.join(temporaryDirectory, "data");
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  const snapshots = createSyntheticSnapshots();
  await writeSnapshots(snapshotDirectory, snapshots);
  const database = await openDatabase(databasePath);
  try {
    replaceDatabaseFromSnapshots(database, snapshots);
    database.prepare(`
      INSERT INTO ai_jobs (
        id, kind, status, postcard_id, model, skill_path, skill_sha256, prompt,
        created_at, updated_at, provider, reasoning_effort, workflow, input_label
      ) VALUES (
        'job-cancel-functional', 'reresearch', 'queued', 'pc-9001', 'gpt-5.6-sol',
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
    assert.equal(cancelled.postcard_id, "pc-9001");
    assert.equal((await cancelJob("job-cancel-functional", { databasePath, snapshotDirectory })).status, "cancelled");

    const applyingDatabase = await openDatabase(databasePath);
    try {
      applyingDatabase.prepare(`
        INSERT INTO ai_jobs (
          id, kind, status, postcard_id, model, skill_path, skill_sha256, prompt,
          created_at, updated_at, provider, reasoning_effort, workflow
        ) VALUES (
          'job-applying-functional', 'reresearch', 'applying', 'pc-9001', 'gpt-5.6-sol',
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
          'job-openai-cancel-functional', 'reresearch', 'in_progress', 'pc-9001',
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
  await writeSnapshots(snapshotDirectory);
  const before = JSON.parse(await readFile(path.join(snapshotDirectory, "postcards.json"), "utf8"));
  const friendsBefore = JSON.parse(await readFile(path.join(snapshotDirectory, "friends.json"), "utf8"));
  const activeBefore = before.postcards.filter((record) => !record.lifecycle?.deleted_at).length;
  const deletedBefore = before.postcards.length - activeBefore;
  const original = before.postcards.find((record) => record.id === "pc-9001");
  const relatedId = original.related_postcards[0].id;

  try {
    const deleted = await softDeletePostcard(
      "pc-9001",
      "functional test",
      { snapshotDirectory, databasePath },
    );
    assert.equal(deleted.lifecycle.status, "deleted");
    assert.equal(deleted.lifecycle.deleted_reason, "functional test");

    const after = JSON.parse(await readFile(path.join(snapshotDirectory, "postcards.json"), "utf8"));
    assert.equal(after.postcards.length, before.postcards.length);
    const preserved = after.postcards.find((record) => record.id === "pc-9001");
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
    assert.ok(!overview.postcards.some((record) => record.id === "pc-9001"));
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
      const row = database.prepare("SELECT deleted_at, deleted_reason, document_json FROM postcards WHERE id = ?").get("pc-9001");
      assert.ok(row.deleted_at);
      assert.equal(row.deleted_reason, "functional test");
      assert.equal(JSON.parse(row.document_json).asset.sha256, original.asset.sha256);
      assert.equal(database.prepare("SELECT count(*) AS count FROM research_details WHERE postcard_id = ?").get("pc-9001").count, 1);
      assert.equal(database.prepare("SELECT count(*) AS count FROM postcard_relations WHERE postcard_id = ?").get("pc-9001").count, original.related_postcards.length);
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
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
