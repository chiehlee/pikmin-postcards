'use client';
/* eslint-disable @next/next/no-html-link-for-pages -- Vinext production client navigation does not complete cross-route Links */

import { type FormEvent, useCallback, useEffect, useState } from 'react';

type Settings = {
  api_key_configured: boolean;
  api_key_hint: string | null;
  api_key_source: 'settings_file' | 'environment' | 'none';
  model: string;
  model_suggestions: string[];
  secret_write_allowed: boolean;
  persistence: string;
};

type Connection = {
  ok: boolean;
  checked_at: string;
  model: string;
  model_available: boolean;
  accessible_model_count: number;
};

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

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [model, setModel] = useState('gpt-5.6');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'loading' | 'saving' | 'testing' | 'removing' | null>('loading');
  const [feedback, setFeedback] = useState('正在讀取 server 設定…');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = useCallback(async () => {
    const payload = await responseJson<{ settings: Settings }>(await fetch('/api/settings', { cache: 'no-store' }));
    setSettings(payload.settings);
    setModel(payload.settings.model);
    return payload.settings;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      refresh()
        .then((current) => {
          if (!cancelled) setFeedback(current.api_key_configured ? '設定已載入；尚未執行本次連線測試。' : '設定已載入；目前尚未設定 API key。');
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
    setFeedback(apiKey.trim() ? '正在驗證 key；通過後才會保存…' : '正在保存研究模型…');
    try {
      const payload = await responseJson<{ settings: Settings; connection: Connection | null }>(await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) }),
      }));
      setSettings(payload.settings);
      setModel(payload.settings.model);
      setApiKey('');
      setConnection(payload.connection);
      setFeedback(payload.connection
        ? '連線驗證成功，API key 與研究模型已保存。'
        : '研究模型已保存；既有 API key 沒有被讀取或改寫。');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '設定保存失敗。');
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy('testing');
    setConnection(null);
    setFeedback('正在向 OpenAI 驗證連線…');
    try {
      const payload = await responseJson<{ settings: Settings; connection: Connection }>(await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) }),
      }));
      setSettings(payload.settings);
      setConnection(payload.connection);
      setFeedback(apiKey.trim() ? '這組尚未保存的 key 可以連線。' : '目前 server-side key 可以連線。');
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
        <p>管理 UI「新增明信片」與「再研究」使用的 OpenAI 連線。API key 只留在這台 Mac 的 server，不會寫入瀏覽器、SQLite 或 Git。</p>
      </section>

      <section className="settings-content" aria-label="AI 研究設定">
        <div className="settings-status-grid" aria-label="目前狀態">
          <article>
            <span>OPENAI API</span>
            <strong>{settings?.api_key_configured ? '已設定' : '未設定'}</strong>
            <small>{settings?.api_key_hint ?? '沒有可用的 server-side key'}</small>
          </article>
          <article>
            <span>來源</span>
            <strong>{settings ? sourceLabel(settings.api_key_source) : '讀取中'}</strong>
            <small>{settings?.persistence ?? '.env.local'} · key 本文永不回傳</small>
          </article>
          <article>
            <span>研究模型</span>
            <strong>{settings?.model ?? model}</strong>
            <small>每個新工作建立時固定記錄</small>
          </article>
        </div>

        {!secretAllowed && settings && (
          <aside className="settings-boundary" role="note">
            <strong>目前是內網／VPN 唯讀祕密模式</strong>
            <p>這個站點目前使用 HTTP。為避免 API key 在網路上明文傳送，請在主機瀏覽器開啟 <code>http://localhost:3000/settings</code> 設定或移除 key。這裡仍可修改模型，並測試 server 已保存的連線。</p>
          </aside>
        )}

        <div className="settings-columns">
          <form className="settings-panel" onSubmit={save}>
            <div className="settings-panel-heading">
              <div>
                <p className="eyebrow">AI CONNECTION</p>
                <h2>OpenAI 與研究模型</h2>
              </div>
              <span className={settings?.api_key_configured ? 'settings-pill connected' : 'settings-pill'}>
                {settings?.api_key_configured ? 'KEY READY' : 'KEY NEEDED'}
              </span>
            </div>

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
                {(settings?.model_suggestions ?? []).map((item) => <option key={item} value={item} />)}
              </datalist>
              <small>可使用建議值，也可輸入帳號實際可用的 model ID。</small>
            </label>

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

            <div className="settings-actions">
              <button type="submit" className="settings-primary" disabled={disabled || !model.trim()}>
                {busy === 'saving' ? '驗證／保存中…' : apiKey.trim() ? '儲存並測試連線' : '儲存模型'}
              </button>
              <button type="button" className="settings-secondary" onClick={testConnection} disabled={disabled || (!settings?.api_key_configured && !apiKey.trim())}>
                {busy === 'testing' ? '測試中…' : apiKey.trim() ? '先測試這組 key' : '測試目前連線'}
              </button>
            </div>
          </form>

          <aside className="settings-panel settings-safety">
            <p className="eyebrow">SECURITY BOUNDARY</p>
            <h2>保存範圍</h2>
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
          </aside>
        </div>

        <div className="settings-feedback" role="status" aria-live="polite">
          {busy && busy !== 'loading' ? <span className="job-spinner" aria-hidden="true" /> : <span className={connection?.ok ? 'feedback-dot success' : 'feedback-dot'} aria-hidden="true" />}
          <div>
            <strong>{connection?.ok ? 'OpenAI 連線正常' : '設定狀態'}</strong>
            <p>{feedback}</p>
            {connection && (
              <small>檢查模型：{connection.model} · {connection.model_available ? '清單中可見' : '清單中未列出'} · 帳號可讀取 {connection.accessible_model_count} 個模型</small>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
