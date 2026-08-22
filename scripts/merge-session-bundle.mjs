import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquisitionFromEvidence } from "../lib/acquisition.mjs";
import { metadataKey } from "../lib/dedupe.mjs";
import { rebuildFriends } from "../lib/friends.mjs";
import { researchDetailFromSource } from "../lib/research-details.mjs";
import { backupDatabase, defaultDatabasePath, openDatabase } from "../db/database.mjs";
import { replaceDatabaseFromSnapshots } from "../db/snapshots.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const bundlePath = args.get("--bundle") ? path.resolve(args.get("--bundle")) : null;
const importId = args.get("--id") ?? "postcard-session-2026-08-23";
const shouldCommit = args.has("--commit");

if (!bundlePath) {
  console.error("Usage: node scripts/merge-session-bundle.mjs --bundle /path/to/bundle.zip [--id import-id] [--commit]");
  process.exit(1);
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "pikmin-postcards-merge-"));

try {
  execFileSync("bsdtar", ["-xf", bundlePath, "-C", tempDir]);
  const manifestPath = await findNamedFile(tempDir, "postcards_manifest.json");
  if (!manifestPath) throw new Error("Bundle does not contain postcards_manifest.json");

  const sourceRoot = path.dirname(manifestPath);
  const sourceManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(sourceManifest.records)) {
    throw new Error("Expected a manifest object with a records array");
  }

  const bundleSha256 = await sha256(bundlePath);
  const postcardsPath = path.join(projectRoot, "data/postcards.json");
  const friendsPath = path.join(projectRoot, "data/friends.json");
  const contextsPath = path.join(projectRoot, "data/context.json");
  const importsPath = path.join(projectRoot, "data/imports.json");
  const postcardArchive = await readJson(postcardsPath);
  const friendArchive = await readJson(friendsPath);
  const contextArchive = await readJson(contextsPath, { schema_version: 1, records: [] });
  const importArchive = await readJson(importsPath);

  if (importArchive.imports.some((entry) => entry.bundle_sha256 === bundleSha256)) {
    console.log(`Bundle already imported: ${bundleSha256}`);
    process.exit(0);
  }

  const extractedFiles = await collectFiles(sourceRoot);
  const filesByRelativePath = new Map(
    extractedFiles.map((file) => [path.relative(sourceRoot, file).normalize("NFC"), file]),
  );

  const verifiedRecords = [];
  for (const record of sourceManifest.records) {
    const sourcePath = filesByRelativePath.get(record.screenshot_path.normalize("NFC"));
    if (!sourcePath) throw new Error(`Missing screenshot: ${record.screenshot_path}`);
    const actualHash = await sha256(sourcePath);
    if (actualHash !== record.sha256) {
      throw new Error(`SHA-256 mismatch for ${record.screenshot_path}`);
    }
    verifiedRecords.push({ record, sourcePath });
  }

  const postcards = structuredClone(postcardArchive.postcards);
  const contexts = structuredClone(contextArchive.records);
  const copies = [];
  const contextCopies = [];
  const byHash = new Map(postcards.map((record) => [record.asset.sha256, record]));
  let nextPostcardNumber = nextNumericId(postcards, "pc-");
  let nextContextNumber = nextNumericId(contexts, "context-");
  let collapsedOccurrences = 0;
  let addedPostcards = 0;
  let addedContexts = 0;

  for (const { record: source, sourcePath } of verifiedRecords) {
    const provenance = provenanceFor(source, importId, bundleSha256);

    if (source.record_type === "context") {
      const exactContext = contexts.find((record) => record.asset.sha256 === source.sha256);
      if (exactContext) {
        exactContext.provenance ??= [];
        exactContext.provenance.push(provenance);
        collapsedOccurrences += 1;
        continue;
      }

      const id = `context-${String(nextContextNumber++).padStart(4, "0")}`;
      const extension = normalizedExtension(sourcePath);
      const destination = path.join(projectRoot, "public/images/context", `${id}${extension}`);
      const sourceStats = await stat(sourcePath);
      contexts.push({
        id,
        record_type: "context",
        title: source.poi_name,
        captured_on: source.found_date,
        asset: {
          path: `/images/context/${id}${extension}`,
          sha256: source.sha256,
          bytes: sourceStats.size,
          media_type: mediaType(extension),
          original_filename: source.original_filename,
        },
        notes: source.screenshot_notes,
        provenance: [provenance],
      });
      contextCopies.push({ source: sourcePath, destination });
      addedContexts += 1;
      continue;
    }

    const exact = byHash.get(source.sha256);
    if (exact) {
      exact.provenance ??= [];
      exact.provenance.push(provenance);
      collapsedOccurrences += 1;
      continue;
    }

    const id = `pc-${String(nextPostcardNumber++).padStart(4, "0")}`;
    const extension = normalizedExtension(sourcePath);
    const year = source.found_date?.slice(0, 4) ?? "unknown";
    const month = source.found_date?.slice(5, 7) ?? "unknown";
    const destination = path.join(
      projectRoot,
      "public/images/postcards",
      year,
      month,
      `${id}${extension}`,
    );
    const sourceStats = await stat(sourcePath);
    const rating = parseRating(source.rating);
    const canonical = {
      id,
      record_type: "postcard",
      poi_name: source.poi_name,
      found_date: source.found_date,
      received_at: null,
      archived_on: sourceManifest.generated_on ?? "2026-08-23",
      sender: source.sender,
      acquisition: acquisitionFromEvidence({
        sender: source.sender,
        sendToFriendButtonVisible: source.send_to_friend_button_visible,
        senderPanelVisible: source.sender_panel_visible,
        senderAreaBlank: source.sender_area_blank,
      }),
      location: {
        raw: source.location_displayed,
        display: source.location_displayed,
        city: null,
        district: null,
        locality: null,
        region: null,
        county: null,
        country: "未正規化",
        country_code: null,
        latitude: null,
        longitude: null,
        normalization_confidence: "unreviewed",
      },
      asset: {
        path: `/images/postcards/${year}/${month}/${id}${extension}`,
        sha256: source.sha256,
        bytes: sourceStats.size,
        media_type: mediaType(extension),
        original_filename: source.original_filename,
      },
      curation: {
        rating: rating.value,
        rating_raw: source.rating,
        rating_range: rating.range,
        recommendation: source.recommendation,
        status: inferStatus(source.recommendation, rating.value),
        tags: [],
        personal_relevance: null,
        star_visible_in_screenshot: source.star_visible_in_screenshot,
        deletion_toast_visible: source.deletion_toast_visible,
      },
      research: {
        status: source.research_status,
        confidence: normalizeConfidence(source.research_confidence),
        confidence_label: confidenceLabel(source.research_confidence),
        summary: source.research_summary,
        confirmed_facts: source.confirmed_facts ?? [],
        inferences: source.inferences ?? [],
        unresolved_questions: source.unresolved_questions ?? [],
        sources: source.source_urls ?? [],
        detail: researchDetailFromSource({
          researchStatus: source.research_status,
          summary: source.research_summary,
          detailBody: source.research_detail ?? source.research_detail_body ?? null,
          sourcePath: `research/raw/${importId}.md`,
        }),
      },
      provenance: [provenance],
      related_postcards: [],
    };

    postcards.push(canonical);
    byHash.set(source.sha256, canonical);
    copies.push({ source: sourcePath, destination });
    addedPostcards += 1;
  }

  const relationCounts = rebuildRelations(postcards);
  const friends = rebuildFriends(postcards, friendArchive);
  const bundleDestinationRelative = `imports/source-bundles/${importId}.zip`;
  const importDestination = path.join(projectRoot, "imports", importId);
  const newImport = {
    id: importId,
    source_session: "postcard-session-bundle",
    archived_on: sourceManifest.generated_on ?? "2026-08-23",
    bundle: bundleDestinationRelative,
    bundle_sha256: bundleSha256,
    source_record_count: sourceManifest.record_count,
    postcard_occurrence_count: sourceManifest.postcard_record_count,
    context_occurrence_count: sourceManifest.context_record_count,
    canonical_postcards_added: addedPostcards,
    canonical_context_records_added: addedContexts,
    occurrences_collapsed_by_sha256: collapsedOccurrences,
    related_pairs: relationCounts,
    status: "imported",
    notes: "Original upload occurrences remain preserved in the source ZIP. Byte-identical occurrences collapse to one canonical asset while retaining provenance; distinct screenshots remain separate records.",
  };

  const report = {
    bundle_sha256: bundleSha256,
    source_records: sourceManifest.record_count,
    source_postcards: sourceManifest.postcard_record_count,
    source_context_records: sourceManifest.context_record_count,
    canonical_postcards_before: postcardArchive.postcards.length,
    canonical_postcards_added: addedPostcards,
    canonical_postcards_after: postcards.length,
    canonical_context_records_added: addedContexts,
    occurrences_collapsed_by_sha256: collapsedOccurrences,
    related_pairs: relationCounts,
    commit: shouldCommit,
  };

  if (!shouldCommit) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  for (const copy of [...copies, ...contextCopies]) {
    await mkdir(path.dirname(copy.destination), { recursive: true });
    await copyFile(copy.source, copy.destination);
  }

  await mkdir(path.join(projectRoot, "imports/source-bundles"), { recursive: true });
  await copyFile(bundlePath, path.join(projectRoot, bundleDestinationRelative));
  await mkdir(importDestination, { recursive: true });
  for (const name of ["README.md", "SESSION_NOTES.md", "postcards_manifest.json", "postcards_manifest.csv"]) {
    await copyFile(path.join(sourceRoot, name), path.join(importDestination, name));
  }
  await mkdir(path.join(projectRoot, "research/raw"), { recursive: true });
  await copyFile(
    path.join(sourceRoot, "SESSION_RESEARCH.md"),
    path.join(projectRoot, "research/raw", `${importId}.md`),
  );

  const mergedSnapshots = {
    postcards: { ...postcardArchive, postcards },
    context: { schema_version: 1, records: contexts },
    friends,
    imports: {
      ...importArchive,
      imports: [...importArchive.imports, newImport],
    },
  };
  await backupDatabase(defaultDatabasePath);
  const database = await openDatabase(defaultDatabasePath);
  try {
    replaceDatabaseFromSnapshots(database, mergedSnapshots);
  } finally {
    database.close();
  }

  await writeJsonAtomic(postcardsPath, mergedSnapshots.postcards);
  await writeJsonAtomic(contextsPath, mergedSnapshots.context);
  await writeJsonAtomic(friendsPath, mergedSnapshots.friends);
  await writeJsonAtomic(importsPath, mergedSnapshots.imports);

  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function parseArgs(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function findNamedFile(directory, name) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return target;
    if (entry.isDirectory()) {
      const nested = await findNamedFile(target, name);
      if (nested) return nested;
    }
  }
  return null;
}

