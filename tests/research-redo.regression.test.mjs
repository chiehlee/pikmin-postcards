import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildRecoveryMarkdown,
  buildResearchRedo,
  recoverySourcePath,
  targetIds,
} from "../research/recovery/research-redo-2026-08-23.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const postcards = JSON.parse(await readFile(path.join(root, "data/postcards.json"), "utf8")).postcards;

test("compaction-gap research redo has exact, unique coverage", () => {
  assert.equal(targetIds.length, 107);
  assert.equal(new Set(targetIds).size, 107);
  const byId = new Map(postcards.map((record) => [record.id, record]));

  for (const id of targetIds) {
    const record = byId.get(id);
    assert.ok(record, `${id} is missing from the archive`);
    assert.equal(record.research.status, "re-researched_after_compaction_gap_2026-08-23");
    assert.equal(record.research.detail.status, "structured_preserved");
    assert.equal(record.research.detail.source_path, recoverySourcePath);
    assert.equal(record.research.detail.preservation_note, null);
    assert.match(record.research.detail.body, /本輪重做研究；不是遺失原文的復原/);
    assert.doesNotMatch(record.research.summary, /full prior assistant research text/);
    assert.ok(record.research.confirmed_facts.length > 0, `${id} has no confirmed observations`);
    assert.ok(record.location.country_code, `${id} has no normalized country`);
    assert.ok(record.research.sources.every((url) => /^https:\/\//.test(url)));
  }
});

test("redo manifest is deterministic and the preserved report covers every postcard", async () => {
  const byId = new Map(postcards.map((record) => [record.id, record]));
  for (const id of ["pc-0022", "pc-0084", "pc-0111", "pc-0148"]) {
    const rebuilt = buildResearchRedo(byId.get(id));
    assert.deepEqual(rebuilt.research, byId.get(id).research);
  }

  const generated = buildRecoveryMarkdown(postcards);
  const preserved = await readFile(path.join(root, recoverySourcePath), "utf8");
  assert.equal(preserved, generated);
  assert.equal((preserved.match(/^## pc-/gm) ?? []).length, 107);
});

test("repeated metadata remains independent after sharing a research profile", () => {
  for (const [leftId, rightId] of [
    ["pc-0061", "pc-0076"],
    ["pc-0111", "pc-0112"],
    ["pc-0147", "pc-0001"],
  ]) {
    const left = postcards.find((record) => record.id === leftId);
    const right = postcards.find((record) => record.id === rightId);
    assert.notEqual(left.asset.sha256, right.asset.sha256);
    assert.ok(left.related_postcards.some((relation) => relation.id === rightId));
    assert.ok(right.related_postcards.some((relation) => relation.id === leftId));
  }
});
