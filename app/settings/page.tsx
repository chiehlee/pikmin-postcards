'use client';
/* eslint-disable @next/next/no-html-link-for-pages -- Vinext production client navigation does not complete cross-route Links */

import { type FormEvent, useCallback, useEffect, useState } from 'react';

type Settings = {
  provider: 'openai_api' | 'local_codex';
  provider_ready: boolean;
  api_key_configured: boolean;
  api_key_hint: string | null;
  api_key_source: 'settings_file' | 'environment' | 'none';
  model: string;
  openai_model: string;
  codex_model: string;
  reasoning_effort: ReasoningEffort;
  openai_reasoning_effort: ReasoningEffort;
  codex_reasoning_effort: ReasoningEffort;
  reasoning_effort_suggestions: ReasoningEffort[];
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

type Connection = {
  ok: boolean;
  checked_at: string;
  provider?: 'openai_api' | 'local_codex';
  model: string;
  model_available: boolean;
  accessible_model_count: number | null;
  version?: string | null;
  auth_status?: string;
  message?: string;
  reasoning_effort?: ReasoningEffort;
};

type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

function sourceLabel(source: Settings['api_key_source']) {
  if (source === 'settings_file') return '由設定頁保存';
  if (source === 'environment') return '由啟動環境提供';
  return '尚未設定';
}

function providerLabel(provider: Settings['provider']) {
  return provider === 'local_codex' ? '本機 Codex' : 'OpenAI API Key';
}

const reasoningLabels: Record<ReasoningEffort, string> = {
  none: 'None（最快）',
  low: 'Low（較快）',
  medium: 'Medium（一般）',
  high: 'High（建議）',
  xhigh: 'XHigh（深入）',
  max: 'Max（最深入）',
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [provider, setProvider] = useState<Settings['provider']>('openai_api');
  const [model, setModel] = useState('gpt-5.6');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('high');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'loading' | 'saving' | 'testing' | 'removing' | null>('loading');
  const [feedback, setFeedback] = useState('正在讀取 server 設定…');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = useCallback(async () => {
    const payload = await responseJson<{ settings: Settings }>(await fetch('/api/settings', { cache: 'no-store' }));
    setSettings(payload.settings);
    setProvider(payload.settings.provider);
    setModel(payload.settings.model);
    setReasoningEffort(payload.settings.reasoning_effort);
    return payload.settings;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      refresh()
        .then((current) => {
          if (!cancelled) setFeedback(current.provider_ready
            ? `${providerLabel(current.provider)} 已就緒；尚未執行本次連線測試。`
            : `${providerLabel(current.provider)} 尚未完成設定。`);
        })
        .catch((error) => {
          if (!cancelled) setFeedback(error instanceof Error ? error.message : '設定讀取失敗。');
        })
        .finally(() => {
          if (!cancelled) setBusy(null);
        });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [refresh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('saving');
    setConnection(null);
    setFeedback(provider === 'openai_api' && apiKey.trim()
      ? '正在驗證 key；通過後才會保存…'
      : `正在保存 ${providerLabel(provider)} 設定…`);
    try {
      const payload = await responseJson<{ settings: Settings; connection: Connection | null }>(await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          reasoning_effort: reasoningEffort,
          ...(provider === 'openai_api' && apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        }),
      }));
      setSettings(payload.settings);
      setProvider(payload.settings.provider);
      setModel(payload.settings.model);
      setReasoningEffort(payload.settings.reasoning_effort);
      setApiKey('');
      setConnection(payload.connection);
      setFeedback(payload.connection
        ? '連線驗證成功，API key 與研究模型已保存。'
        : `${providerLabel(payload.settings.provider)}、研究模型與推理深度已保存。`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '設定保存失敗。');
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy('testing');
    setConnection(null);
    setFeedback(provider === 'local_codex' ? '正在執行小型本機 Codex 測試…' : '正在向 OpenAI 驗證連線…');
    try {
      const payload = await responseJson<{ settings: Settings; connection: Connection }>(await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          reasoning_effort: reasoningEffort,
          ...(provider === 'openai_api' && apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        }),
      }));
      setSettings(payload.settings);
      setConnection(payload.connection);
      setFeedback(provider === 'local_codex'
        ? `本機 Codex 可以執行模型工作。${payload.connection.message ? ` ${payload.connection.message}` : ''}`
        : apiKey.trim() ? '這組尚未保存的 key 可以連線。' : '目前 server-side key 可以連線。');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '連線測試失敗。');
    } finally {
      setBusy(null);
    }
  }

  async function removeKey() {
    setBusy('removing');
    setConnection(null);
    setFeedback('正在從本機設定移除 API key…');
    try {
      const payload = await responseJson<{ settings: Settings; environment_value_can_return_on_restart: boolean }>(await fetch('/api/settings', {
        method: 'DELETE',
      }));
      setSettings(payload.settings);
      setApiKey('');
      setConfirmRemove(false);
      setFeedback(payload.environment_value_can_return_on_restart
        ? '目前 process 已移除 key；它由啟動環境提供，下次重啟仍可能再次出現。'
        : 'API key 已從目前 process 與 .env.local 移除。');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'API key 移除失敗。');
    } finally {
      setBusy(null);
    }
  }

  const secretAllowed = settings?.secret_write_allowed ?? false;
  const disabled = busy !== null;

  function changeProvider(nextProvider: Settings['provider']) {
    setProvider(nextProvider);
    setConnection(null);
    if (settings) {
      setModel(nextProvider === 'local_codex' ? settings.codex_model : settings.openai_model);
      setReasoningEffort(nextProvider === 'local_codex'
        ? settings.codex_reasoning_effort
        : settings.openai_reasoning_effort);
    }
    setFeedback(`已選擇 ${providerLabel(nextProvider)}；按下保存後套用到新增與再研究工作。`);
  }

  return (
    <main className="settings-shell">
      <header className="site-header settings-site-header">
        <a className="brand" href="/" aria-label="回到明信片收藏研究庫">
          <span className="brand-mark">P</span>
          <span>
            <strong>Postcard Archive</strong>
            <small>Pikmin Bloom collection</small>
          </span>
        </a>
        <nav className="view-switch" aria-label="主要頁面">
          <a href="/">收藏庫</a>
          <a href="/settings" className="active" aria-current="page">設定</a>
        </nav>
        <div className="archive-state"><span />server-side 設定</div>
      </header>

      <section className="settings-intro">
        <p className="eyebrow">LOCAL CONTROL PANEL</p>
        <h1>設定</h1>
        <p>選擇 UI「新增明信片」與「再研究」使用本機 Codex（ChatGPT 登入）或 OpenAI API Key。兩者都會遵守專案 SKILL，研究完成後再由網站更新 DB。</p>
      </section>

      <section className="settings-content" aria-label="AI 研究設定">
        <div className="settings-status-grid" aria-label="目前狀態">
          <article>
            <span>AI 研究來源</span>
            <strong>{settings ? providerLabel(settings.provider) : '讀取中'}</strong>
            <small>{settings?.provider_ready ? '目前可執行研究工作' : '尚未完成必要設定'}</small>
          </article>
          <article>
            <span>連線狀態</span>
            <strong>{settings?.provider === 'local_codex'
              ? settings.local_codex.authenticated ? 'ChatGPT 已登入' : settings.local_codex.installed ? '尚未登入' : '尚未安裝'
              : settings?.api_key_configured ? 'API key 已設定' : 'API key 未設定'}</strong>
            <small>{settings?.provider === 'local_codex'
              ? settings.local_codex.version ?? settings.local_codex.auth_status
              : `${sourceLabel(settings?.api_key_source ?? 'none')} · ${settings?.api_key_hint ?? '無 key'}`}</small>
          </article>
          <article>
            <span>研究模型</span>
            <strong>{settings?.model ?? model}</strong>
            <small>推理深度 · {reasoningLabels[settings?.reasoning_effort ?? reasoningEffort]}</small>
          </article>
        </div>

        {!secretAllowed && settings?.provider === 'openai_api' && (
          <aside className="settings-boundary" role="note">
            <strong>目前是內網／VPN 唯讀祕密模式</strong>
            <p>這個站點目前使用 HTTP。為避免 API key 在網路上明文傳送，請在主機瀏覽器開啟 <code>http://localhost:3000/settings</code> 設定或移除 key。這裡仍可修改模型，並測試 server 已保存的連線。</p>
          </aside>
        )}

        <div className="settings-columns">
          <form className="settings-panel" onSubmit={save}>
            <div className="settings-panel-heading">
              <div>
                <p className="eyebrow">AI PROVIDER</p>
                <h2>研究執行方式</h2>
              </div>
              <span className={settings?.provider_ready ? 'settings-pill connected' : 'settings-pill'}>
                {settings?.provider_ready ? 'READY' : 'SETUP NEEDED'}
              </span>
            </div>

            <label className="settings-field">
              <span>AI 研究來源</span>
              <select
                name="provider"
                aria-label="AI 研究來源"
                value={provider}
                onChange={(event) => changeProvider(event.target.value as Settings['provider'])}
                disabled={disabled}
              >
                <option value="local_codex">本機 Codex（使用 ChatGPT 登入）</option>
                <option value="openai_api">OpenAI API Key（API 用量計費）</option>
              </select>
              <small>保存後，新建立的「新增」與「再研究」工作會使用這個來源；既有工作不會被切換。</small>
            </label>

            <label className="settings-field">
              <span>研究模型</span>
              <input
                name="model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                list="model-suggestions"
                autoComplete="off"
                required
                disabled={disabled}
              />
              <datalist id="model-suggestions">
                {(provider === settings?.provider
                  ? settings?.model_suggestions
                  : provider === 'local_codex' ? ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] : ['gpt-5.6'])?.map((item) => <option key={item} value={item} />)}
              </datalist>
              <small>{provider === 'local_codex' ? '使用 Codex CLI 帳號可選的模型；預設建議 gpt-5.6-sol。' : '使用 OpenAI Platform 帳號實際可用的 API model ID。'}</small>
            </label>

            <label className="settings-field">
              <span>推理深度（Thinking level）</span>
              <select
                name="reasoning-effort"
                aria-label="推理深度"
                value={reasoningEffort}
                onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
                disabled={disabled}
              >
                {(settings?.reasoning_effort_suggestions ?? ['none', 'low', 'medium', 'high', 'xhigh', 'max']).map((effort) => (
                  <option key={effort} value={effort}>{reasoningLabels[effort]}</option>
                ))}
              </select>
              <small>越高通常研究越深入，但需要更長時間與更多用量；None 到 Max 是否可用取決於所選模型。</small>
            </label>

            {provider === 'openai_api' ? (
              <label className="settings-field">
                <span>新的／替換用 API key</span>
                <input
                  name="api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={secretAllowed ? 'sk-…（留白代表不更動）' : '只能從 localhost 輸入'}
                  autoComplete="new-password"
                  spellCheck={false}
                  disabled={disabled || !secretAllowed}
                  aria-describedby="api-key-help"
                />
                <small id="api-key-help">送出新 key 時會先呼叫 OpenAI 驗證；失敗就不保存。已存 key 不會重新顯示。</small>
              </label>
            ) : (
              <section className="codex-setup" aria-labelledby="codex-setup-title">
                <div className="codex-setup-heading">
                  <div>
                    <span className="eyebrow">LOCAL CODEX</span>
                    <h3 id="codex-setup-title">安裝與登入</h3>
                  </div>
                  <span className={settings?.local_codex.available ? 'settings-pill connected' : 'settings-pill'}>
                    {settings?.local_codex.available ? 'DETECTED' : 'CHECK SETUP'}
                  </span>
                </div>
                <p>{settings?.local_codex.auth_status ?? '正在檢查 Codex CLI…'}</p>
                <ol>
                  <li><span>安裝／更新 Codex CLI</span><code>curl -fsSL https://chatgpt.com/codex/install.sh | sh</code></li>
                  <li><span>使用 ChatGPT 帳號登入</span><code>codex login</code></li>
                  <li><span>確認登入狀態</span><code>codex login status</code></li>
                </ol>
                <small>偵測命令：<code>{settings?.local_codex.command ?? 'codex'}</code>。研究時使用 ephemeral、read-only sandbox；Codex 不直接寫入網站資料。</small>
              </section>
            )}

            <div className="settings-actions">
              <button type="submit" className="settings-primary" disabled={disabled || !model.trim()}>
                {busy === 'saving' ? '保存中…' : provider === 'openai_api' && apiKey.trim() ? '儲存並測試連線' : `儲存 ${providerLabel(provider)} 設定`}
              </button>
              <button type="button" className="settings-secondary" onClick={testConnection} disabled={disabled || (provider === 'openai_api' && !settings?.api_key_configured && !apiKey.trim())}>
                {busy === 'testing' ? '測試中…' : provider === 'local_codex' ? '執行 Codex 測試' : apiKey.trim() ? '先測試這組 key' : '測試目前連線'}
              </button>
            </div>
          </form>

          <aside className="settings-panel settings-safety">
            <p className="eyebrow">SECURITY BOUNDARY</p>
            <h2>{provider === 'local_codex' ? '本機執行範圍' : 'API 保存範圍'}</h2>
            {provider === 'local_codex' ? (
              <dl>
                <div><dt>登入</dt><dd>由 Codex CLI 管理 ChatGPT 登入；網站不接收 token</dd></div>
                <div><dt>圖片</dt><dd>以這台 Mac 上的本機路徑交給 Codex</dd></div>
                <div><dt>執行權限</dt><dd><code>ephemeral</code> session、<code>read-only</code> sandbox</dd></div>
                <div><dt>資料更新</dt><dd>Codex 只回傳 schema JSON；網站驗證後才寫 DB</dd></div>
              </dl>
            ) : (
              <>
                <dl>
                  <div><dt>瀏覽器</dt><dd>只收到已設定、末四碼與來源</dd></div>
                  <div><dt>本機檔案</dt><dd><code>.env.local</code>，權限 0600</dd></div>
                  <div><dt>研究工作</dt><dd>保存 model、prompt 與狀態，不保存 key</dd></div>
                  <div><dt>Git／SQLite</dt><dd>不寫入 API key</dd></div>
                </dl>

                <div className="settings-danger-zone">
                  <strong>移除 API key</strong>
                  <p>不會刪除既有明信片、原圖、研究或工作紀錄；尚未完成的 AI 工作可能無法繼續查詢。</p>
                  {!confirmRemove ? (
                    <button type="button" onClick={() => setConfirmRemove(true)} disabled={disabled || !secretAllowed || !settings?.api_key_configured}>移除 API key…</button>
                  ) : (
                    <div className="settings-confirm" role="alertdialog" aria-label="確認移除 API key">
                      <span>確定從目前 server 移除？</span>
                      <button type="button" onClick={removeKey} disabled={disabled}>確認移除</button>
                      <button type="button" onClick={() => setConfirmRemove(false)} disabled={disabled}>取消</button>
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>

        <div className="settings-feedback" role="status" aria-live="polite">
          {busy && busy !== 'loading' ? <span className="job-spinner" aria-hidden="true" /> : <span className={connection?.ok ? 'feedback-dot success' : 'feedback-dot'} aria-hidden="true" />}
          <div>
            <strong>{connection?.ok ? `${providerLabel(provider)} 連線正常` : '設定狀態'}</strong>
            <p>{feedback}</p>
            {connection && (
              <small>{connection.provider === 'local_codex'
                ? `檢查模型：${connection.model} · ${reasoningLabels[connection.reasoning_effort ?? reasoningEffort]} · ${connection.version ?? 'Codex CLI'} · ${connection.auth_status ?? 'ChatGPT 登入'}`
                : `檢查模型：${connection.model} · ${reasoningLabels[connection.reasoning_effort ?? reasoningEffort]} · ${connection.model_available ? '清單中可見' : '清單中未列出'} · 帳號可讀取 ${connection.accessible_model_count ?? 0} 個模型`}</small>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
