import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateAcquisition } from "../lib/acquisition.mjs";
import { friendEvidenceForPostcard, rebuildFriends } from "../lib/friends.mjs";
import { researchedLocationDisplay, validateLocationNaming } from "../lib/location-names.mjs";
import { normalizeUserContribution } from "../lib/user-contribution.mjs";
import { resolveStoredLocalPath } from "../db/asset-paths.mjs";
import { backupDatabase, defaultDatabasePath, openDatabase, projectRoot } from "../db/database.mjs";
import { exportSnapshots, loadSnapshots, replaceDatabaseFromSnapshots, writeSnapshots } from "../db/snapshots.mjs";
import { readUploadSource, stageImage } from "./image-intake.mjs";
import { ensureFriendAvatars, normalizeAvatarCropHint } from "./friend-avatars.mjs";
import { metadataIntakeFields, pendingResearch } from "./metadata-intake.mjs";
import { runLocalCodexMetadata, runLocalCodexResearch } from "./local-codex.mjs";
import { preserveResearchImages, safeRemoteLocator } from "./research-images.mjs";
import {
  buildResearchPrompt,
  buildMetadataPrompt,
  cancelBackgroundResearch,
  createBackgroundMetadata,
  createBackgroundResearch,
  extractMetadataResult,
  extractResearchResult,
  metadataReasoningEffort,
  retrieveBackgroundResearch,
} from "./openai-research.mjs";
import { researchProviderConfiguration } from "./settings-store.mjs";

const skillRelativePath = ".agents/skills/pikmin-postcard-intake/SKILL.md";
const skillPath = path.join(projectRoot, skillRelativePath);
const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
const addWorkflows = new Set(["metadata_only", "full_research"]);
const dispatchConcurrency = Math.max(1, Math.min(8, Number.parseInt(process.env.PIKMIN_AI_CONCURRENCY ?? "2", 10) || 2));
const dispatchQueue = [];
const activeLocalControllers = new Map();
let activeDispatches = 0;
let mutationChain = Promise.resolve();

export async function archiveOverview({
  snapshotDirectory,
  databasePath = defaultDatabasePath,
} = {}) {
  const database = await operationalDatabase(databasePath, snapshotDirectory);
  let snapshots;
  let jobs;
  try {
    snapshots = exportSnapshots(database);
    jobs = database.prepare(`
      SELECT * FROM ai_jobs
      WHERE status IN ('queued', 'in_progress', 'applying')
      ORDER BY created_at DESC
    `).all().map(normalizeJobRow).map(publicJob);
  } finally {
    database.close();
  }
  const all = snapshots.postcards.postcards;
  const researchProvider = await researchProviderConfiguration();
  return {
    api_version: 1,
    postcards: all.filter((record) => !record.lifecycle?.deleted_at),
    friends: snapshots.friends.profiles,
    totals: {
      active: all.filter((record) => !record.lifecycle?.deleted_at).length,
      deleted: all.filter((record) => record.lifecycle?.deleted_at).length,
    },
    capabilities: {
      management: true,
      ai_configured: researchProvider.ready,
      provider: researchProvider.provider,
      model: researchProvider.model,
      reasoning_effort: researchProvider.reasoning_effort,
    },
    jobs,
  };
}

export async function softDeletePostcard(postcardId, reason = "使用者由網站移除", {
  snapshotDirectory,
  databasePath = defaultDatabasePath,
} = {}) {
  return serializeMutation(async () => {
    const snapshots = await loadOperationalSnapshots(databasePath, snapshotDirectory);
    const record = snapshots.postcards.postcards.find((item) => item.id === postcardId);
    if (!record) throw httpError(404, `找不到明信片 ${postcardId}`);
    if (record.lifecycle?.deleted_at) return record;
    const deletedAt = new Date().toISOString();
    record.lifecycle = { status: "deleted", deleted_at: deletedAt, deleted_reason: reason };
    await persistSnapshots(snapshots, { snapshotDirectory, databasePath });
    return record;
  });
}

/**
 * @param {string} postcardId
 * @param {{ userNote?: unknown }} [options]
 */
