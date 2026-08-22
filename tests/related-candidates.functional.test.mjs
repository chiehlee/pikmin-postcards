import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { openDatabase, projectRoot } from "../db/database.mjs";
import { loadSnapshots, replaceDatabaseFromSnapshots } from "../db/snapshots.mjs";

const execFileAsync = promisify(execFile);

test("related postcard discovery returns a bounded indexed shortlist", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-related-test-"));
  const databasePath = path.join(temporaryDirectory, "archive.sqlite3");
  const database = await openDatabase(databasePath);
  try {
    replaceDatabaseFromSnapshots(database, await loadSnapshots());
  } finally {
    database.close();
  }

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        "scripts/find-related-candidates.mjs",
        "--database",
        databasePath,
        "--id",
        "pc-0111",
        "--limit",
        "4",
      ],
      { cwd: projectRoot },
    );
    const result = JSON.parse(stdout);

    assert.equal(result.policy.exhaustive, false);
    assert.equal(result.policy.strategy, "bounded-indexed-shortlist");
    assert.ok(result.candidates.length <= 4);
    assert.equal(result.candidates[0].id, "pc-0112");
    assert.ok(result.candidates[0].signals.some((signal) => signal.type === "same-poi"));
    assert.ok(result.candidates[0].signals.some((signal) => signal.type === "same-raw-location"));
    assert.equal(result.candidates[0].existing_relation.relationship, "same-metadata-different-image");
    assert.equal("research_summary" in result.candidates[0], false);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
