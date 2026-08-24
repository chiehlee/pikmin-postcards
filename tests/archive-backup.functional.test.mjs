import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createArchiveBackup, verifyArchiveBackup } from "../db/archive-backup.mjs";

test("archive backup binds a consistent SQLite copy to every referenced image without BLOB storage", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "pikmin-archive-backup-"));
  const databasePath = path.join(dataRoot, "runtime/pikmin-postcards.sqlite3");
  const postcardImage = path.join(dataRoot, "images/postcards/2026/08/pc-test.png");
  const intakeImage = path.join(dataRoot, "runtime/image-inbox/intake-test.png");
  const snapshot = path.join(dataRoot, "snapshots/postcards.json");

  try {
    for (const target of [databasePath, postcardImage, intakeImage, snapshot]) {
      await mkdir(path.dirname(target), { recursive: true });
    }
    await mkdir(path.join(dataRoot, "research/raw"), { recursive: true });
    await mkdir(path.join(dataRoot, "imports/source-bundles"), { recursive: true });
    await writeFile(postcardImage, "canonical-image-bytes");
    await writeFile(intakeImage, "intake-image-bytes");
    await writeFile(snapshot, '{"postcards":[]}\n');
    await writeFile(path.join(dataRoot, "research/raw/example.md"), "research");
    await writeFile(path.join(dataRoot, "imports/source-bundles/example.zip"), "bundle");

    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);
      CREATE TABLE assets (path TEXT NOT NULL, local_path TEXT NOT NULL);
      CREATE TABLE image_intake (local_path TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (12, '012_batch_intake_workflows.sql', '2026-08-23T00:00:00Z');
      INSERT INTO assets VALUES ('/images/postcards/2026/08/pc-test.png', 'public/images/postcards/2026/08/pc-test.png');
      INSERT INTO image_intake VALUES ('var/image-inbox/intake-test.png');
    `);
    database.close();

    const backup = await createArchiveBackup({
      databasePath,
      dataRoot,
      now: new Date("2026-08-23T12:00:00.000Z"),
    });
    assert.equal(backup.manifest.format, "pikmin-postcard-archive-backup-v1");
    assert.equal(backup.manifest.asset_binding.database_assets, 1);
    assert.equal(backup.manifest.asset_binding.intake_assets, 1);
    assert.ok(backup.manifest.storage.hardlinked_files >= 4);
    assert.deepEqual(backup.manifest.database.migrations.map((migration) => migration.version), [12]);

    const backupImage = path.join(backup.directory, "images/postcards/2026/08/pc-test.png");
    assert.equal((await stat(postcardImage)).ino, (await stat(backupImage)).ino);
    await rm(postcardImage);
    assert.equal(await readFile(backupImage, "utf8"), "canonical-image-bytes");

    const verified = await verifyArchiveBackup(backup.directory);
    assert.equal(verified.ok, true);
    assert.deepEqual(verified.asset_binding, { database_assets: 1, intake_assets: 1, missing: 0 });

    await writeFile(path.join(backup.directory, "snapshots/postcards.json"), "tampered");
    await assert.rejects(verifyArchiveBackup(backup.directory), /checksum 不符|大小不符/);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
