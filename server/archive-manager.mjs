import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateAcquisition } from "../lib/acquisition.mjs";
import { researchedLocationDisplay, validateLocationNaming } from "../lib/location-names.mjs";
import { backupDatabase, defaultDatabasePath, openDatabase, projectRoot } from "../db/database.mjs";
import { loadSnapshots, replaceDatabaseFromSnapshots, writeSnapshots } from "../db/snapshots.mjs";
import { readUploadSource, stageImage } from "./image-intake.mjs";
import {
  buildResearchPrompt,
  createBackgroundResearch,
  defaultResearchModel,
  extractResearchResult,
  retrieveBackgroundResearch,
} from "./openai-research.mjs";

const skillRelativePath = ".agents/skills/pikmin-postcard-intake/SKILL.md";
const skillPath = path.join(projectRoot, skillRelativePath);
const terminalStatuses = new Set(["completed", "failed"]);
let mutationChain = Promise.resolve();

export async function archiveOverview({
  snapshotDirectory,
  databasePath = defaultDatabasePath,
} = {}) {
  const snapshots = await loadSnapshots(snapshotDirectory);
  const all = snapshots.postcards.postcards;
  const database = await operationalDatabase(databasePath, snapshotDirectory);
  let jobs;
  try {
    jobs = database.prepare(`
      SELECT * FROM ai_jobs
      WHERE status NOT IN ('completed', 'failed')
      ORDER BY created_at DESC
      LIMIT 10
    `).all().map(normalizeJobRow).map(publicJob);
  } finally {
    database.close();
  }
  return {
    postcards: all.filter((record) => !record.lifecycle?.deleted_at),
    totals: {
      active: all.filter((record) => !record.lifecycle?.deleted_at).length,
      deleted: all.filter((record) => record.lifecycle?.deleted_at).length,
    },
    capabilities: {
      management: true,
      ai_configured: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.PIKMIN_OPENAI_MODEL ?? defaultResearchModel,
    },
    jobs,
  };
}

export async function softDeletePostcard(postcardId, reason = "使用者由網站移除", {
  snapshotDirectory,
  databasePath = defaultDatabasePath,
} = {}) {
  return serializeMutation(async () => {
    const snapshots = await loadSnapshots(snapshotDirectory);
    const record = snapshots.postcards.postcards.find((item) => item.id === postcardId);
    if (!record) throw httpError(404, `找不到明信片 ${postcardId}`);
    if (record.lifecycle?.deleted_at) return record;
    const deletedAt = new Date().toISOString();
    record.lifecycle = { status: "deleted", deleted_at: deletedAt, deleted_reason: reason };
    await persistSnapshots(snapshots, { snapshotDirectory, databasePath });
    return record;
  });
}

export async function startReresearchJob(postcardId) {
  const apiKey = requireApiKey();
  const snapshots = await loadSnapshots();
  const postcard = snapshots.postcards.postcards.find((record) => record.id === postcardId && !record.lifecycle?.deleted_at);
  if (!postcard) throw httpError(404, `找不到可研究的明信片 ${postcardId}`);
  const database = await operationalDatabase();
  let job;
  try {
    const candidates = relatedCandidates(database, postcard);
    const skill = await readFile(skillPath, "utf8");
    const prompt = buildResearchPrompt({ kind: "reresearch", postcard, relatedCandidates: candidates });
    job = insertJob(database, {
      kind: "reresearch",
      postcardId,
      intakeSha256: postcard.asset.sha256,
      skill,
      prompt,
    });
  } finally {
    database.close();
  }
  const imageBytes = await readFile(path.join(projectRoot, `public${postcard.asset.path}`));
  return dispatchJob(job, { apiKey, imageBytes, mediaType: postcard.asset.media_type ?? "image/png" });
}

/** @param {{ file?: File | null, sourceUrl?: string | null, note?: string }} input */
export async function startAddJob({ file = null, sourceUrl = null, note = "" }) {
  const source = await readUploadSource({ file, sourceUrl });
  const database = await operationalDatabase();
  let staged;
  try {
    staged = await stageImage(source, database);
    if (staged.canonicalPostcardId) {
      const skill = await readFile(skillPath, "utf8");
      const prompt = buildResearchPrompt({ kind: "add", intakeNote: note, relatedCandidates: [] });
      return insertJob(database, {
        kind: "add",
        postcardId: staged.canonicalPostcardId,
        intakeSha256: staged.sha256,
        skill,
        prompt,
        status: "completed",
        result: { exact_duplicate: true, postcard_id: staged.canonicalPostcardId },
      });
    }
  } finally {
    database.close();
  }

  const apiKey = requireApiKey("圖片已安全保存在本機 intake；設定 API key 後可再次送出完成分析");
  const skill = await readFile(skillPath, "utf8");
  const prompt = buildResearchPrompt({ kind: "add", intakeNote: note, relatedCandidates: [] });
  const jobDatabase = await operationalDatabase();
  let job;
  try {
    job = insertJob(jobDatabase, {
      kind: "add",
      postcardId: null,
      intakeSha256: staged.sha256,
      skill,
      prompt,
    });
  } finally {
    jobDatabase.close();
  }
  return dispatchJob(job, { apiKey, imageBytes: staged.bytes, mediaType: staged.mediaType });
}

