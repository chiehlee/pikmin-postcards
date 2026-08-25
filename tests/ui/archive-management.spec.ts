import { expect, type Page, test } from '@playwright/test';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArchiveFixture } from './archive-fixture';

type ArchivePayload = {
  postcards: Array<Record<string, unknown>>;
  capabilities: { management: boolean; ai_configured: boolean; provider: 'openai_api' | 'local_codex'; model: string; reasoning_effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' };
  jobs?: Array<Record<string, unknown>>;
};

const targetName = 'One Grantai Fontain';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const readyApiCapabilities: ArchivePayload['capabilities'] = {
  management: true,
  ai_configured: true,
  provider: 'openai_api',
  model: 'test-model',
  reasoning_effort: 'high',
};

async function mockArchive(
  page: Page,
  transform: (payload: ArchivePayload) => ArchivePayload = (payload) => payload,
  capabilities: ArchivePayload['capabilities'] = readyApiCapabilities,
) {
  await page.route('**/api/archive', async (route) => {
    const payload = createArchiveFixture() as ArchivePayload;
    payload.capabilities = capabilities;
    payload.jobs = [];
    await route.fulfill({ json: transform(payload) });
  });
}

async function openTarget(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('名稱、地點、故事或標籤').fill(targetName);
  const card = page.locator('.postcard-card').filter({ hasText: targetName });
  await card.getByRole('button', { name: `查看 ${targetName}` }).click();
  return page.locator('.detail-modal');
}

test('the browser renders a backend connection state instead of bundling archive records', async ({ page }) => {
  let releaseRequest: () => void = () => {};
  const gate = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await page.route('**/api/archive', async (route) => {
    await gate;
    await route.fulfill({ json: createArchiveFixture() });
  });

  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.archive-connection-state').filter({ hasText: '正在連接資料服務' })).toBeVisible();
    await expect(page.locator('.postcard-card')).toHaveCount(0);
    releaseRequest();
    await expect(page.locator('.postcard-card').first()).toBeVisible();
    await expect(page.locator('.archive-connection-state').filter({ hasText: '正在連接資料服務' })).toBeHidden();
  } finally {
    releaseRequest();
  }
});

test('a postcard image created after production startup loads through the live asset route', async ({ page }) => {
  const runtimeDirectory = path.join(projectRoot, 'public/images/runtime-ui-test');
  const runtimeImagePath = path.join(runtimeDirectory, 'new-postcard.png');
  const runtimePublicPath = '/images/runtime-ui-test/new-postcard.png';
  await mkdir(runtimeDirectory, { recursive: true });
  await copyFile(path.join(projectRoot, 'public/og.png'), runtimeImagePath);

  try {
    await mockArchive(page, (payload) => ({
      ...payload,
      postcards: payload.postcards.map((postcard) => postcard.poi_name === targetName
        ? { ...postcard, asset: { ...(postcard.asset as Record<string, unknown>), path: runtimePublicPath } }
        : postcard),
    }));
    await page.goto('/');
    await page.getByPlaceholder('名稱、地點、故事或標籤').fill(targetName);
    const card = page.locator('.postcard-card').filter({ hasText: targetName });
    const image = card.locator('img');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(image).toHaveAttribute('src', `/api/assets?path=${encodeURIComponent(runtimePublicPath)}`);
  } finally {
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test('management UI reports missing AI configuration without exposing a key', async ({ page }) => {
  await mockArchive(page, (payload) => payload, {
    management: true,
    ai_configured: false,
    provider: 'openai_api',
    model: 'gpt-5.6',
    reasoning_effort: 'high',
  });
  await page.route('**/api/postcards/*/research', async (route) => {
    await route.fulfill({ status: 503, json: { error: 'OPENAI_API_KEY 尚未設定' } });
  });

  const dialog = await openTarget(page);
  await expect(dialog.getByText('OpenAI API 尚未設定完成；soft delete 仍可使用。')).toBeVisible();
  await dialog.getByRole('button', { name: '再研究', exact: true }).click();
  const form = dialog.getByRole('form', { name: '補充再研究資訊' });
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: '開始再研究' }).click();
  await expect(page.getByRole('status')).toContainText('OPENAI_API_KEY 尚未設定');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /新增明信片/ }).click();
  await expect(page.getByRole('dialog', { name: '新增明信片' })).toContainText('OpenAI API 尚未設定完成');
});

