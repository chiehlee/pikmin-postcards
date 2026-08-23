import { expect, type Page, test } from '@playwright/test';

type SettingsPayload = {
  api_key_configured: boolean;
  api_key_hint: string | null;
  api_key_source: 'settings_file' | 'environment' | 'none';
  model: string;
  model_suggestions: string[];
  secret_write_allowed: boolean;
  persistence: string;
};

const savedKey = 'sk-project-playwright_secret_123456789';

function settings(overrides: Partial<SettingsPayload> = {}): SettingsPayload {
  return {
    api_key_configured: false,
    api_key_hint: null,
    api_key_source: 'none',
    model: 'gpt-5.6',
    model_suggestions: ['gpt-5.6', 'gpt-5.6-terra'],
    secret_write_allowed: true,
    persistence: '.env.local',
    ...overrides,
  };
}

async function mockSettings(page: Page, initial: SettingsPayload) {
  let current = initial;
  const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
  await page.route('**/api/settings', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ json: { settings: current } });
      return;
    }
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requests.push({ method, body });
      current = settings({
        ...current,
        api_key_configured: current.api_key_configured || Boolean(body.api_key),
        api_key_hint: body.api_key ? '••••6789' : current.api_key_hint,
        api_key_source: body.api_key ? 'settings_file' : current.api_key_source,
        model: String(body.model),
      });
      await route.fulfill({ json: {
        settings: current,
        connection: body.api_key ? {
          ok: true,
          checked_at: new Date().toISOString(),
          model: body.model,
          model_available: true,
          accessible_model_count: 7,
        } : null,
      } });
      return;
    }
    if (method === 'DELETE') {
      requests.push({ method, body: {} });
      current = settings({ ...current, api_key_configured: false, api_key_hint: null, api_key_source: 'none' });
      await route.fulfill({ json: { settings: current, environment_value_can_return_on_restart: false } });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/settings/test', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push({ method: 'TEST', body });
    await route.fulfill({ json: {
      settings: current,
      connection: {
        ok: true,
        checked_at: new Date().toISOString(),
        model: body.model,
        model_available: true,
        accessible_model_count: 7,
      },
    } });
  });
  return { requests };
}

test('archive header exposes the settings page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: '開啟設定頁' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
});

test('localhost settings can validate and save a new key without rendering it back', async ({ page }) => {
  const state = await mockSettings(page, settings());
  await page.goto('/settings');

  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
  await expect(page.getByText('未設定', { exact: true })).toBeVisible();
  const keyInput = page.getByLabel('新的／替換用 API key');
  await expect(keyInput).toHaveAttribute('type', 'password');
  await keyInput.fill(savedKey);
  await page.getByLabel('研究模型').fill('gpt-5.6-terra');
  await page.getByRole('button', { name: '儲存並測試連線' }).click();

  await expect(page.getByRole('status')).toContainText('連線驗證成功');
  await expect(keyInput).toHaveValue('');
  await expect(page.getByText('••••6789')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(savedKey);
  expect(state.requests[0]).toEqual({
    method: 'PUT',
    body: { model: 'gpt-5.6-terra', api_key: savedKey },
  });
});

test('LAN settings keep secrets read-only while allowing model save and saved-key test', async ({ page }) => {
  const state = await mockSettings(page, settings({
    api_key_configured: true,
    api_key_hint: '••••4321',
    api_key_source: 'settings_file',
    secret_write_allowed: false,
  }));
  await page.goto('/settings');

  await expect(page.getByText('目前是內網／VPN 唯讀祕密模式')).toBeVisible();
  await expect(page.getByLabel('新的／替換用 API key')).toBeDisabled();
  await page.getByLabel('研究模型').fill('gpt-5.6-terra');
  await page.getByRole('button', { name: '儲存模型' }).click();
  await expect(page.getByRole('status')).toContainText('研究模型已保存');
  await page.getByRole('button', { name: '測試目前連線' }).click();
  await expect(page.getByRole('status')).toContainText('目前 server-side key 可以連線');

  expect(state.requests).toEqual([
    { method: 'PUT', body: { model: 'gpt-5.6-terra' } },
    { method: 'TEST', body: { model: 'gpt-5.6-terra' } },
  ]);
  await expect(page.getByRole('button', { name: /移除 API key/ })).toBeDisabled();
});

test('removing a key requires an explicit inline confirmation', async ({ page }) => {
  const state = await mockSettings(page, settings({
    api_key_configured: true,
    api_key_hint: '••••4321',
    api_key_source: 'settings_file',
  }));
  await page.goto('/settings');

  await page.getByRole('button', { name: '移除 API key…' }).click();
  const confirmation = page.getByRole('alertdialog', { name: '確認移除 API key' });
  await expect(confirmation).toContainText('確定從目前 server 移除？');
  await confirmation.getByRole('button', { name: '確認移除' }).click();
  await expect(page.getByRole('status')).toContainText('API key 已從目前 process 與 .env.local 移除');
  await expect(page.getByText('未設定', { exact: true })).toBeVisible();
  expect(state.requests.at(-1)).toEqual({ method: 'DELETE', body: {} });
});
