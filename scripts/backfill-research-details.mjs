import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  researchDetailFromSource,
  validateResearchDetail,
} from "../lib/research-details.mjs";
import { backupDatabase, defaultDatabasePath, openDatabase, projectRoot } from "../db/database.mjs";
import {
  loadSnapshots,
  replaceDatabaseFromSnapshots,
  writeSnapshots,
} from "../db/snapshots.mjs";

const currentResearchPath = "research/raw/current-session.md";
const bundleResearchPath = "research/raw/postcard-session-2026-08-23.md";
const currentResearch = await readFile(path.join(projectRoot, currentResearchPath), "utf8");
const currentBodies = parseCurrentResearch(currentResearch);
const snapshots = await loadSnapshots();
const postcards = snapshots.postcards.postcards.map((source) => {
  const record = structuredClone(source);
  const currentSequence = Number.parseInt(record.id.slice(3), 10);
  const isCurrentResearch = currentSequence >= 1 && currentSequence <= 20;
  record.research.detail = researchDetailFromSource({
    researchStatus: record.research.status,
    summary: record.research.summary,
    detailBody: isCurrentResearch ? currentBodies.get(currentSequence) : null,
    sourcePath: isCurrentResearch ? currentResearchPath : bundleResearchPath,
  });
  validateResearchDetail(record);
  return record;
});

const updatedSnapshots = {
  ...snapshots,
  postcards: {
    ...snapshots.postcards,
    schema_version: 3,
    postcards,
  },
};
const byStatus = Object.fromEntries(
  ["raw_preserved", "structured_preserved", "not_recovered"].map((status) => [
    status,
    postcards.filter((record) => record.research.detail.status === status).length,
  ]),
);
const report = {
  postcards: postcards.length,
  research_details: byStatus,
  commit: process.argv.includes("--commit"),
};

if (!report.commit) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const backupPath = await backupDatabase(defaultDatabasePath);
const database = await openDatabase(defaultDatabasePath);
try {
  replaceDatabaseFromSnapshots(database, updatedSnapshots);
  await writeSnapshots(updatedSnapshots);
} finally {
  database.close();
}

console.log(JSON.stringify({
  ...report,
  database_backup: backupPath?.replace(`${projectRoot}/`, "") ?? null,
}, null, 2));

function parseCurrentResearch(markdown) {
  const matches = [...markdown.matchAll(/^## (\d+)\. .+$/gm)];
  const output = new Map();
  matches.forEach((match, index) => {
    const sectionStart = match.index + match[0].length;
    const sectionEnd = matches[index + 1]?.index ?? markdown.length;
    const section = markdown.slice(sectionStart, sectionEnd);
    const beforeSources = section.split("Previously referenced sources:", 1)[0].trim();
    const blocks = beforeSources.split(/\n\s*\n/).filter(Boolean);
    const body = blocks.at(-1)?.trim();
    if (!body || body.startsWith("- ")) {
      throw new Error(`Could not recover detailed research section ${match[1]}`);
    }
    output.set(Number(match[1]), body);
  });
  if (output.size !== 20) throw new Error(`Expected 20 current-session details, found ${output.size}`);
  return output;
}