export async function getJob(jobId, { refresh = true } = {}) {
  const database = await operationalDatabase();
  let job;
  try {
    job = selectJob(database, jobId);
  } finally {
    database.close();
  }
  if (!job) throw httpError(404, `找不到工作 ${jobId}`);
  if (!refresh || terminalStatuses.has(job.status) || job.status === "applying" || !job.openai_response_id) return job;

  let response;
  try {
    response = await retrieveBackgroundResearch({ apiKey: requireApiKey(), responseId: job.openai_response_id });
  } catch (error) {
    await markJobFailed(job.id, error);
    return getJob(job.id, { refresh: false });
  }

  if (["queued", "in_progress"].includes(response.status)) {
    const status = response.status === "queued" ? "queued" : "in_progress";
    await updateJob(job.id, { status });
    return getJob(job.id, { refresh: false });
  }
  if (response.status !== "completed") {
    await markJobFailed(job.id, new Error(`OpenAI 工作終止：${response.status}`));
    return getJob(job.id, { refresh: false });
  }

  try {
    const result = extractResearchResult(response);
    return await serializeMutation(() => applyCompletedJob(job.id, result));
  } catch (error) {
    await markJobFailed(job.id, error);
    return getJob(job.id, { refresh: false });
  }
}

export function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    postcard_id: job.postcard_id,
    model: job.model,
    result: job.result,
    error: job.error,
    created_at: job.created_at,
    started_at: job.started_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
  };
}

async function dispatchJob(job, { apiKey, imageBytes, mediaType }) {
  try {
    const response = await createBackgroundResearch({
      apiKey,
      model: job.model,
      skill: await readFile(skillPath, "utf8"),
      prompt: job.prompt,
      imageBytes,
      mediaType,
    });
    await updateJob(job.id, {
      status: response.status === "queued" ? "queued" : "in_progress",
      responseId: response.id,
      startedAt: new Date().toISOString(),
    });
    return getJob(job.id, { refresh: false });
  } catch (error) {
    await markJobFailed(job.id, error);
    throw error;
  }
}

async function applyCompletedJob(jobId, result) {
  const claimDatabase = await operationalDatabase();
  let claimed;
  try {
    claimed = claimDatabase.prepare(`
      UPDATE ai_jobs SET status = 'applying', updated_at = ?
      WHERE id = ? AND status IN ('queued', 'in_progress')
    `).run(new Date().toISOString(), jobId).changes;
  } finally {
    claimDatabase.close();
  }
  if (!claimed) return getJob(jobId, { refresh: false });

  const snapshots = await loadSnapshots();
  const jobDatabase = await operationalDatabase();
  const row = selectJob(jobDatabase, jobId);
  jobDatabase.close();
  if (!row) throw new Error(`找不到工作 ${jobId}`);
  const applied = row.kind === "reresearch"
    ? await applyReresearch(snapshots, row, result)
    : await applyAdd(snapshots, row, result);
  await persistSnapshots(snapshots);
  await updateJob(jobId, {
    status: "completed",
    postcardId: applied.id,
    result,
    completedAt: new Date().toISOString(),
  });
  return getJob(jobId, { refresh: false });
}

async function applyReresearch(snapshots, job, result) {
  const record = snapshots.postcards.postcards.find((item) => item.id === job.postcard_id);
  if (!record || record.lifecycle?.deleted_at) throw new Error("再研究目標已不存在或已刪除");
  const location = normalizedLocation(result.location, record.location.raw);
  validateResult(result, location);
  const allowedCandidates = relatedCandidatesFromSnapshots(snapshots, record);
  const previousDetailPath = record.research.detail.source_path;
  const sourcePath = await writeResearchFile(record.id, job.id, result);
  record.location = location;
  record.research = normalizedResearch(result.research, sourcePath);
  record.research.status = `ui-reresearched-${localDate()}`;
  record.curation = {
    ...record.curation,
    rating: result.curation.rating,
    recommendation: result.curation.recommendation,
    status: result.curation.status,
    personal_relevance: result.curation.personal_relevance ?? record.curation.personal_relevance ?? null,
    tags: uniqueStrings(result.curation.tags),
  };
  record.provenance ??= [];
  record.provenance.push({
    source_session: `ui-reresearch-${localDate()}`,
    source_screenshot: record.provenance[0]?.source_screenshot ?? record.asset.path,
    original_filename: record.asset.original_filename ?? null,
    screenshot_notes: `再研究前的研究檔仍保留於 ${previousDetailPath}`,
    research_status: `ui-reresearched-${localDate()}`,
  });
  applyRelations(snapshots.postcards.postcards, record, result.related_postcards, allowedCandidates);
  return record;
}

