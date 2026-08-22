import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { backupDatabase, defaultDatabasePath, openDatabase, projectRoot } from "../db/database.mjs";
import { loadSnapshots, replaceDatabaseFromSnapshots, writeSnapshots } from "../db/snapshots.mjs";
import {
  buildRecoveryMarkdown,
  buildResearchRedo,
  recoverySourcePath,
  targetIds,
} from "../research/recovery/research-redo-2026-08-23.mjs";

const commit = process.argv.includes("--commit");
const snapshots = await loadSnapshots();
const before = snapshots.postcards.postcards;
const byId = new Map(before.map((record) => [record.id, record]));
const unexpectedGaps = before
  .filter((record) => record.research.detail.status === "not_recovered")
  .map((record) => record.id)
  .filter((id) => !targetIds.includes(id));
const missingTargets = targetIds.filter((id) => !byId.has(id));
const invalidTargets = targetIds.filter((id) => {
  const status = byId.get(id)?.research.status;
  return status !== "prior_research_not_recovered_from_compacted_context"
    && status !== "re-researched_after_compaction_gap_2026-08-23";
});
if (unexpectedGaps.length || missingTargets.length || invalidTargets.length) {
  throw new Error([
    `Research redo precondition mismatch`,
    `unexpected_gaps=${unexpectedGaps.join(",")}`,
    `missing_targets=${missingTargets.join(",")}`,
    `invalid_targets=${invalidTargets.join(",")}`,
  ].join("; "));
}
const pendingCount = targetIds.filter(
  (id) => byId.get(id).research.detail.status === "not_recovered",
).length;

const postcards = before.map((source) => {
  if (!targetIds.includes(source.id)) return source;
  const record = structuredClone(source);
  const redo = buildResearchRedo(record);
  record.location = { ...record.location, ...redo.location };
  record.research = redo.research;
  record.provenance = record.provenance.map((item) => ({
    ...item,
    research_status: "re-researched_after_compaction_gap_2026-08-23",
  }));
  return record;
});

const updatedSnapshots = {
  ...snapshots,
  postcards: { ...snapshots.postcards, postcards },
};
const report = {
  commit,
  target_count: targetIds.length,
  pending_count: pendingCount,
  already_applied_count: targetIds.length - pendingCount,
  updated_count: postcards.filter(
    (record) => record.research.status === "re-researched_after_compaction_gap_2026-08-23",
  ).length,
  research_details: Object.fromEntries(
    ["raw_preserved", "structured_preserved", "not_recovered"].map((status) => [
      status,
      postcards.filter((record) => record.research.detail.status === status).length,
    ]),
  ),
  source_path: recoverySourcePath,
};

if (!commit) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const sourceTarget = path.join(projectRoot, recoverySourcePath);
const sourceTemporary = `${sourceTarget}.tmp`;
await writeFile(sourceTemporary, buildRecoveryMarkdown(postcards), "utf8");
await rename(sourceTemporary, sourceTarget);
await writeSnapshots(updatedSnapshots);

const backupPath = await backupDatabase(defaultDatabasePath);
const database = await openDatabase(defaultDatabasePath);
try {
  replaceDatabaseFromSnapshots(database, updatedSnapshots);
} finally {
  database.close();
}

console.log(JSON.stringify({
  ...report,
  database_backup: backupPath ? path.relative(projectRoot, backupPath) : null,
}, null, 2));