test('soft delete requires confirmation, removes only the open card, and explains preservation', async ({ page }) => {
  await mockArchive(page);
  let deletedId = '';
  await page.route('**/api/postcards/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    deletedId = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    expect(route.request().postDataJSON()).toEqual({ reason: '使用者由網站移除疑似重複明信片' });
    await route.fulfill({ json: { postcard: { id: deletedId } } });
  });

  const dialog = await openTarget(page);
  await dialog.getByRole('button', { name: '刪除', exact: true }).click();
  const confirmation = dialog.getByRole('alertdialog', { name: `確認刪除 ${targetName}` });
  await expect(confirmation).toContainText('原圖、研究、DB 與其他相關明信片都會保留');
  await confirmation.getByRole('button', { name: '確認 soft delete' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('.postcard-card').filter({ hasText: targetName })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(`${deletedId} 已 soft delete`);
  expect(deletedId).toMatch(/^pc-/);
});

test('re-research uses the dedicated research section, shows elapsed time, then refreshes the open postcard', async ({ page }) => {
  const userNote = '北投教會就在我經營的 Subway（大興街65號）隔壁。';
  let researched = false;
  let postcardId = '';
  let polls = 0;
  let researchRequests = 0;
  await mockArchive(page, (payload) => {
    if (!researched) return payload;
    return {
      ...payload,
      postcards: payload.postcards.map((postcard) => postcard.id === postcardId
        ? {
          ...postcard,
          user_contributions: [{
            kind: 'reresearch_note',
            body: userNote,
            recorded_at: '2026-08-23T01:02:03.000Z',
            job_id: 'job-ui-reresearch',
          }],
          research: {
            ...(postcard.research as Record<string, unknown>),
            summary: 'Playwright 驗證：再研究完成後已從管理 API 更新。',
          },
        }
        : postcard),
    };
  });
  const startedAt = new Date(Date.now() - 4_000).toISOString();
  await page.route('**/api/postcards/*/research', async (route) => {
    researchRequests += 1;
    expect(route.request().postDataJSON()).toEqual({ user_note: userNote });
    postcardId = new URL(route.request().url()).pathname.split('/').at(-2) ?? '';
    await route.fulfill({
      status: 202,
      json: { job: {
        id: 'job-ui-reresearch', kind: 'reresearch', workflow: 'full_research', batch_id: null, input_label: null, has_user_note: true, status: 'queued', postcard_id: postcardId,
        provider: 'openai_api', model: 'test-model', reasoning_effort: 'high',
        created_at: startedAt, started_at: startedAt, completed_at: null, error: null,
      } },
    });
  });
  await page.route('**/api/jobs/job-ui-reresearch', async (route) => {
    polls += 1;
    const complete = polls >= 3;
    researched = complete;
    await route.fulfill({ json: { job: {
      id: 'job-ui-reresearch', kind: 'reresearch', workflow: 'full_research', batch_id: null, input_label: null, has_user_note: true, status: complete ? 'completed' : 'in_progress', postcard_id: postcardId,
      provider: 'openai_api', model: 'test-model', reasoning_effort: 'high',
      created_at: startedAt, started_at: startedAt, completed_at: complete ? new Date().toISOString() : null, error: null,
    } } });
  });

  const dialog = await openTarget(page);
  await dialog.getByRole('button', { name: '再研究', exact: true }).click();
  const form = dialog.getByRole('form', { name: '補充再研究資訊' });
  await expect(form).toBeVisible();
  await expect(form.getByLabel('補充你知道的事（選填）')).toBeFocused();
  expect(researchRequests).toBe(0);
  await form.getByLabel('補充你知道的事（選填）').fill(userNote);
  await form.getByRole('button', { name: '加入補充並開始再研究' }).click();
  await expect(form).toBeHidden();
  expect(researchRequests).toBe(1);
  const queue = page.getByRole('region', { name: '處理中的明信片' });
  const job = queue.locator('[data-job-id="job-ui-reresearch"]');
  await expect(job).toBeVisible();
  await expect(job).toContainText(targetName);
  await expect(job).toContainText('含使用者補充');
  await expect(job).toContainText(/AI 研究中 · 00:00:0[4-9]/);
  await expect(queue).toBeHidden({ timeout: 8_000 });
  await expect(dialog.locator('.research-summary-copy')).toHaveText('Playwright 驗證：再研究完成後已從管理 API 更新。');
  const history = dialog.locator('.user-contribution-history');
  await history.getByText('已保存的使用者補充（1）').click();
  await expect(history).toContainText(userNote);
});

test('new postcard closes the form after the job starts and moves progress into the research section', async ({ page }) => {
  let completed = false;
  let receivedUpload = false;
  let polls = 0;
  let addedRecord: Record<string, unknown> | null = null;
  await mockArchive(page, (payload) => {
    if (completed && !addedRecord) {
      addedRecord = {
        ...payload.postcards[0],
        id: 'pc-9999',
        poi_name: 'Playwright 新增明信片',
      };
    }
    return completed && addedRecord
      ? { ...payload, postcards: [...payload.postcards, addedRecord] }
      : payload;
  });
  const startedAt = new Date(Date.now() - 2_000).toISOString();
  await page.route('**/api/postcards', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    receivedUpload = (route.request().headers()['content-type'] ?? '').includes('multipart/form-data');
    const job = {
      id: 'job-ui-add', kind: 'add', workflow: 'full_research', batch_id: 'batch-ui-add', input_label: 'pc-020.png', status: 'queued', postcard_id: null,
      provider: 'openai_api', model: 'test-model', reasoning_effort: 'high',
      created_at: startedAt, started_at: startedAt, completed_at: null, error: null,
    };
    await route.fulfill({ status: 202, json: { batch_id: 'batch-ui-add', total: 1, jobs: [job], job, failures: [] } });
  });
  await page.route('**/api/jobs/job-ui-add', async (route) => {
    polls += 1;
    completed = polls >= 4;
    await route.fulfill({ json: { job: {
      id: 'job-ui-add', kind: 'add', workflow: 'full_research', batch_id: 'batch-ui-add', input_label: 'pc-020.png', status: completed ? 'completed' : 'in_progress', postcard_id: completed ? 'pc-9999' : null,
      provider: 'openai_api', model: 'test-model', reasoning_effort: 'high',
      created_at: startedAt, started_at: startedAt, completed_at: completed ? new Date().toISOString() : null, error: null,
    } } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /新增明信片/ }).click();
  const form = page.getByRole('dialog', { name: '新增明信片' });
  await expect(form).toContainText('AI 已連線 · OpenAI API · test-model');
  await form.getByRole('radio', { name: /^新增明信片並研究/ }).check();
  await form.locator('input[type="file"]').setInputFiles(path.resolve('public/og.png'));
  await form.getByLabel('給這批圖片的備註（選填）').fill('Playwright UI test');
  await form.getByRole('button', { name: '新增 1 張明信片並研究' }).click();

  await expect(form).toBeHidden();
  await expect(page.getByRole('status')).toContainText('1 個 AI 工作已排入佇列');
  const queue = page.getByRole('region', { name: '處理中的明信片' });
  const job = queue.locator('[data-job-id="job-ui-add"]');
  await expect(job).toBeVisible();
  await expect(job).toContainText('名稱辨識中');
  await expect(job).toContainText('發現日期 · 辨識中');
  await expect(job.getByRole('progressbar')).toHaveAttribute('aria-valuetext', /等待 AI|AI 研究中/);
  await expect(queue).toBeHidden({ timeout: 8_000 });
  await expect(page.getByRole('dialog', { name: 'Playwright 新增明信片' })).toBeVisible();
  expect(receivedUpload).toBe(true);
});

test('quick-add accepts a large-style multi-file selection and creates one visible job per image', async ({ page }) => {
  await mockArchive(page);
  let multipartBody = '';
  const startedAt = new Date().toISOString();
  await page.route('**/api/postcards', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    multipartBody = route.request().postDataBuffer()?.toString('latin1') ?? '';
    const jobs = [1, 2].map((index) => ({
      id: `job-ui-quick-${index}`,
      kind: 'add',
      workflow: 'metadata_only',
      batch_id: 'batch-ui-quick',
      input_label: `batch-${index}.png`,
      status: 'queued',
      postcard_id: null,
      provider: 'openai_api',
      model: 'test-model',
      reasoning_effort: 'none',
      created_at: startedAt,
      started_at: null,
      completed_at: null,
      error: null,
      preview_url: null,
    }));
    await route.fulfill({ status: 202, json: {
      batch_id: 'batch-ui-quick', total: 2, jobs, job: jobs[0], failures: [],
    } });
  });
  for (const index of [1, 2]) {
    await page.route(`**/api/jobs/job-ui-quick-${index}`, async (route) => {
      await route.fulfill({ json: { job: {
        id: `job-ui-quick-${index}`, kind: 'add', workflow: 'metadata_only', batch_id: 'batch-ui-quick', input_label: `batch-${index}.png`,
        status: 'in_progress', postcard_id: null, provider: 'openai_api', model: 'test-model', reasoning_effort: 'none',
        created_at: startedAt, started_at: startedAt, completed_at: null, error: null, preview_url: null,
      } } });
    });
  }

  const fixture = await readFile(path.resolve('public/og.png'));
  await page.goto('/');
  await page.getByRole('button', { name: /新增明信片/ }).click();
  const dialog = page.getByRole('dialog', { name: '新增明信片' });
  await expect(dialog.locator('input[name="workflow"][value="metadata_only"]')).toBeChecked();
  await dialog.locator('input[type="file"]').setInputFiles([
    { name: 'batch-1.png', mimeType: 'image/png', buffer: fixture },
    { name: 'batch-2.png', mimeType: 'image/png', buffer: fixture },
  ]);
  await expect(dialog).toContainText('已選擇 2 張本機圖片');
  await expect(dialog).toContainText('可一次選擇 20 張以上');
  await dialog.getByRole('button', { name: '新增 2 張明信片' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('已接收 2 張：2 個 AI 工作已排入佇列');
  const queue = page.getByRole('region', { name: '處理中的明信片' });
  await expect(queue.locator('[data-job-id^="job-ui-quick-"]')).toHaveCount(2);
  await expect(queue.locator('[data-job-id="job-ui-quick-1"]')).toContainText('QUICK INTAKE');
  await expect(queue.locator('[data-job-id="job-ui-quick-1"]')).toContainText('None');
  expect((multipartBody.match(/name="images"/g) ?? []).length).toBe(2);
  expect(multipartBody).toContain('name="workflow"');
  expect(multipartBody).toContain('metadata_only');
});

test('new postcard errors stay in the form and appear as a bottom-right notification', async ({ page }) => {
  await mockArchive(page);
  await page.route('**/api/postcards', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({ status: 503, json: { error: '圖片已保存，但 AI session 無法開始' } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /新增明信片/ }).click();
  const form = page.getByRole('dialog', { name: '新增明信片' });
  await form.locator('input[type="file"]').setInputFiles(path.resolve('public/og.png'));
  await form.getByRole('button', { name: '新增 1 張明信片' }).click();

  await expect(form).toBeVisible();
  const notification = page.getByRole('status');
  await expect(notification).toContainText('明信片新增失敗');
  await expect(notification).toContainText('AI session 無法開始');
  const box = await notification.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) - (viewport?.width ?? 0))).toBeLessThanOrEqual(24);
  expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) - (viewport?.height ?? 0))).toBeLessThanOrEqual(24);
  await expect(page.getByRole('region', { name: '處理中的明信片' })).toHaveCount(0);
});