export async function startReresearchJob(postcardId, { userNote: rawUserNote = null } = {}) {
  let userNote;
  try {
    userNote = normalizeUserContribution(rawUserNote);
  } catch (error) {
    throw httpError(400, error instanceof Error ? error.message : "使用者補充格式無效");
  }
  const researchProvider = await requireResearchProvider();
  const snapshots = await loadOperationalSnapshots();
  const postcard = snapshots.postcards.postcards.find((record) => record.id === postcardId && !record.lifecycle?.deleted_at);
  if (!postcard) throw httpError(404, `找不到可研究的明信片 ${postcardId}`);
  const database = await operationalDatabase();
  let job;
  try {
    const candidates = relatedCandidates(database, postcard);
    const skill = await readFile(skillPath, "utf8");
    const prompt = buildResearchPrompt({ kind: "reresearch", postcard, userNote, relatedCandidates: candidates });
    job = insertJob(database, {
      kind: "reresearch",
      postcardId,
      intakeSha256: postcard.asset.sha256,
      skill,
      prompt,
      provider: researchProvider.provider,
      model: researchProvider.model,
      reasoningEffort: researchProvider.reasoning_effort,
      userNote,
    });
  } finally {
    database.close();
  }
  queueJobDispatch(job, {
    ...researchProvider,
    imagePath: path.join(projectRoot, `public${postcard.asset.path}`),
    mediaType: postcard.asset.media_type ?? "image/png",
  });
  return job;
}

/** @param {{ inputs: Array<{ file?: File | null, sourceUrl?: string | null, label?: string }>, note?: string, workflow?: "metadata_only" | "full_research" }} input */
export async function startAddBatch({ inputs, note = "", workflow = "metadata_only" }) {
  if (!addWorkflows.has(workflow)) throw httpError(400, "新增模式必須是快速建檔或完整研究");
  if (!Array.isArray(inputs) || !inputs.length) throw httpError(400, "請選擇至少一張圖片，或提供圖片網址");
  const batchId = `batch-${randomUUID()}`;
  const researchProvider = await researchProviderConfiguration();
  const skill = await readFile(skillPath, "utf8");
  const jobs = [];
  const failures = [];
  for (const [index, input] of inputs.entries()) {
    const inputLabel = input.label?.trim() || uploadInputLabel(input, index);
    try {
      jobs.push(await startAddJob({
        file: input.file,
        sourceUrl: input.sourceUrl,
        note,
        workflow,
        batchId,
        inputLabel,
        researchProvider,
        skill,
      }));
    } catch (error) {
      failures.push({
        input_label: inputLabel,
        error: error instanceof Error ? error.message : String(error),
        status: Number.isInteger(error?.status) ? error.status : 400,
      });
    }
  }
  if (!jobs.length) {
    const first = failures[0];
    throw httpError(first?.status ?? 400, first?.error ?? "沒有圖片成功建立工作");
  }
  return { batchId, workflow, jobs, failures, total: inputs.length };
}