async function collectFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await collectFiles(target)));
    else if (entry.isFile()) output.push(target);
  }
  return output;
}

function normalizedExtension(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".jpg" ? ".jpeg" : extension;
}

function mediaType(extension) {
  return extension === ".png" ? "image/png" : "image/jpeg";
}

function nextNumericId(records, prefix) {
  return (
    Math.max(
      0,
      ...records.map((record) => Number.parseInt(record.id.replace(prefix, ""), 10) || 0),
    ) + 1
  );
}

function provenanceFor(source, importId, bundleSha256) {
  return {
    source_session: importId,
    source_sequence: source.sequence,
    source_bundle: `imports/source-bundles/${importId}.zip`,
    source_bundle_sha256: bundleSha256,
    source_screenshot: source.screenshot_path,
    original_filename: source.original_filename,
    byte_identical_occurrence_group: source.byte_identical_occurrence_group,
    screenshot_notes: source.screenshot_notes,
    research_status: source.research_status,
  };
}

function parseRating(raw) {
  if (!raw) return { value: null, range: null };
  const values = String(raw)
    .split("～")
    .map((part) => (part.match(/★/g)?.length ?? 0) + (part.includes("½") ? 0.5 : 0));
  return {
    value: values[0] || null,
    range: values.length > 1 ? [Math.min(...values), Math.max(...values)] : null,
  };
}

