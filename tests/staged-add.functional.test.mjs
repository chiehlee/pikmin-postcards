import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createEmptySnapshots, writeSnapshots } from "./fixtures/archive-snapshots.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("failed full research keeps the postcard and a successful retry marks it unread", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-staged-add-"));
  const databasePath = path.join(temporaryDirectory, "runtime/pikmin-postcards.sqlite3");
  await mkdir(path.join(temporaryDirectory, "runtime"));
  await symlink("runtime", path.join(temporaryDirectory, "var"), "dir");
  await mkdir(path.join(temporaryDirectory, "public"));
  await mkdir(path.join(temporaryDirectory, "images"));
  await symlink("../images", path.join(temporaryDirectory, "public/images"), "dir");
  await mkdir(path.join(temporaryDirectory, "research/raw"), { recursive: true });
  await cp(path.join(repositoryRoot, "db/migrations"), path.join(temporaryDirectory, "db/migrations"), { recursive: true });
  const skillDirectory = path.join(temporaryDirectory, ".agents/skills/pikmin-postcard-intake");
  await mkdir(skillDirectory, { recursive: true });
  await cp(path.join(repositoryRoot, ".agents/skills/pikmin-postcard-intake/SKILL.md"), path.join(skillDirectory, "SKILL.md"));
  await writeSnapshots(path.join(temporaryDirectory, "snapshots"), createEmptySnapshots());
  const sourcePath = path.join(repositoryRoot, "public/og.png");

  try {
    const script = `
      import { readFile } from 'node:fs/promises';
      import { startAddBatch, getJob, archiveOverview, startReresearchJob, setPostcardReadState } from './server/archive-manager.mjs';
      import { openDatabase } from './db/database.mjs';

      let metadataRequests = 0;
      let researchRequests = 0;
      let researchShouldSucceed = false;
      globalThis.fetch = async (url, options = {}) => {
        if (url.endsWith('/responses') && options.method === 'POST') {
          const request = JSON.parse(options.body);
          if (request.tools?.some((tool) => tool.type === 'web_search')) {
            researchRequests += 1;
            if (!researchShouldSucceed) throw new Error('模擬完整研究失敗');
            return Response.json({ id: 'response-research', status: 'in_progress' });
          }
          metadataRequests += 1;
          return Response.json({ id: 'response-metadata', status: 'in_progress' });
        }
        if (url.endsWith('/responses/response-metadata')) {
          return Response.json({
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
              visible: {
                poi_name: '測試牛雕塑', game_location: 'Test City', found_date: '2026-09-21',
                sender: null, send_to_friend_visible: true, sender_panel_visible: false,
                sender_area_blank: null, sender_avatar_crop: null, screenshot_notes: [],
              },
            }) }] }],
          });
        }
        if (url.endsWith('/responses/response-research')) {
          return Response.json({
            status: 'completed',
            output: [
              { type: 'web_search_call' },
              { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
                visible: { poi_name: '測試牛雕塑', sender: null, sender_avatar_crop: null },
                location: {
                  raw: 'Test City', endonym: '臺北市中正區測試路1號', zh_tw: null,
                  language: 'zh-Hant-TW', name_status: 'researched', name_confidence: 'high',
                  country: '臺灣', country_code: 'TW', country_endonym: '臺灣',
                  address_local: '臺北市中正區測試路1號', precision: 'full_address',
                  city: '臺北市', district: '中正區', locality: null, region: null, county: null,
                  latitude: 25.033, longitude: 121.565,
                  coordinate_source_url: 'https://example.com/coordinates',
                  coordinate_source_label: '測試座標來源', coordinate_confidence: 'high',
                  normalization_confidence: 'high',
                },
                research: {
                  confidence: 'high', confidence_label: '高',
                  summary: '測試牛雕塑的研究摘要。',
                  detail_body: '測試牛雕塑位於臺北市中正區測試路1號；這段較長的內容用來驗證再研究成功後的狀態。',
                  confirmed_facts: ['測試來源提供地址與座標'], inferences: [], unresolved_questions: [],
                  sources: ['https://example.com/coordinates'],
                },
                reference_images: [],
                curation: { rating: 4, recommendation: '保留', status: 'keep', personal_relevance: null, tags: [] },
                related_postcards: [],
              }) }] },
            ],
          });
        }
        throw new Error('未預期的測試請求：' + url);
      };

      const bytes = await readFile(${JSON.stringify(sourcePath)});
      const file = new File([bytes], 'staged.png', { type: 'image/png' });
      const batch = await startAddBatch({ inputs: [{ file, label: file.name }], workflow: 'full_research' });
      const jobId = batch.jobs[0].id;
      let current;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        current = await getJob(jobId, { refresh: false });
        if (current.openai_response_id) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!current?.openai_response_id) throw new Error('畫面辨識沒有啟動');
      const promoted = await getJob(jobId);
      if (!promoted.postcard_id || promoted.phase !== 'research') throw new Error('未先建立卡片：' + JSON.stringify({ status: promoted.status, error: promoted.error, phase: promoted.phase }));

      for (let attempt = 0; attempt < 100; attempt += 1) {
        current = await getJob(jobId, { refresh: false });
        if (current.status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (current?.status !== 'failed') throw new Error('研究失敗狀態沒有保存');
      const overview = await archiveOverview();
      const postcard = overview.postcards.find((item) => item.id === current.postcard_id);
      const database = await openDatabase();
      const row = database.prepare('SELECT id, research_status FROM postcards WHERE id = ?').get(current.postcard_id);
      const jobRow = database.prepare('SELECT phase, postcard_id, error FROM ai_jobs WHERE id = ?').get(jobId);
      database.close();
      const markedRead = await setPostcardReadState(current.postcard_id, true);
      researchShouldSucceed = true;
      const retry = await startReresearchJob(current.postcard_id);
      let retryJob;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        retryJob = await getJob(retry.id, { refresh: false });
        if (retryJob.openai_response_id) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!retryJob?.openai_response_id) throw new Error('再研究沒有啟動');
      retryJob = await getJob(retry.id);
      if (retryJob.status !== 'completed') throw new Error('再研究失敗：' + retryJob.error);
      const afterRetry = await archiveOverview();
      const updated = afterRetry.postcards.find((item) => item.id === current.postcard_id);
      const savedDatabase = await openDatabase();
      const savedReadAt = savedDatabase.prepare('SELECT read_at FROM postcards WHERE id = ?').get(current.postcard_id).read_at;
      savedDatabase.close();
      process.stdout.write(JSON.stringify({
        metadataRequests, researchRequests, initialPhase: batch.jobs[0].phase,
        name: postcard?.poi_name, researchStatus: postcard?.research.status,
        readState: postcard?.reading.is_read, row, jobRow,
        retryPostcardId: retry.postcard_id,
        markedRead: markedRead.reading.is_read,
        afterRetryReading: updated?.reading,
        savedReadAt,
        afterRetryResearchStatus: updated?.research.status,
      }));
    `;
    const { stdout } = await execFileAsync(process.execPath, [
      "--disable-warning=ExperimentalWarning", "--input-type=module", "--eval", script,
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PIKMIN_PROJECT_ROOT: temporaryDirectory,
        PIKMIN_DATA_ROOT: temporaryDirectory,
        PIKMIN_DATABASE_PATH: databasePath,
        PIKMIN_SNAPSHOT_DIRECTORY: path.join(temporaryDirectory, "snapshots"),
        PIKMIN_AI_PROVIDER: "openai_api",
        OPENAI_API_KEY: "sk-functional-staged-add",
      },
    });
    const outcome = JSON.parse(stdout);
    assert.equal(outcome.initialPhase, "metadata");
    assert.equal(outcome.metadataRequests, 1);
    assert.ok(outcome.researchRequests >= 1);
    assert.equal(outcome.name, "測試牛雕塑");
    assert.equal(outcome.researchStatus, "metadata_only_pending_research");
    assert.equal(outcome.readState, false);
    assert.equal(outcome.row.id, outcome.jobRow.postcard_id);
    assert.equal(outcome.row.research_status, "metadata_only_pending_research");
    assert.equal(outcome.jobRow.phase, "research");
    assert.match(outcome.jobRow.error, /模擬完整研究失敗/);
    assert.equal(outcome.retryPostcardId, outcome.row.id);
    assert.equal(outcome.markedRead, true);
    assert.deepEqual(outcome.afterRetryReading, { is_read: false, read_at: null });
    assert.equal(outcome.savedReadAt, null);
    assert.match(outcome.afterRetryResearchStatus, /^ui-reresearched-/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