/** @param {{ file?: File | null, sourceUrl?: string | null, note?: string, workflow?: "metadata_only" | "full_research", batchId?: string | null, inputLabel?: string | null, researchProvider?: object, skill?: string }} input */
export async function startAddJob({
  file = null,
  sourceUrl = null,
  note = "",
  workflow = "metadata_only",
  batchId = null,
  inputLabel = null,
  researchProvider: providedResearchProvider = null,
  skill: providedSkill = null,
}) {
  if (!addWorkflows.has(workflow)) throw httpError(400, "新增模式必須是快速建檔或完整研究");
  const researchProvider = providedResearchProvider ?? await researchProviderConfiguration();
  const skill = providedSkill ?? await readFile(skillPath, "utf8");
  const source = await readUploadSource({ file, sourceUrl });
  const database = await operationalDatabase();
  let staged;
  try {
    staged = await stageImage(source, database);
    if (staged.canonicalPostcardId) {
      const prompt = workflow === "metadata_only"
        ? buildMetadataPrompt({ intakeNote: note })
        : buildResearchPrompt({ kind: "add", intakeNote: note, relatedCandidates: [] });
      return insertJob(database, {
        kind: "add",
        workflow,
        batchId,
        inputLabel,
        postcardId: staged.canonicalPostcardId,
        intakeSha256: staged.sha256,
        skill,
        prompt,
        provider: researchProvider.provider,
        model: researchProvider.model,
        reasoningEffort: workflow === "metadata_only" ? metadataReasoningEffort : researchProvider.reasoning_effort,
        status: "completed",
        result: { exact_duplicate: true, postcard_id: staged.canonicalPostcardId },
      });
    }
  } finally {
    database.close();
  }

  const readyResearchProvider = await requireResearchProvider(
    "圖片已安全保存在本機 intake；完成 AI provider 設定後可再次送出分析",
    researchProvider,
  );
  const prompt = workflow === "metadata_only"
    ? buildMetadataPrompt({ intakeNote: note })
    : buildResearchPrompt({ kind: "add", intakeNote: note, relatedCandidates: [] });
  const jobDatabase = await operationalDatabase();
  let job;
  try {
    job = insertJob(jobDatabase, {
      kind: "add",
      workflow,
      batchId,
      inputLabel,
      postcardId: null,
      intakeSha256: staged.sha256,
      skill,
      prompt,
      provider: readyResearchProvider.provider,
      model: readyResearchProvider.model,
      reasoningEffort: workflow === "metadata_only" ? metadataReasoningEffort : readyResearchProvider.reasoning_effort,
    });
  } finally {
    jobDatabase.close();
  }
  queueJobDispatch(job, {
    ...readyResearchProvider,
    imagePath: path.resolve(projectRoot, staged.localPath),
    mediaType: staged.mediaType,
  });
  return job;
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
  if (!refresh || terminalStatuses.has(job.status) || job.status === "applying" || job.provider === "local_codex" || !job.openai_response_id) return job;

  let response;
  try {
    response = await retrieveBackgroundResearch({ apiKey: requireApiKey(), responseId: job.openai_response_id });
  } catch (error) {
    await markJobFailed(job.id, error);
    return getJob(job.id, { refresh: false });
  }

  if (["queued", "in_progress"].includes(response.status)) {
    const status = response.status === "queued" ? "queued" : "in_progress";
    await updateJob(job.id, { status }, { allowedStatuses: ["queued", "in_progress"] });
    return getJob(job.id, { refresh: false });
  }
  if (response.status === "cancelled") {
    await markJobCancelled(job.id);
    return getJob(job.id, { refresh: false });
  }
  if (response.status !== "completed") {
    await markJobFailed(job.id, new Error(`OpenAI 工作終止：${response.status}`));
    return getJob(job.id, { refresh: false });
  }

  try {
    const result = job.workflow === "metadata_only"
      ? extractMetadataResult(response)
      : extractResearchResult(response);
    return await serializeMutation(() => applyCompletedJob(job.id, result));
  } catch (error) {
    await markJobFailed(job.id, error);
    return getJob(job.id, { refresh: false });
  }
}

export async function cancelJob(jobId, {
  databasePath = defaultDatabasePath,
  snapshotDirectory,
  cancelOpenAI = cancelBackgroundResearch,
} = {}) {
  const database = await operationalDatabase(databasePath, snapshotDirectory);
  let job;
  try {
    job = selectJob(database, jobId);
    if (!job) throw httpError(404, `找不到工作 ${jobId}`);
    if (job.status === "cancelled") return job;
    if (job.status === "applying") throw httpError(409, "工作正在更新資料庫，已無法安全中止");
    if (terminalStatuses.has(job.status)) throw httpError(409, "工作已結束，無法中止");
    const now = new Date().toISOString();
    const changed = database.prepare(`
      UPDATE ai_jobs
      SET status = 'cancelled', error = NULL, updated_at = ?, completed_at = ?
      WHERE id = ? AND status IN ('queued', 'in_progress')
    `).run(now, now, jobId).changes;
    job = selectJob(database, jobId);
    if (!changed && job?.status === "applying") throw httpError(409, "工作正在更新資料庫，已無法安全中止");
    if (!changed && job?.status !== "cancelled") throw httpError(409, "工作狀態已改變，請重新整理後再試");
  } finally {
    database.close();
  }

  for (let index = dispatchQueue.length - 1; index >= 0; index -= 1) {
    if (dispatchQueue[index].job.id === jobId) dispatchQueue.splice(index, 1);
  }
  activeLocalControllers.get(jobId)?.abort();
  if (job.provider === "openai_api" && job.openai_response_id) {
    try {
      await cancelOpenAI({ apiKey: requireApiKey(), responseId: job.openai_response_id });
    } catch {
      // The local cancellation is authoritative. The provider may already be terminal.
    }
  }
  return job;
}

export function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    kind: job.kind,
    workflow: job.workflow,
    batch_id: job.batch_id,
    input_label: job.input_label,
    has_user_note: Boolean(job.user_note),
    status: job.status,
    postcard_id: job.postcard_id,
    provider: job.provider,
    model: job.model,
    reasoning_effort: job.reasoning_effort,
    result: job.result,
    error: job.error,
    created_at: job.created_at,
    started_at: job.started_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
    preview_url: job.intake_sha256 ? `/api/jobs/${encodeURIComponent(job.id)}/image` : null,
  };
}

