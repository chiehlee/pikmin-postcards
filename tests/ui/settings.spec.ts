import { expect, type Page, test } from '@playwright/test';

type SettingsPayload = {
  provider: 'openai_api' | 'local_codex';
  provider_ready: boolean;
  api_key_configured: boolean;
  api_key_hint: string | null;
  api_key_source: 'settings_file' | 'environment' | 'none';
  model: string;
  openai_model: string;
  codex_model: string;
  reasoning_effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  openai_reasoning_effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  codex_reasoning_effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  reasoning_effort_suggestions: Array<'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
  model_suggestions: string[];
  local_codex: {
    installed: boolean;
    authenticated: boolean;
    available: boolean;
    command: string;
    version: string | null;
    auth_status: string;
  };
  secret_write_allowed: boolean;
  persistence: string;
};

const savedKey = 'sk-project-playwright_secret_123456789';

function settings(overrides: Partial<SettingsPayload> = {}): SettingsPayload {
  return {
    provider: 'openai_api',
    provider_ready: false,
    api_key_configured: false,
    api_key_hint: null,
    api_key_source: 'none',
    model: 'gpt-5.6',
    openai_model: 'gpt-5.6',
    codex_model: 'gpt-5.6-sol',
    reasoning_effort: 'high',
    openai_reasoning_effort: 'high',
    codex_reasoning_effort: 'high',
    reasoning_effort_suggestions: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    model_suggestions: ['gpt-5.6', 'gpt-5.6-terra'],
    local_codex: {
      installed: true,
      authenticated: true,
      available: true,
      command: 'codex',
      version: 'codex-cli 0.test',
      auth_status: 'Logged in using ChatGPT',
    },
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
        provider: String(body.provider) as SettingsPayload['provider'],
        provider_ready: body.provider === 'local_codex' ? current.local_codex.available : current.api_key_configured || Boolean(body.api_key),
        api_key_configured: current.api_key_configured || Boolean(body.api_key),
        api_key_hint: body.api_key ? '••••6789' : current.api_key_hint,
        api_key_source: body.api_key ? 'settings_file' : current.api_key_source,
        model: String(body.model),
        openai_model: body.provider === 'openai_api' ? String(body.model) : current.openai_model,
        codex_model: body.provider === 'local_codex' ? String(body.model) : current.codex_model,
        reasoning_effort: String(body.reasoning_effort) as SettingsPayload['reasoning_effort'],
        openai_reasoning_effort: body.provider === 'openai_api'
          ? String(body.reasoning_effort) as SettingsPayload['reasoning_effort']
          : current.openai_reasoning_effort,
        codex_reasoning_effort: body.provider === 'local_codex'
          ? String(body.reasoning_effort) as SettingsPayload['reasoning_effort']
          : current.codex_reasoning_effort,
        model_suggestions: body.provider === 'local_codex' ? ['gpt-5.6-sol', 'gpt-5.6-terra'] : ['gpt-5.6', 'gpt-5.6-terra'],
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
        provider: body.provider,
        checked_at: new Date().toISOString(),
        model: body.model,
        model_available: true,
        accessible_model_count: body.provider === 'local_codex' ? null : 7,
        version: body.provider === 'local_codex' ? 'codex-cli 0.test' : undefined,
        auth_status: body.provider === 'local_codex' ? 'Logged in using ChatGPT' : undefined,
        message: body.provider === 'local_codex' ? '本機測試完成' : undefined,
        reasoning_effort: body.reasoning_effort,
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
  await expect(page.getByText('API key 未設定', { exact: true })).toBeVisible();
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
    body: { provider: 'openai_api', model: 'gpt-5.6-terra', reasoning_effort: 'high', api_key: savedKey },
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
  await page.getByRole('button', { name: '儲存 OpenAI API Key 設定' }).click();
  await expect(page.getByRole('status')).toContainText('OpenAI API Key、研究模型與推理深度已保存');
  await page.getByRole('button', { name: '測試目前連線' }).click();
  await expect(page.getByRole('status')).toContainText('目前 server-side key 可以連線');

  expect(state.requests).toEqual([
    { method: 'PUT', body: { provider: 'openai_api', model: 'gpt-5.6-terra', reasoning_effort: 'high' } },
    { method: 'TEST', body: { provider: 'openai_api', model: 'gpt-5.6-terra', reasoning_effort: 'high' } },
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
  await expect(page.getByText('API key 未設定', { exact: true })).toBeVisible();
  expect(state.requests.at(-1)).toEqual({ method: 'DELETE', body: {} });
});

test('local Codex selection shows setup commands, persists provider, and runs a CLI probe', async ({ page }) => {
  const state = await mockSettings(page, settings());
  await page.goto('/settings');

  await page.getByLabel('AI 研究來源').selectOption('local_codex');
  await expect(page.getByRole('heading', { name: '安裝與登入' })).toBeVisible();
  await expect(page.getByText('curl -fsSL https://chatgpt.com/codex/install.sh | sh')).toBeVisible();
  await expect(page.getByText('codex login', { exact: true })).toBeVisible();
  await expect(page.getByText('codex login status', { exact: true })).toBeVisible();
  await page.getByLabel('研究模型').fill('gpt-5.6-sol');
  await expect(page.getByLabel('推理深度').locator('option')).toHaveText([
    'None（最快）', 'Low（較快）', 'Medium（一般）', 'High（建議）', 'XHigh（深入）', 'Max（最深入）',
  ]);
  await page.getByLabel('推理深度').selectOption('xhigh');
  await expect(page.getByLabel('推理深度')).toHaveValue('xhigh');
  await page.getByRole('button', { name: '儲存 本機 Codex 設定' }).click();
  await expect(page.getByRole('status')).toContainText('本機 Codex、研究模型與推理深度已保存');
  await page.getByRole('button', { name: '執行 Codex 測試' }).click();
  await expect(page.getByRole('status')).toContainText('本機 Codex 可以執行模型工作');

  expect(state.requests).toEqual([
    { method: 'PUT', body: { provider: 'local_codex', model: 'gpt-5.6-sol', reasoning_effort: 'xhigh' } },
    { method: 'TEST', body: { provider: 'local_codex', model: 'gpt-5.6-sol', reasoning_effort: 'xhigh' } },
  ]);
});
