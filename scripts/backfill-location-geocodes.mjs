#!/usr/bin/env node

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { backupDatabase, defaultDatabasePath, openDatabase, projectRoot } from "../db/database.mjs";
import { loadSnapshots, replaceDatabaseFromSnapshots, writeSnapshots } from "../db/snapshots.mjs";
import { searchNominatim } from "../server/geocoding.mjs";
import { backfillPostcardLocations } from "../server/location-backfill.mjs";

const commit = process.argv.includes("--commit");
const selectedIds = new Set((argument("--id") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const limit = positiveInteger(argument("--limit"));
const cachePath = path.resolve(argument("--cache") ?? path.join(projectRoot, "var/location-geocode-cache.json"));
const reportPath = path.resolve(argument("--report") ?? path.join(projectRoot, "var/location-backfill-report.json"));
const originalSnapshots = await loadSnapshots();
const candidateSnapshots = structuredClone(originalSnapshots);
let targets = candidateSnapshots.postcards.postcards.filter((record) => !selectedIds.size || selectedIds.has(record.id));
if (limit) targets = targets.slice(0, limit);
if (!targets.length) throw new Error("沒有符合條件的明信片");

const cachedFetch = await createCachedFetch(cachePath);
const commonOptions = {
  fetchImpl: cachedFetch,
  respectRateLimit: false,
};
const report = await backfillPostcardLocations(targets, {
  searchCandidate: ({ location, query }) => searchNominatim(query, {
    ...commonOptions,
    countryCode: location.country_code,
    language: location.language,
  }),
  searchAddress: ({ location, query }) => searchNominatim(query, {
    ...commonOptions,
    countryCode: location.country_code,
    language: location.language,
  }),
  searchTranslation: ({ location, query }) => searchNominatim(query, {
    ...commonOptions,
    countryCode: location.country_code,
    language: "zh-TW",
  }),
  onProgress: async (entry, state) => {
    process.stdout.write(`${state.processed}/${targets.length} ${entry.id} ${entry.provider ?? "unresolved"}${entry.address_upgraded ? " address-upgraded" : ""}\n`);
  },
});
report.generated_at = new Date().toISOString();
report.mode = commit ? "commit" : "dry-run";
report.total_archive_records = candidateSnapshots.postcards.postcards.length;
report.target_records = targets.length;
if (targets.length === candidateSnapshots.postcards.postcards.length) {
  await verifyCandidateSnapshots(candidateSnapshots);
  report.snapshot_database_verification = "passed";
}
await writeJsonAtomic(reportPath, report);

if (commit) {
  candidateSnapshots.postcards.schema_version = Math.max(candidateSnapshots.postcards.schema_version ?? 1, 6);
  const backup = await backupDatabase(defaultDatabasePath);
  const database = await openDatabase(defaultDatabasePath);
  try {
    await writeSnapshots(candidateSnapshots);
    replaceDatabaseFromSnapshots(database, candidateSnapshots);
  } catch (error) {
    await writeSnapshots(originalSnapshots);
    throw error;
  } finally {
    database.close();
  }
  report.backup = backup;
  await writeJsonAtomic(reportPath, report);
}

console.log(JSON.stringify({
  mode: report.mode,
  processed: report.processed,
  resolved: report.resolved,
  unresolved: report.unresolved,
  address_upgraded: report.address_upgraded,
  normalized: report.normalized,
  protected_coordinates: report.protected_coordinates,
  cache: cachePath,
  report: reportPath,
  backup: report.backup ?? null,
}, null, 2));

async function verifyCandidateSnapshots(snapshots) {
  const verificationPath = path.join(path.dirname(defaultDatabasePath), `.location-backfill-${process.pid}.sqlite3`);
  const verificationDatabase = await openDatabase(verificationPath);
  try {
    replaceDatabaseFromSnapshots(verificationDatabase, snapshots);
    if (verificationDatabase.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") {
      throw new Error("回填後的驗證資料庫未通過 integrity_check");
    }
  } finally {
    verificationDatabase.close();
    await rm(verificationPath, { force: true });
    await rm(`${verificationPath}-shm`, { force: true });
    await rm(`${verificationPath}-wal`, { force: true });
  }
}

async function createCachedFetch(target) {
  const cache = await readJsonOptional(target) ?? { format: "pikmin-location-geocoder-cache-v1", entries: {} };
  if (cache.format !== "pikmin-location-geocoder-cache-v1" || typeof cache.entries !== "object") {
    throw new Error(`不支援的 geocoder cache：${target}`);
  }
  let lastNetworkRequestAt = 0;
  return async (url, options) => {
    const key = String(url);
    const hit = cache.entries[key];
    if (hit) return Response.json(hit.payload, { status: 200 });
    const remaining = Math.max(0, 1_100 - (Date.now() - lastNetworkRequestAt));
    if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining));
    lastNetworkRequestAt = Date.now();
    const response = await fetch(url, options);
    const text = await response.text();
    if (!response.ok) return new Response(text, { status: response.status, headers: response.headers });
    const payload = JSON.parse(text);
    cache.entries[key] = { retrieved_at: new Date().toISOString(), payload };
    await writeJsonAtomic(target, cache);
    return Response.json(payload, { status: 200 });
  };
}

async function readJsonOptional(target) {
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function positiveInteger(value) {
  if (value == null) return null;
  const numeric = Number.parseInt(value, 10);
  if (!Number.isInteger(numeric) || numeric < 1) throw new Error("--limit 必須是正整數");
  return numeric;
}