async function applyAdd(snapshots, job, result) {
  const database = await operationalDatabase();
  let intake;
  try {
    intake = database.prepare(`
      SELECT image_intake.*,
             (
               SELECT original_filename
               FROM image_intake_sources
               WHERE intake_sha256 = image_intake.sha256
               ORDER BY last_seen_at DESC, id DESC
               LIMIT 1
             ) AS original_filename
      FROM image_intake
      WHERE sha256 = ?
    `).get(job.intake_sha256);
  } finally {
    database.close();
  }
  if (!intake) throw new Error("新增工作的 intake 圖片不存在");
  const id = nextPostcardId(snapshots.postcards.postcards);
  const date = localDate();
  const foundDate = result.visible.found_date;
  const location = normalizedLocation(result.location, result.visible.game_location);
  const acquisition = result.acquisition;
  const sender = result.visible.sender;
  validateResult(result, location);
  validateAcquisition({ id, sender, acquisition });
  const folderDate = foundDate ?? date;
  const [year, month] = folderDate.split("-");
  const publicRelative = `/images/postcards/${year}/${month}/${id}${intake.file_extension}`;
  const publicPath = path.join(projectRoot, `public${publicRelative}`);
  await mkdir(path.dirname(publicPath), { recursive: true });
  try {
    await copyFile(path.join(projectRoot, intake.local_path), publicPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existingHash = createHash("sha256").update(await readFile(publicPath)).digest("hex");
    if (existingHash !== job.intake_sha256) {
      throw new Error(`canonical 圖片路徑已有不同內容，未覆寫：${publicRelative}`);
    }
  }

  const sourcePath = await writeResearchFile(id, job.id, result);
  const record = {
    id,
    poi_name: result.visible.poi_name,
    found_date: foundDate,
    received_at: null,
    archived_on: date,
    sender,
    location,
    asset: {
      path: publicRelative,
      sha256: job.intake_sha256,
      bytes: intake.bytes,
      media_type: intake.media_type,
      original_filename: intake.original_filename,
    },
    curation: {
      rating: result.curation.rating,
      recommendation: result.curation.recommendation,
      status: result.curation.status,
      tags: uniqueStrings(result.curation.tags),
      personal_relevance: result.curation.personal_relevance,
    },
    research: normalizedResearch(result.research, sourcePath),
    provenance: [{
      source_session: `ui-intake-${date}`,
      source_screenshot: intake.local_path,
      original_filename: intake.original_filename,
      screenshot_notes: uniqueStrings(result.visible.screenshot_notes).join("；") || null,
      research_status: `ui-researched-${date}`,
    }],
    related_postcards: [],
    acquisition,
  };
  const matches = snapshots.postcards.postcards.filter((existing) => (
    !existing.lifecycle?.deleted_at
    && existing.poi_name === record.poi_name
    && existing.found_date === record.found_date
    && existing.location.raw === record.location.raw
    && existing.sender === record.sender
    && existing.acquisition.type === record.acquisition.type
  ));
  snapshots.postcards.postcards.push(record);
  for (const match of matches) addSymmetricRelation(record, match, {
    relationship: "same-metadata-different-image",
    note: "POI、發現日期、遊戲地點與來源身分相同，但匯入圖片的 SHA-256 不同。",
  });
  return record;
}

function normalizedLocation(input, raw) {
  const location = {
    raw: raw?.trim() || input.raw.trim(),
    display: "",
    city: input.city,
    district: input.district,
    locality: input.locality,
    region: input.region,
    county: input.county,
    country: input.country,
    country_code: input.country_code,
    latitude: input.latitude,
    longitude: input.longitude,
    normalization_confidence: input.normalization_confidence,
    endonym: input.endonym.trim(),
    zh_tw: input.zh_tw,
    language: input.language.trim(),
    name_status: input.name_status,
    name_confidence: input.name_confidence,
    country_endonym: input.country_endonym.trim(),
    address_local: input.address_local.trim(),
    precision: input.precision,
  };
  location.display = researchedLocationDisplay(location);
  return location;
}

function normalizedResearch(input, sourcePath) {
  return {
    status: `ui-researched-${localDate()}`,
    confidence: input.confidence,
    confidence_label: input.confidence_label,
    summary: input.summary.trim(),
    sources: uniqueStrings(input.sources).filter(validHttpUrl),
    confirmed_facts: uniqueStrings(input.confirmed_facts),
    inferences: uniqueStrings(input.inferences),
    unresolved_questions: uniqueStrings(input.unresolved_questions),
    detail: {
      status: "structured_preserved",
      body: input.detail_body.trim(),
      source_path: sourcePath,
      preservation_note: null,
    },
  };
}

function validateResult(result, location) {
  if (!result?.research?.summary?.trim() || !result.research.detail_body?.trim()) throw new Error("AI 研究結果缺少摘要或長版研究");
  if (result.research.detail_body.trim().length < result.research.summary.trim().length) throw new Error("長版研究不可短於摘要");
  const locationErrors = validateLocationNaming(location);
  if (locationErrors.length) throw new Error(`研究定位未通過規則：${locationErrors.join("；")}`);
  if (result.curation.rating != null && (result.curation.rating < 0 || result.curation.rating > 5)) throw new Error("收藏評分必須介於 0–5");
  const sources = uniqueStrings(result.research.sources);
  if (!sources.length || !sources.every(validHttpUrl)) throw new Error("研究來源缺漏或含有無效網址");
  const coordinates = [location.latitude, location.longitude];
  if (coordinates.some((value) => value != null) && coordinates.some((value) => value == null)) throw new Error("緯度與經度必須同時存在");
  if (location.latitude != null && (location.latitude < -90 || location.latitude > 90)) throw new Error("緯度超出有效範圍");
  if (location.longitude != null && (location.longitude < -180 || location.longitude > 180)) throw new Error("經度超出有效範圍");
}

async function writeResearchFile(postcardId, jobId, result) {
  const date = localDate();
  const relative = `research/raw/${postcardId}-ui-research-${date}-${jobId.slice(-8)}.md`;
  const target = path.join(projectRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  const body = [
    `# ${result.visible.poi_name}`,
    "",
    `- 研究日期：${date}`,
    `- UI 工作：${jobId}`,
    "",
    result.research.detail_body.trim(),
    "",
    "## 已確認事實",
    ...uniqueStrings(result.research.confirmed_facts).map((value) => `- ${value}`),
    "",
    "## 推論",
    ...uniqueStrings(result.research.inferences).map((value) => `- ${value}`),
    "",
    "## 未解問題",
    ...uniqueStrings(result.research.unresolved_questions).map((value) => `- ${value}`),
    "",
    "## Sources",
    ...uniqueStrings(result.research.sources).map((value) => `- ${value}`),
    "",
  ].join("\n");
  const temporary = `${target}.tmp`;
  await writeFile(temporary, body, "utf8");
  await rename(temporary, target);
  return relative;
}

function applyRelations(postcards, record, proposed, allowedCandidates) {
  const allowed = new Set(allowedCandidates.map((candidate) => candidate.id));
  const byId = new Map(postcards.map((item) => [item.id, item]));
  for (const relation of proposed ?? []) {
    if (!allowed.has(relation.id) || !relation.note?.trim() || relation.note.trim().length > 240) continue;
    const related = byId.get(relation.id);
    if (related && !related.lifecycle?.deleted_at) addSymmetricRelation(record, related, relation);
  }
}

function addSymmetricRelation(left, right, relation) {
  upsertRelation(left, { id: right.id, relationship: relation.relationship, note: relation.note });
  upsertRelation(right, { id: left.id, relationship: relation.relationship, note: relation.note });
}

function upsertRelation(record, relation) {
  record.related_postcards ??= [];
  const index = record.related_postcards.findIndex((item) => item.id === relation.id && item.relationship === relation.relationship);
  if (index === -1) record.related_postcards.push(relation);
  else record.related_postcards[index] = relation;
}

function relatedCandidates(database, postcard) {
  return database.prepare(`
    SELECT id, poi_name, found_date, sender, location_raw, location_display,
           curation_status, research_summary
    FROM postcards
    WHERE id <> ? AND deleted_at IS NULL AND (
      poi_name = ? OR location_raw = ? OR location_display = ?
      OR (location_country = ? AND sender IS ?)
    )
    ORDER BY
      CASE WHEN poi_name = ? THEN 0 WHEN location_raw = ? THEN 1 WHEN location_display = ? THEN 2 ELSE 3 END,
      found_date DESC
    LIMIT 8
  `).all(
    postcard.id,
    postcard.poi_name,
    postcard.location.raw,
    postcard.location.display,
    postcard.location.country,
    postcard.sender,
    postcard.poi_name,
    postcard.location.raw,
    postcard.location.display,
  ).map((row) => ({
    id: row.id,
    poi_name: row.poi_name,
    found_date: row.found_date,
    sender: row.sender,
    location_raw: row.location_raw,
    location_display: row.location_display,
    curation_status: row.curation_status,
    research_summary: row.research_summary.slice(0, 320),
  }));
}

function relatedCandidatesFromSnapshots(snapshots, record) {
  const databaseCandidates = snapshots.postcards.postcards.filter((candidate) => (
    candidate.id !== record.id
    && !candidate.lifecycle?.deleted_at
    && (
      candidate.poi_name === record.poi_name
      || candidate.location.raw === record.location.raw
      || candidate.location.display === record.location.display
      || (candidate.location.country === record.location.country && candidate.sender === record.sender)
    )
  ));
  return databaseCandidates.slice(0, 8);
}

async function operationalDatabase(databasePath = defaultDatabasePath, snapshotDirectory) {
  const database = await openDatabase(databasePath);
  const count = database.prepare("SELECT count(*) AS count FROM postcards").get().count;
  if (count === 0) replaceDatabaseFromSnapshots(database, await loadSnapshots(snapshotDirectory));
  return database;
}

function insertJob(database, { kind, postcardId, intakeSha256, skill, prompt, status = "queued", result = null }) {
  const now = new Date().toISOString();
  const id = `job-${randomUUID()}`;
  database.prepare(`
    INSERT INTO ai_jobs (
      id, kind, status, postcard_id, intake_sha256, model, skill_path, skill_sha256,
      prompt, result_json, created_at, started_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    kind,
    status,
    postcardId,
    intakeSha256,
    process.env.PIKMIN_OPENAI_MODEL ?? defaultResearchModel,
    skillRelativePath,
    sha256(skill),
    prompt,
    result == null ? null : JSON.stringify(result),
    now,
    status === "completed" ? now : null,
    now,
    status === "completed" ? now : null,
  );
  return selectJob(database, id);
}

async function updateJob(id, fields) {
  const database = await operationalDatabase();
  try {
    const current = selectJob(database, id);
    if (!current) throw new Error(`找不到工作 ${id}`);
    const next = {
      status: fields.status ?? current.status,
      postcardId: fields.postcardId ?? current.postcard_id,
      responseId: fields.responseId ?? current.openai_response_id,
      result: fields.result ?? current.result,
      error: fields.error ?? current.error,
      startedAt: fields.startedAt ?? current.started_at,
      completedAt: fields.completedAt ?? current.completed_at,
    };
    database.prepare(`
      UPDATE ai_jobs SET
        status = ?, postcard_id = ?, openai_response_id = ?, result_json = ?, error = ?,
        started_at = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(
      next.status,
      next.postcardId,
      next.responseId,
      next.result == null ? null : JSON.stringify(next.result),
      next.error,
      next.startedAt,
      new Date().toISOString(),
      next.completedAt,
      id,
    );
  } finally {
    database.close();
  }
}

async function markJobFailed(id, error) {
  await updateJob(id, {
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    completedAt: new Date().toISOString(),
  });
}

function selectJob(database, id) {
  const row = database.prepare("SELECT * FROM ai_jobs WHERE id = ?").get(id);
  return normalizeJobRow(row);
}

function normalizeJobRow(row) {
  if (!row) return null;
  return { ...row, result: row.result_json ? JSON.parse(row.result_json) : null };
}

async function persistSnapshots(snapshots, {
  snapshotDirectory,
  databasePath = defaultDatabasePath,
} = {}) {
  await backupDatabase(databasePath);
  const database = await openDatabase(databasePath);
  try {
    replaceDatabaseFromSnapshots(database, snapshots);
  } finally {
    database.close();
  }
  await writeSnapshots(snapshots, snapshotDirectory);
}

function nextPostcardId(postcards) {
  const max = postcards.reduce((value, record) => Math.max(value, Number.parseInt(record.id.replace(/^pc-/, ""), 10) || 0), 0);
  return `pc-${String(max + 1).padStart(4, "0")}`;
}

function localDate() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function validHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireApiKey(suffix = "") {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  throw httpError(503, ["OPENAI_API_KEY 尚未設定", suffix].filter(Boolean).join("；"));
}

function serializeMutation(action) {
  const pending = mutationChain.then(action, action);
  mutationChain = pending.catch(() => {});
  return pending;
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
