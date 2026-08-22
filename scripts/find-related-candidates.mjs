import path from "node:path";
import { defaultDatabasePath, openDatabase } from "../db/database.mjs";

const postcardId = argument("--id");
if (!postcardId) {
  throw new Error("Usage: npm run related:candidates -- --id pc-XXXX [--limit 8] [--database path]");
}

const requestedLimit = Number.parseInt(argument("--limit") ?? "8", 10);
if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error("--limit must be a positive integer");
}

const limit = Math.min(requestedLimit, 12);
const perSignalLimit = Math.max(limit * 2, 12);
const databasePath = argument("--database")
  ? path.resolve(argument("--database"))
  : defaultDatabasePath;
const database = await openDatabase(databasePath);

try {
  const source = database.prepare(`
    SELECT id, poi_name, found_date, sender, location_raw, location_display, latitude, longitude
    FROM postcards
    WHERE id = ?
  `).get(postcardId);
  if (!source) throw new Error(`Unknown postcard id: ${postcardId}`);

  const candidates = new Map();
  const addSignal = (id, points, type, detail = null, existingRelation = null) => {
    if (id === source.id) return;
    const candidate = candidates.get(id) ?? {
      id,
      score: 0,
      signals: [],
      existing_relation: null,
    };
    if (!candidate.signals.some((signal) => signal.type === type && (signal.detail ?? null) === detail)) {
      candidate.score += points;
      candidate.signals.push({ type, points, ...(detail ? { detail } : {}) });
    }
    if (existingRelation) candidate.existing_relation = existingRelation;
    candidates.set(id, candidate);
  };

  for (const row of database.prepare(`
    SELECT related_postcard_id AS id, relationship, note
    FROM postcard_relations
    WHERE postcard_id = ?
    ORDER BY related_postcard_id
    LIMIT ?
  `).all(source.id, perSignalLimit)) {
    addSignal(row.id, 12, "existing-relation", row.relationship, {
      relationship: row.relationship,
      note: row.note,
    });
  }

  addExactMatches(database, source, "poi_name", "same-poi", 8, perSignalLimit, addSignal);
  addExactMatches(database, source, "location_raw", "same-raw-location", 5, perSignalLimit, addSignal);
  addExactMatches(database, source, "location_display", "same-display-location", 4, perSignalLimit, addSignal);

  if (source.sender) {
    const rows = database.prepare(`
      SELECT id, found_date
      FROM postcards
      WHERE sender = ? AND id <> ?
      ORDER BY found_date DESC, id
      LIMIT ?
    `).all(source.sender, source.id, perSignalLimit);
    for (const row of rows) {
      addSignal(row.id, 1, "same-sender", source.sender);
      if (source.found_date && row.found_date === source.found_date) {
        addSignal(row.id, 3, "same-sender-date", source.found_date);
      }
    }
  }

  for (const row of database.prepare(`
    SELECT candidate.postcard_id AS id, candidate.tag
    FROM postcard_tags AS source_tag
    JOIN postcard_tags AS candidate ON candidate.tag = source_tag.tag
    WHERE source_tag.postcard_id = ? AND candidate.postcard_id <> ?
    ORDER BY candidate.tag, candidate.postcard_id
    LIMIT ?
  `).all(source.id, source.id, perSignalLimit)) {
    addSignal(row.id, 2, "shared-tag", row.tag);
  }

  for (const row of database.prepare(`
    SELECT candidate.postcard_id AS id, candidate.url
    FROM research_sources AS source_url
    JOIN research_sources AS candidate ON candidate.url = source_url.url
    WHERE source_url.postcard_id = ? AND candidate.postcard_id <> ?
    ORDER BY candidate.url, candidate.postcard_id
    LIMIT ?
  `).all(source.id, source.id, perSignalLimit)) {
    addSignal(row.id, 3, "shared-research-source", row.url);
  }

  if (source.latitude != null && source.longitude != null) {
    const coordinateWindow = 0.02;
    for (const row of database.prepare(`
      SELECT id, latitude, longitude
      FROM postcards
      WHERE latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
        AND id <> ?
      ORDER BY abs(latitude - ?) + abs(longitude - ?), id
      LIMIT ?
    `).all(
      source.latitude - coordinateWindow,
      source.latitude + coordinateWindow,
      source.longitude - coordinateWindow,
      source.longitude + coordinateWindow,
      source.id,
      source.latitude,
      source.longitude,
      perSignalLimit,
    )) {
      addSignal(row.id, 6, "nearby-coordinates", approximateDistance(source, row));
    }
  }

  const ranked = [...candidates.values()]
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);
  const details = loadCandidateDetails(database, ranked.map((candidate) => candidate.id));
  const detailById = new Map(details.map((record) => [record.id, record]));

  console.log(JSON.stringify({
    source: {
      id: source.id,
      poi_name: source.poi_name,
      found_date: source.found_date,
      sender: source.sender,
      location_raw: source.location_raw,
      location_display: source.location_display,
    },
    policy: {
      exhaustive: false,
      strategy: "bounded-indexed-shortlist",
      candidate_limit: limit,
      per_signal_limit: perSignalLimit,
      suggested_deep_review_limit: Math.min(3, limit),
    },
    candidates: ranked.map((candidate) => ({
      ...detailById.get(candidate.id),
      score: candidate.score,
      signals: candidate.signals,
      existing_relation: candidate.existing_relation,
    })),
  }, null, 2));
} finally {
  database.close();
}

function addExactMatches(database, source, column, type, points, rowLimit, addSignal) {
  const value = source[column];
  if (!value?.trim()) return;
  const allowedColumns = new Set(["poi_name", "location_raw", "location_display"]);
  if (!allowedColumns.has(column)) throw new Error(`Unsupported candidate column: ${column}`);
  const rows = database.prepare(`
    SELECT id
    FROM postcards
    WHERE ${column} = ? AND id <> ?
    ORDER BY found_date DESC, id
    LIMIT ?
  `).all(value, source.id, rowLimit);
  for (const row of rows) addSignal(row.id, points, type, value);
}

function loadCandidateDetails(database, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  return database.prepare(`
    SELECT id, poi_name, found_date, sender, location_raw, location_display, latitude, longitude
    FROM postcards
    WHERE id IN (${placeholders})
  `).all(...ids);
}

function approximateDistance(source, candidate) {
  const latitudeKm = Math.abs(candidate.latitude - source.latitude) * 111;
  const longitudeKm = Math.abs(candidate.longitude - source.longitude)
    * 111
    * Math.cos(source.latitude * Math.PI / 180);
  return `${Math.hypot(latitudeKm, longitudeKm).toFixed(2)} km`;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
