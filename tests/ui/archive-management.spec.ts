import { expect, type Page, test } from '@playwright/test';
import path from 'node:path';

type ArchivePayload = {
  postcards: Array<Record<string, unknown>>;
  capabilities: { management: boolean; ai_configured: boolean; model: string };
};

const targetName = 'One Grantai Fontain';

async function mockArchive(page: Page, transform: (payload: ArchivePayload) => ArchivePayload = (payload) => payload) {
  await page.route('**/api/archive', async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as ArchivePayload;
    payload.capabilities = { management: true, ai_configured: true, model: 'test-model' };
    await route.fulfill({ response, json: transform(payload) });
  });
}

async function openTarget(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('名稱、地點、故事或標籤').fill(targetName);
  const card = page.locator('.postcard-card').filter({ hasText: targetName });
  await card.getByRole('button', { name: `查看 ${targetName}` }).click();
  return page.locator('.detail-modal');
}

test('management UI reports missing AI configuration without exposing a key', async ({ page }) => {
  const dialog = await openTarget(page);
  await expect(dialog.getByText('AI 尚未設定；soft delete 仍可使用。')).toBeVisible();
  await dialog.getByRole('button', { name: '再研究', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('OPENAI_API_KEY 尚未設定');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /新增明信片/ }).click();
  await expect(page.getByRole('dialog', { name: '新增明信片' })).toContainText('AI 尚未設定');
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

test('re-research stays asynchronous, shows elapsed time, then refreshes the open postcard', async ({ page }) => {
  let researched = false;
  let postcardId = '';
  let polls = 0;
  await mockArchive(page, (payload) => {
    if (!researched) return payload;
    return {
      ...payload,
      postcards: payload.postcards.map((postcard) => postcard.id === postcardId
        ? {
          ...postcard,
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
    postcardId = new URL(route.request().url()).pathname.split('/').at(-2) ?? '';
    await route.fulfill({
      status: 202,
      json: { job: {
        id: 'job-ui-reresearch', kind: 'reresearch', status: 'queued', postcard_id: postcardId,
        created_at: startedAt, started_at: startedAt, completed_at: null, error: null,
      } },
    });
  });
  await page.route('**/api/jobs/job-ui-reresearch', async (route) => {
    polls += 1;
    const complete = polls >= 3;
    researched = complete;
    await route.fulfill({ json: { job: {
      id: 'job-ui-reresearch', kind: 'reresearch', status: complete ? 'completed' : 'in_progress', postcard_id: postcardId,
      created_at: startedAt, started_at: startedAt, completed_at: complete ? new Date().toISOString() : null, error: null,
    } } });
  });

  const dialog = await openTarget(page);
  await dialog.getByRole('button', { name: '再研究', exact: true }).click();
  const job = page.locator('.job-card').filter({ hasText: '再研究' });
  await expect(job).toBeVisible();
  await expect(job).toContainText(/AI 研究中 · 00:00:0[4-9]/);
  await expect(job).toContainText('已完成', { timeout: 8_000 });
  await expect(dialog.locator('.research-summary-copy')).toHaveText('Playwright 驗證：再研究完成後已從管理 API 更新。');
});

test('new postcard form uploads an image and keeps the background job visible until completion', async ({ page }) => {
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
    await route.fulfill({ status: 202, json: { job: {
      id: 'job-ui-add', kind: 'add', status: 'queued', postcard_id: null,
      created_at: startedAt, started_at: startedAt, completed_at: null, error: null,
    } } });
  });
  await page.route('**/api/jobs/job-ui-add', async (route) => {
    polls += 1;
    completed = polls >= 2;
    await route.fulfill({ json: { job: {
      id: 'job-ui-add', kind: 'add', status: completed ? 'completed' : 'in_progress', postcard_id: completed ? 'pc-9999' : null,
      created_at: startedAt, started_at: startedAt, completed_at: completed ? new Date().toISOString() : null, error: null,
    } } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /新增明信片/ }).click();
  const form = page.getByRole('dialog', { name: '新增明信片' });
  await expect(form).toContainText('AI 已連線 · test-model');
  await form.locator('input[type="file"]').setInputFiles(path.resolve('public/images/postcards/2026/05/pc-020.png'));
  await form.getByLabel('給研究流程的備註（選填）').fill('Playwright UI test');
  await form.getByRole('button', { name: '保存並開始研究' }).click();

  const job = page.locator('.job-card').filter({ hasText: '新增明信片' });
  await expect(job).toBeVisible();
  await expect(job).toContainText('已完成', { timeout: 8_000 });
  await expect(page.getByRole('dialog', { name: 'Playwright 新增明信片' })).toBeVisible();
  expect(receivedUpload).toBe(true);
});