export async function getJobImage(jobId) {
  const database = await operationalDatabase();
  let image;
  try {
    image = database.prepare(`
      SELECT image_intake.local_path, image_intake.media_type
      FROM ai_jobs
      JOIN image_intake ON image_intake.sha256 = ai_jobs.intake_sha256
      WHERE ai_jobs.id = ?
    `).get(jobId);
  } finally {
    database.close();
  }
  if (!image) throw httpError(404, `找不到工作圖片 ${jobId}`);
  return {
    bytes: await readFile(resolveStoredLocalPath(image.local_path)),
    mediaType: image.media_type,
  };
}

function queueJobDispatch(job, configuration) {
  dispatchQueue.push({ job, configuration });
  queueMicrotask(drainDispatchQueue);
}

function drainDispatchQueue() {
  while (activeDispatches < dispatchConcurrency && dispatchQueue.length) {
    const next = dispatchQueue.shift();
    activeDispatches += 1;
    void dispatchJob(next.job, next.configuration)
      .catch((error) => markJobFailed(next.job.id, error))
      .finally(() => {
        activeDispatches -= 1;
        drainDispatchQueue();
      });
  }
}

async function dispatchJob(job, {
  provider,
  model,
  reasoning_effort: reasoningEffort,
  apiKey = null,
  codex_command: codexCommand = null,
  imagePath = null,
  mediaType,
}) {
  if (provider === "local_codex") {
    const controller = new AbortController();
    activeLocalControllers.set(job.id, controller);
    try {
      const started = await updateJob(job.id, {
        status: "in_progress",
        startedAt: new Date().toISOString(),
      }, { allowedStatuses: ["queued"] });
      if (started.status === "cancelled") return started;
      const runner = job.workflow === "metadata_only" ? runLocalCodexMetadata : runLocalCodexResearch;
      const result = await runner({
        command: codexCommand,
        model,
        reasoningEffort,
        skill: await readFile(skillPath, "utf8"),
        prompt: job.prompt,
        imagePath,
        workingDirectory: projectRoot,
        signal: controller.signal,
      });
      return serializeMutation(() => applyCompletedJob(job.id, result));
    } finally {
      activeLocalControllers.delete(job.id);
    }
  }

  try {
    const beforeDispatch = await getJob(job.id, { refresh: false });
    if (beforeDispatch.status === "cancelled") return beforeDispatch;
    const imageBytes = await readFile(imagePath);
    const response = job.workflow === "metadata_only"
      ? await createBackgroundMetadata({
          apiKey,
          model,
          skill: await readFile(skillPath, "utf8"),
          prompt: job.prompt,
          imageBytes,
          mediaType,
        })
      : await createBackgroundResearch({
      apiKey,
      model,
      reasoningEffort,
      skill: await readFile(skillPath, "utf8"),
      prompt: job.prompt,
      imageBytes,
      mediaType,
        });
    const updated = await updateJob(job.id, {
      status: response.status === "queued" ? "queued" : "in_progress",
      responseId: response.id,
      startedAt: new Date().toISOString(),
    }, { allowedStatuses: ["queued", "in_progress"] });
    if (updated.status === "cancelled" && response.id) {
      try {
        await cancelBackgroundResearch({ apiKey, responseId: response.id });
      } catch {
        // The DB already prevents a cancelled result from reaching canonical data.
      }
      return updated;
    }
    return getJob(job.id, { refresh: false });
  } catch (error) {
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

  const snapshots = await loadOperationalSnapshots();
  const jobDatabase = await operationalDatabase();
  const row = selectJob(jobDatabase, jobId);
  jobDatabase.close();
  if (!row) throw new Error(`找不到工作 ${jobId}`);
  const applied = row.kind === "reresearch"
    ? await applyReresearch(snapshots, row, result)
    : row.workflow === "metadata_only"
      ? await applyMetadataAdd(snapshots, row, result)
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
  const previousFriendEvidence = JSON.stringify(friendEvidenceForPostcard(record));
  const previousAvatarCrop = JSON.stringify(record.visual?.sender_avatar_crop ?? null);
  const location = normalizedLocation(result.location, record.location.raw);
  validateResult(result, location);
  const allowedCandidates = relatedCandidatesFromSnapshots(snapshots, record);
  const previousDetailPath = record.research.detail.source_path;
  const preservedImages = await preserveResearchImages({
    postcardId: record.id,
    jobId: job.id,
    candidates: result.reference_images,
  });
  sanitizeReferenceImageResult(result);
  result.reference_image_preservation = preservedImages;
  const researchImages = preservedImages.images.length
    ? preservedImages.images
    : (record.research.images ?? []);
  const userNote = normalizeUserContribution(job.user_note);
  const sourcePath = await writeResearchFile(record.id, job.id, result, researchImages, userNote);
  record.location = location;
  record.research = normalizedResearch(result.research, sourcePath, researchImages);
  record.research.status = `ui-reresearched-${localDate()}`;
  const avatarCrop = result.visible.sender === record.sender
    ? normalizeAvatarCropHint(result.visible.sender_avatar_crop)
    : null;
  record.visual = {
    ...(record.visual ?? {}),
    sender_avatar_crop: avatarCrop ?? record.visual?.sender_avatar_crop ?? null,
  };
  record.curation = {
    ...record.curation,
    rating: result.curation.rating,
    recommendation: result.curation.recommendation,
    status: result.curation.status,
    personal_relevance: result.curation.personal_relevance ?? record.curation.personal_relevance ?? null,
    tags: uniqueStrings(result.curation.tags),
  };
  record.provenance ??= [];
  if (userNote) {
    record.user_contributions ??= [];
    record.user_contributions.push({
      kind: "reresearch_note",
      body: userNote,
      recorded_at: job.created_at,
      job_id: job.id,
    });
  }
  record.provenance.push({
    source_session: `ui-reresearch-${localDate()}`,
    source_screenshot: record.provenance[0]?.source_screenshot ?? record.asset.path,
    original_filename: record.asset.original_filename ?? null,
    screenshot_notes: `再研究前的研究檔仍保留於 ${previousDetailPath}`,
    research_status: `ui-reresearched-${localDate()}`,
    user_note: userNote,
  });
  applyRelations(snapshots.postcards.postcards, record, result.related_postcards, allowedCandidates);
  if (record.sender && record.acquisition?.sender_status === "confirmed") {
    const evidenceChanged = JSON.stringify(friendEvidenceForPostcard(record)) !== previousFriendEvidence;
    const avatarEvidenceChanged = JSON.stringify(record.visual.sender_avatar_crop) !== previousAvatarCrop;
    const profile = snapshots.friends.profiles.find((item) => item.name === record.sender);
    if (evidenceChanged) updateFriendProfilesForEvidenceChange(snapshots, [record.sender]);
    if (evidenceChanged || avatarEvidenceChanged || !profile?.avatar) {
      result.avatar_generation = await ensureFriendAvatars(snapshots, { affectedNames: [record.sender] });
    }
  }
  return record;
}

async function applyMetadataAdd(snapshots, job, result) {
  const { visible, acquisition, location, avatarCrop } = metadataIntakeFields(result);
  const intake = await intakeForJob(job);
  const promoted = await promoteIntakeAsset(snapshots, job, intake, visible.found_date);
  validateAcquisition({ id: promoted.id, sender: visible.sender, acquisition });
  const sourcePath = await writeMetadataFile(promoted.id, job.id, visible, acquisition);
  const record = {
    id: promoted.id,
    poi_name: visible.poi_name,
    found_date: visible.found_date,
    received_at: null,
    archived_on: promoted.archivedOn,
    archived_at: promoted.archivedAt,
    sender: visible.sender,
    location,
    asset: promoted.asset,
    curation: {
      rating: null,
      recommendation: null,
      status: "unreviewed",
      tags: [],
      personal_relevance: null,
    },
    research: pendingResearch(sourcePath),
    provenance: [{
      source_session: `ui-fast-intake-${promoted.archivedOn}`,
      source_screenshot: intake.local_path,
      original_filename: intake.original_filename,
      screenshot_notes: uniqueStrings(visible.screenshot_notes).join("；") || null,
      research_status: "metadata_only_pending_research",
    }],
    related_postcards: [],
    acquisition,
    visual: { sender_avatar_crop: avatarCrop },
  };
  const matches = metadataMatches(snapshots.postcards.postcards, record);
  snapshots.postcards.postcards.push(record);
  if (record.sender && record.acquisition.sender_status === "confirmed") {
    updateFriendProfilesForEvidenceChange(snapshots, [record.sender]);
    result.avatar_generation = await ensureFriendAvatars(snapshots, { affectedNames: [record.sender] });
  }
  for (const match of matches) addSymmetricRelation(record, match, {
    relationship: "same-metadata-different-image",
    note: "快速建檔辨識到相同 POI、日期、遊戲地點與來源身分，但圖片 SHA-256 不同；尚待完整研究確認。",
  });
  return record;
}

async function applyAdd(snapshots, job, result) {
  const intake = await intakeForJob(job);
  const foundDate = result.visible.found_date;
  const promoted = await promoteIntakeAsset(snapshots, job, intake, foundDate);
  const { id, archivedAt, archivedOn: date } = promoted;
  const location = normalizedLocation(result.location, result.visible.game_location);
  const acquisition = result.acquisition;
  const sender = result.visible.sender;
  validateResult(result, location);
  validateAcquisition({ id, sender, acquisition });
  const preservedImages = await preserveResearchImages({
    postcardId: id,
    jobId: job.id,
    candidates: result.reference_images,
  });
  sanitizeReferenceImageResult(result);
  result.reference_image_preservation = preservedImages;
  const sourcePath = await writeResearchFile(id, job.id, result, preservedImages.images);
  const record = {
    id,
    poi_name: result.visible.poi_name,
    found_date: foundDate,
    received_at: null,
    archived_on: date,
    archived_at: archivedAt,
    sender,
    location,
    asset: promoted.asset,
    curation: {
      rating: result.curation.rating,
      recommendation: result.curation.recommendation,
      status: result.curation.status,
      tags: uniqueStrings(result.curation.tags),
      personal_relevance: result.curation.personal_relevance,
    },
    research: normalizedResearch(result.research, sourcePath, preservedImages.images),
    provenance: [{
      source_session: `ui-intake-${date}`,
      source_screenshot: intake.local_path,
      original_filename: intake.original_filename,
      screenshot_notes: uniqueStrings(result.visible.screenshot_notes).join("；") || null,
      research_status: `ui-researched-${date}`,
    }],
    related_postcards: [],
    acquisition,
    visual: {
      sender_avatar_crop: acquisition.sender_status === "confirmed"
        ? normalizeAvatarCropHint(result.visible.sender_avatar_crop)
        : null,
    },
  };
  const matches = metadataMatches(snapshots.postcards.postcards, record);
  snapshots.postcards.postcards.push(record);
  if (record.sender && record.acquisition.sender_status === "confirmed") {
    updateFriendProfilesForEvidenceChange(snapshots, [record.sender]);
    result.avatar_generation = await ensureFriendAvatars(snapshots, { affectedNames: [record.sender] });
  }
  for (const match of matches) addSymmetricRelation(record, match, {
    relationship: "same-metadata-different-image",
    note: "POI、發現日期、遊戲地點與來源身分相同，但匯入圖片的 SHA-256 不同。",
  });
  return record;
}

async function intakeForJob(job) {
  const database = await operationalDatabase();
  try {
    const intake = database.prepare(`
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
    if (!intake) throw new Error("新增工作的 intake 圖片不存在");
    return intake;
  } finally {
    database.close();
  }
}

async function promoteIntakeAsset(snapshots, job, intake, foundDate) {
  const id = nextPostcardId(snapshots.postcards.postcards);
  const archivedAt = secondPrecisionTimestamp(job.created_at);
  const archivedOn = localDate(new Date(archivedAt));
  const folderDate = foundDate ?? archivedOn;
  const [year, month] = folderDate.split("-");
  const publicRelative = `/images/postcards/${year}/${month}/${id}${intake.file_extension}`;
  const publicPath = path.join(projectRoot, `public${publicRelative}`);
  await mkdir(path.dirname(publicPath), { recursive: true });
  try {
    await copyFile(resolveStoredLocalPath(intake.local_path), publicPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existingHash = createHash("sha256").update(await readFile(publicPath)).digest("hex");
    if (existingHash !== job.intake_sha256) {
      throw new Error(`canonical 圖片路徑已有不同內容，未覆寫：${publicRelative}`);
    }
  }
  return {
    id,
    archivedAt,
    archivedOn,
    asset: {
      path: publicRelative,
      sha256: job.intake_sha256,
      bytes: intake.bytes,
      media_type: intake.media_type,
      original_filename: intake.original_filename,
    },
  };
}

function metadataMatches(postcards, record) {
  return postcards.filter((existing) => (
    !existing.lifecycle?.deleted_at
    && existing.poi_name === record.poi_name
    && existing.found_date === record.found_date
    && existing.location.raw === record.location.raw
    && existing.sender === record.sender
    && existing.acquisition.type === record.acquisition.type
  ));
}


export function updateFriendProfilesForEvidenceChange(snapshots, affectedNames) {
  const names = [...new Set(affectedNames.filter(Boolean))];
  if (!names.length) return snapshots.friends;
  snapshots.friends = rebuildFriends(
    snapshots.postcards.postcards,
    snapshots.friends,
    { affectedNames: names },
  );
  return snapshots.friends;
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

function normalizedResearch(input, sourcePath, images = []) {
  return {
    status: `ui-researched-${localDate()}`,
    confidence: input.confidence,
    confidence_label: input.confidence_label,
    summary: input.summary.trim(),
    sources: uniqueStrings(input.sources).filter(validHttpUrl),
    confirmed_facts: uniqueStrings(input.confirmed_facts),
    inferences: uniqueStrings(input.inferences),
    unresolved_questions: uniqueStrings(input.unresolved_questions),
    images,
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
  if (!Array.isArray(result.reference_images) || result.reference_images.length > 3) throw new Error("研究參考圖片必須是最多 3 張的陣列");
  const normalizedSources = new Set(sources.map(normalizedUrl));
  for (const image of result.reference_images) {
    if (!validHttpUrl(image?.source_page_url) || !validHttpUrl(image?.image_url)) throw new Error("研究參考圖片含有無效網址");
    if (!normalizedSources.has(normalizedUrl(image.source_page_url))) throw new Error("研究參考圖片來源頁必須同時列在 research.sources");
    if (!image.caption?.trim() || !image.alt?.trim()) throw new Error("研究參考圖片缺少 caption 或 alt");
  }
  const coordinates = [location.latitude, location.longitude];
  if (coordinates.some((value) => value != null) && coordinates.some((value) => value == null)) throw new Error("緯度與經度必須同時存在");
  if (location.latitude != null && (location.latitude < -90 || location.latitude > 90)) throw new Error("緯度超出有效範圍");
  if (location.longitude != null && (location.longitude < -180 || location.longitude > 180)) throw new Error("經度超出有效範圍");
}

async function writeResearchFile(postcardId, jobId, result, images = [], userNote = null) {
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
    "## 使用者補充（原文）",
    ...(userNote ? userNote.split("\n") : ["本次沒有使用者補充。"]),
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
    "## 研究參考圖片",
    ...(images.length
      ? images.flatMap((image) => [
          `- ${image.caption}`,
          `  - 本機：${image.path}`,
          `  - 來源頁：${image.source_page_url}`,
          `  - SHA-256：${image.sha256}`,
        ])
      : ["- 本次沒有保存可靠的參考圖片。"]),
    ...((result.reference_image_preservation?.failures ?? []).length
      ? ["", "### 下載未採用", ...result.reference_image_preservation.failures.map((failure) => `- ${failure.source_page_url ?? "無效來源"}：${failure.error}`)]
      : []),
    "",
  ].join("\n");
  const temporary = `${target}.tmp`;
  await writeFile(temporary, body, "utf8");
  await rename(temporary, target);
  return relative;
}

async function writeMetadataFile(postcardId, jobId, visible, acquisition) {
  const date = localDate();
  const relative = `research/raw/${postcardId}-ui-fast-intake-${date}-${jobId.slice(-8)}.md`;
  const target = path.join(projectRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  const body = [
    `# ${visible.poi_name}`,
    "",
    "- 狀態：快速建檔；尚未進行地方與故事研究",
    `- 建檔日期：${date}`,
    `- UI 工作：${jobId}`,
    `- 見つけた日：${visible.found_date ?? "未確認"}`,
    `- 遊戲顯示地點：${visible.game_location}`,
    `- 寄件人：${visible.sender ?? "未確認／不適用"}`,
    `- 來源分類：${acquisition.type} / ${acquisition.sender_status}`,
    `- 畫面證據：${acquisition.evidence.join("、")}`,
    "",
    "本檔只保存畫面可見 metadata 與來源分類，不是研究文章。請使用網站的「再研究」補做地址、故事、來源、評分與關聯。",
    ...(visible.screenshot_notes.length ? ["", "## 畫面備註", ...visible.screenshot_notes.map((note) => `- ${note}`)] : []),
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

async function loadOperationalSnapshots(databasePath = defaultDatabasePath, snapshotDirectory) {
  const database = await operationalDatabase(databasePath, snapshotDirectory);
  try {
    return exportSnapshots(database);
  } finally {
    database.close();
  }
}

function insertJob(database, {
  kind,
  workflow = "full_research",
  batchId = null,
  inputLabel = null,
  postcardId,
  intakeSha256,
  skill,
  prompt,
  provider,
  model,
  reasoningEffort,
  userNote = null,
  status = "queued",
  result = null,
}) {
  const now = new Date().toISOString();
  const id = `job-${randomUUID()}`;
  database.prepare(`
    INSERT INTO ai_jobs (
      id, kind, workflow, batch_id, input_label, user_note, status, postcard_id, intake_sha256, provider, model, reasoning_effort, skill_path, skill_sha256,
      prompt, result_json, created_at, started_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    kind,
    workflow,
    batchId,
    inputLabel,
    userNote,
    status,
    postcardId,
    intakeSha256,
    provider,
    model,
    reasoningEffort,
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

async function updateJob(id, fields, { allowedStatuses = null } = {}) {
  const database = await operationalDatabase();
  try {
    const current = selectJob(database, id);
    if (!current) throw new Error(`找不到工作 ${id}`);
    const next = {
      status: fields.status ?? current.status,
      postcardId: fields.postcardId ?? current.postcard_id,
      responseId: fields.responseId ?? current.openai_response_id,
      result: fields.result ?? current.result,
      error: Object.hasOwn(fields, "error") ? fields.error : current.error,
      startedAt: fields.startedAt ?? current.started_at,
      completedAt: fields.completedAt ?? current.completed_at,
    };
    const statusGuard = allowedStatuses?.length
      ? ` AND status IN (${allowedStatuses.map(() => "?").join(", ")})`
      : "";
    database.prepare(`
      UPDATE ai_jobs SET
        status = ?, postcard_id = ?, openai_response_id = ?, result_json = ?, error = ?,
        started_at = ?, updated_at = ?, completed_at = ?
      WHERE id = ?${statusGuard}
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
      ...(allowedStatuses ?? []),
    );
    return selectJob(database, id);
  } finally {
    database.close();
  }
}

async function markJobFailed(id, error) {
  await updateJob(id, {
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    completedAt: new Date().toISOString(),
  }, { allowedStatuses: ["queued", "in_progress", "applying"] });
}

async function markJobCancelled(id) {
  const now = new Date().toISOString();
  await updateJob(id, {
    status: "cancelled",
    error: null,
    completedAt: now,
  }, { allowedStatuses: ["queued", "in_progress"] });
}

function selectJob(database, id) {
  const row = database.prepare("SELECT * FROM ai_jobs WHERE id = ?").get(id);
  return normalizeJobRow(row);
}

function normalizeJobRow(row) {
  if (!row) return null;
  return {
    ...row,
    workflow: row.workflow ?? "full_research",
    result: row.result_json ? JSON.parse(row.result_json) : null,
  };
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

function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function secondPrecisionTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("AI 工作缺少有效的建立時間");
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function sanitizeReferenceImageResult(result) {
  const sourcePages = new Map(result.reference_images.map((image) => [
    normalizedUrl(image.source_page_url),
    safeRemoteLocator(image.source_page_url),
  ]));
  result.research.sources = result.research.sources.map((source) => sourcePages.get(normalizedUrl(source)) ?? source);
  result.reference_images = result.reference_images.map((image) => ({
    ...image,
    source_page_url: safeRemoteLocator(image.source_page_url),
    image_url: safeRemoteLocator(image.image_url),
  }));
}

function normalizedUrl(value) {
  try {
    return new URL(value).href;
  } catch {
    return "";
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function requireResearchProvider(suffix = "", providedConfiguration = null) {
  const configuration = providedConfiguration ?? await researchProviderConfiguration();
  if (!configuration.ready) {
    const message = configuration.provider === "local_codex"
      ? "本機 Codex 尚未安裝或登入"
      : "OPENAI_API_KEY 尚未設定";
    throw httpError(503, [message, suffix].filter(Boolean).join("；"));
  }
  return {
    ...configuration,
    apiKey: configuration.provider === "openai_api" ? requireApiKey() : null,
  };
}

function uploadInputLabel(input, index) {
  if (input.file?.name) return path.basename(input.file.name);
  if (input.sourceUrl) {
    try {
      const url = new URL(input.sourceUrl);
      return path.basename(decodeURIComponent(url.pathname)) || url.hostname;
    } catch {
      return `網址 ${index + 1}`;
    }
  }
  return `圖片 ${index + 1}`;
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