test('an unfinished database job restores its postcard card after reload', async ({ page }) => {
  const startedAt = new Date(Date.now() - 7_000).toISOString();
  const runningJob = {
    id: 'job-ui-resume', kind: 'reresearch', workflow: 'full_research', batch_id: null, input_label: null, status: 'in_progress', postcard_id: 'pc-ui-001',
    provider: 'openai_api', model: 'test-model', reasoning_effort: 'high',
    created_at: startedAt, started_at: startedAt, completed_at: null, error: null,
  };
  await mockArchive(page, (payload) => ({ ...payload, jobs: [runningJob] }));
  await page.route('**/api/jobs/job-ui-resume', async (route) => {
    await route.fulfill({ json: { job: runningJob } });
  });

  await page.goto('/');
  let queue = page.getByRole('region', { name: '處理中的明信片' });
  await expect(queue.locator('[data-job-id="job-ui-resume"]')).toContainText('AI 研究中');
  await page.reload();
  queue = page.getByRole('region', { name: '處理中的明信片' });
  await expect(queue.locator('[data-job-id="job-ui-resume"]')).toContainText(/OpenAI API · test-model · High · AI 研究中 · 00:00:/);
});

test('an active research card can stop its job while preserving the saved intake', async ({ page }) => {
  const startedAt = new Date(Date.now() - 8_000).toISOString();
  let postcardId = '';
  let postcardName = '';
  let cancelRequests = 0;
  const runningJob = {
    id: 'job-ui-cancel', kind: 'reresearch', workflow: 'full_research', batch_id: null, input_label: null,
    status: 'in_progress', postcard_id: '', provider: 'local_codex', model: 'gpt-5.6-sol', reasoning_effort: 'high',
    created_at: startedAt, started_at: startedAt, completed_at: null, error: null,
  };
  await mockArchive(page, (payload) => {
    postcardId = String(payload.postcards[0].id);
    postcardName = String(payload.postcards[0].poi_name);
    runningJob.postcard_id = postcardId;
    return { ...payload, jobs: [runningJob] };
  });
  await page.route('**/api/jobs/job-ui-cancel**', async (route) => {
    const isCancel = new URL(route.request().url()).pathname.endsWith('/cancel');
    if (isCancel) {
      cancelRequests += 1;
      expect(route.request().method()).toBe('POST');
    }
    await route.fulfill({ json: { job: {
      ...runningJob,
      status: isCancel ? 'cancelled' : 'in_progress',
      completed_at: isCancel ? new Date().toISOString() : null,
    } } });
  });

  await page.goto('/');
  const queue = page.getByRole('region', { name: '處理中的明信片' });
  const card = queue.locator('[data-job-id="job-ui-cancel"]');
  await expect(card).toContainText(postcardName);
  const cancel = card.getByRole('button', { name: `中止 ${postcardName}的工作` });
  await expect(cancel).toBeVisible();
  await cancel.click();

  await expect(queue).toBeHidden();
  await expect(page.getByRole('status')).toContainText('AI 工作已中止');
  await expect(page.getByRole('status')).toContainText('原圖、intake 與工作紀錄仍保留');
  expect(cancelRequests).toBe(1);
  expect(postcardId).toMatch(/^pc-/);
});