function inferStatus(recommendation, rating) {
  if (recommendation) {
    if (/可留但偏刪|先不要急著刪|偏留|可犧牲|可被|取代|候補|待定/.test(recommendation)) {
      return "candidate";
    }
    if (/代表/.test(recommendation)) return "representative";
    if (/偏刪|刪除|不留|淘汰/.test(recommendation)) return "delete";
    if (/一定留|核心|按星|^留/.test(recommendation)) return "keep";
  }
  if (rating == null) return "unreviewed";
  if (rating >= 4) return "keep";
  if (rating >= 3.5) return "candidate";
  return "delete";
}

function normalizeConfidence(value) {
  if (value === "high") return "high";
  if (value === "medium-high") return "medium-high";
  if (value === "medium") return "medium";
  if (value === "low") return "low";
  return "unknown";
}

function confidenceLabel(value) {
  return {
    high: "高",
    "medium-high": "中高",
    medium: "中",
    low: "低",
    not_recovered: "未復原",
  }[value] ?? "未知";
}

function addRelation(record, target, relationship) {
  record.related_postcards ??= [];
  if (!record.related_postcards.some((item) => item.id === target.id && item.relationship === relationship)) {
    record.related_postcards.push({ id: target.id, relationship });
  }
}

function rebuildRelations(postcards) {
  for (const postcard of postcards) postcard.related_postcards ??= [];
  const groups = new Map();
  for (const postcard of postcards) {
    const key = metadataKey(postcard);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(postcard);
  }

  const pairKeys = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        if (group[left].asset.sha256 === group[right].asset.sha256) continue;
        addRelation(group[left], group[right], "same-metadata-different-image");
        addRelation(group[right], group[left], "same-metadata-different-image");
        pairKeys.add([group[left].id, group[right].id].sort().join("|"));
      }
    }
  }

  const aliasGroups = new Map();
  for (const postcard of postcards) {
    const poi = postcard.poi_name
      .normalize("NFC")
      .trim()
      .replace(/^t(?=字管猴$)/i, "丁")
      .toLocaleLowerCase("zh-Hant");
    const senderIdentity = postcard.sender
      ? `sender:${postcard.sender}`
      : `origin:${postcard.acquisition.type}:${postcard.acquisition.sender_status}`;
    const key = [poi, postcard.found_date ?? "", senderIdentity, postcard.location.raw ?? ""].join("|");
    if (!aliasGroups.has(key)) aliasGroups.set(key, []);
    aliasGroups.get(key).push(postcard);
  }
  for (const group of aliasGroups.values()) {
    if (group.length !== 2 || group[0].poi_name === group[1].poi_name) continue;
    addRelation(group[0], group[1], "same-poi-name-variant");
    addRelation(group[1], group[0], "same-poi-name-variant");
    pairKeys.add(group.map((record) => record.id).sort().join("|"));
  }
  return pairKeys.size;
}
