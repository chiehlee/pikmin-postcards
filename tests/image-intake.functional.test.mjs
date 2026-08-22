import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveStoredLocalPath } from "../db/asset-paths.mjs";
import { openDatabase, projectRoot } from "../db/database.mjs";
import { loadSnapshots, replaceDatabaseFromSnapshots } from "../db/snapshots.mjs";

const execFileAsync = promisify(execFile);

test("image intake keeps bytes local and links an existing canonical asset", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-intake-test-"));
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  const inboxDirectory = path.join(temporaryDirectory, "inbox");
  const sourcePath = path.join(
    projectRoot,
    "public/images/postcards/2026/05/pc-020.png",
  );
  const seedDatabase = await openDatabase(databasePath);
  try {
    replaceDatabaseFromSnapshots(seedDatabase, await loadSnapshots());
  } finally {
    seedDatabase.close();
  }

  try {
    const args = [
      "--disable-warning=ExperimentalWarning",
      "scripts/ingest-image.mjs",
      "--source",
      sourcePath,
      "--database",
      databasePath,
      "--inbox-dir",
      inboxDirectory,
    ];
    const first = JSON.parse((await execFileAsync(process.execPath, args, { cwd: projectRoot })).stdout);
    const second = JSON.parse((await execFileAsync(process.execPath, args, { cwd: projectRoot })).stdout);

    assert.equal(first.status, "canonicalized");
    assert.equal(first.local_path, "public/images/postcards/2026/05/pc-020.png");
    assert.equal(second.sha256, first.sha256);
    assert.ok(second.backup);

    const database = await openDatabase(databasePath);
    try {
      const intake = database.prepare("SELECT * FROM image_intake").get();
      assert.equal(intake.sha256, first.sha256);
      assert.equal(intake.asset_sha256, first.sha256);
      assert.equal(intake.status, "canonicalized");
      assert.equal(database.prepare("SELECT count(*) AS count FROM image_intake_sources").get().count, 1);
      assert.deepEqual(
        await readFile(resolveStoredLocalPath(intake.local_path)),
        await readFile(sourcePath),
      );
    } finally {
      database.close();
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("remote image intake downloads new bytes locally without storing URL secrets", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-remote-intake-test-"));
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  const inboxDirectory = path.join(temporaryDirectory, "inbox");
  const canonicalBytes = await readFile(
    path.join(projectRoot, "public/images/postcards/2026/05/pc-020.png"),
  );
  const servedBytes = Buffer.concat([canonicalBytes, Buffer.from("remote-intake-test")]);
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "image/png",
      "content-length": servedBytes.length,
      "content-disposition": "attachment; filename=remote-postcard.png",
    });
    response.end(servedBytes);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const sourceUrl = `http://127.0.0.1:${address.port}/postcard.png?token=do-not-store`;

  try {
    const result = JSON.parse((await execFileAsync(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        "scripts/ingest-image.mjs",
        "--source",
        sourceUrl,
        "--database",
        databasePath,
        "--inbox-dir",
        inboxDirectory,
      ],
      { cwd: projectRoot },
    )).stdout);
    assert.equal(result.status, "pending");
    assert.ok(result.local_path.startsWith(inboxDirectory));
    assert.deepEqual(await readFile(result.local_path), servedBytes);

    const database = await openDatabase(databasePath);
    try {
      const intake = database.prepare("SELECT * FROM image_intake").get();
      const intakeSource = database.prepare("SELECT * FROM image_intake_sources").get();
      assert.equal(intake.status, "pending");
      assert.equal(intake.asset_sha256, null);
      assert.equal(intakeSource.source_kind, "remote");
      assert.equal(intakeSource.source_locator, `http://127.0.0.1:${address.port}/postcard.png`);
      assert.ok(!intakeSource.source_locator.includes("do-not-store"));
      replaceDatabaseFromSnapshots(database, await loadSnapshots());
      assert.equal(
        database.prepare("SELECT status FROM image_intake WHERE sha256 = ?").get(intake.sha256).status,
        "pending",
      );
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      database.close();
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
