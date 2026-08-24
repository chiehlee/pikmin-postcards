import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("research redo CLI is a safe, idempotent dry run after application", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "scripts/apply-research-redo.mjs"],
    { cwd: root },
  );
  const report = JSON.parse(stdout);
  assert.equal(report.commit, false);
  assert.equal(report.target_count, 107);
  assert.equal(report.pending_count, 0);
  assert.equal(report.already_applied_count, 107);
  assert.equal(report.updated_count + report.superseded_count, 107);
  assert.ok(report.superseded_count >= 1);
  const postcards = JSON.parse(await readFile(path.join(root, "data/postcards.json"), "utf8")).postcards;
  assert.deepEqual(report.research_details, Object.fromEntries(
    ["raw_preserved", "structured_preserved", "not_recovered"].map((status) => [
      status,
      postcards.filter((record) => record.research.detail.status === status).length,
    ]),
  ));
});
