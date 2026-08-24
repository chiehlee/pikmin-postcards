import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../db/database.mjs";
import {
  defaultCodexCommand,
  defaultCodexResearchModel,
  localCodexStatus,
  verifyLocalCodexConnection,
} from "./local-codex.mjs";
import { defaultResearchModel, verifyOpenAIConnection } from "./openai-research.mjs";

export const defaultSettingsPath = path.join(projectRoot, ".env.local");
export const defaultResearchProvider = "openai_api";
export const supportedOpenAIModelSuggestions = [
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
];
export const supportedCodexModelSuggestions = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
];
export const defaultReasoningEffort = "high";
export const supportedReasoningEfforts = ["none", "low", "medium", "high", "xhigh", "max"];

export async function settingsStatus({
  envFilePath = defaultSettingsPath,
  runtimeEnv = process.env,
  secretWriteAllowed = false,
  codexStatusImpl = localCodexStatus,
} = {}) {
  const fileValues = parseEnv(await readOptionalFile(envFilePath));
  const apiKey = runtimeEnv.OPENAI_API_KEY?.trim() || "";
  const provider = validateProvider(runtimeEnv.PIKMIN_AI_PROVIDER?.trim()
    || fileValues.PIKMIN_AI_PROVIDER?.trim()
    || defaultResearchProvider);
  const openaiModel = runtimeEnv.PIKMIN_OPENAI_MODEL?.trim()
    || fileValues.PIKMIN_OPENAI_MODEL?.trim()
    || defaultResearchModel;
  const codexModel = runtimeEnv.PIKMIN_CODEX_MODEL?.trim()
    || fileValues.PIKMIN_CODEX_MODEL?.trim()
    || defaultCodexResearchModel;
  const openaiReasoningEffort = validateReasoningEffort(runtimeEnv.PIKMIN_OPENAI_REASONING_EFFORT?.trim()
    || fileValues.PIKMIN_OPENAI_REASONING_EFFORT?.trim()
    || defaultReasoningEffort);
  const codexReasoningEffort = validateReasoningEffort(runtimeEnv.PIKMIN_CODEX_REASONING_EFFORT?.trim()
    || fileValues.PIKMIN_CODEX_REASONING_EFFORT?.trim()
    || defaultReasoningEffort);
  const codexCommand = runtimeEnv.PIKMIN_CODEX_COMMAND?.trim()
    || fileValues.PIKMIN_CODEX_COMMAND?.trim()
    || defaultCodexCommand;
  const codex = await codexStatusImpl({ command: codexCommand });
  const model = provider === "local_codex" ? codexModel : openaiModel;
  const reasoningEffort = provider === "local_codex" ? codexReasoningEffort : openaiReasoningEffort;
  return {
    provider,
    provider_ready: provider === "local_codex" ? codex.available : Boolean(apiKey),
    api_key_configured: Boolean(apiKey),
    api_key_hint: apiKey ? maskedKeyHint(apiKey) : null,
    api_key_source: apiKey
      ? (fileValues.OPENAI_API_KEY === apiKey ? "settings_file" : "environment")
      : "none",
    model,
    openai_model: openaiModel,
    codex_model: codexModel,
    reasoning_effort: reasoningEffort,
    openai_reasoning_effort: openaiReasoningEffort,
    codex_reasoning_effort: codexReasoningEffort,
    reasoning_effort_suggestions: supportedReasoningEfforts,
    model_suggestions: provider === "local_codex"
      ? supportedCodexModelSuggestions
      : supportedOpenAIModelSuggestions,
    local_codex: codex,
    secret_write_allowed: secretWriteAllowed,
    persistence: ".env.local",
  };
}

export async function saveSettings({ apiKey, model, provider, reasoningEffort }, {
  envFilePath = defaultSettingsPath,
  runtimeEnv = process.env,
  fetchImpl = globalThis.fetch,
  secretWriteAllowed = false,
  codexStatusImpl = localCodexStatus,
} = {}) {
  const fileValues = parseEnv(await readOptionalFile(envFilePath));
  const normalizedProvider = validateProvider(provider
    || runtimeEnv.PIKMIN_AI_PROVIDER
    || fileValues.PIKMIN_AI_PROVIDER
    || defaultResearchProvider);
  const normalizedModel = validateModel(model);
  const normalizedReasoningEffort = validateReasoningEffort(reasoningEffort || (
    normalizedProvider === "local_codex"
      ? runtimeEnv.PIKMIN_CODEX_REASONING_EFFORT || fileValues.PIKMIN_CODEX_REASONING_EFFORT || defaultReasoningEffort
      : runtimeEnv.PIKMIN_OPENAI_REASONING_EFFORT || fileValues.PIKMIN_OPENAI_REASONING_EFFORT || defaultReasoningEffort
  ));
  const normalizedKey = apiKey == null ? null : validateApiKey(apiKey);
  if (normalizedKey && !secretWriteAllowed) throw httpError(403, "只有從 localhost 開啟設定頁時才能送出 API key");
  if (normalizedKey && normalizedProvider !== "openai_api") throw httpError(400, "API key 只能保存於 OpenAI API provider");

  let connection = null;
  if (normalizedKey) {
    connection = {
      ...await verifyOpenAIConnection({
      apiKey: normalizedKey,
      model: normalizedModel,
      fetchImpl,
      }),
      reasoning_effort: normalizedReasoningEffort,
    };
  }

  const modelKey = normalizedProvider === "local_codex" ? "PIKMIN_CODEX_MODEL" : "PIKMIN_OPENAI_MODEL";
  const reasoningKey = normalizedProvider === "local_codex"
    ? "PIKMIN_CODEX_REASONING_EFFORT"
    : "PIKMIN_OPENAI_REASONING_EFFORT";
  const updates = {
    PIKMIN_AI_PROVIDER: normalizedProvider,
    [modelKey]: normalizedModel,
    [reasoningKey]: normalizedReasoningEffort,
  };
  if (normalizedKey) updates.OPENAI_API_KEY = normalizedKey;
  await updateEnvFile(envFilePath, updates);
  runtimeEnv.PIKMIN_AI_PROVIDER = normalizedProvider;
  runtimeEnv[modelKey] = normalizedModel;
  runtimeEnv[reasoningKey] = normalizedReasoningEffort;
  if (normalizedKey) runtimeEnv.OPENAI_API_KEY = normalizedKey;

  return {
    settings: await settingsStatus({ envFilePath, runtimeEnv, secretWriteAllowed, codexStatusImpl }),
    connection,
  };
}

/**
 * @param {{ apiKey?: string | null, model?: string | null, provider?: "openai_api" | "local_codex" | null, reasoningEffort?: string | null }} input
 * @param {{ envFilePath?: string, runtimeEnv?: NodeJS.ProcessEnv | Record<string, string | undefined>, fetchImpl?: typeof fetch, secretWriteAllowed?: boolean }} options
 */
export async function testSettingsConnection({ apiKey = null, model = null, provider = null, reasoningEffort = null } = {}, {
  envFilePath = defaultSettingsPath,
  runtimeEnv = process.env,
  fetchImpl = globalThis.fetch,
  secretWriteAllowed = false,
  codexStatusImpl = localCodexStatus,
  verifyLocalCodexConnectionImpl = verifyLocalCodexConnection,
} = {}) {
  const fileValues = parseEnv(await readOptionalFile(envFilePath));
  const effectiveProvider = validateProvider(provider
    || runtimeEnv.PIKMIN_AI_PROVIDER
    || fileValues.PIKMIN_AI_PROVIDER
    || defaultResearchProvider);
  const effectiveModel = validateModel(model || (
    effectiveProvider === "local_codex"
      ? runtimeEnv.PIKMIN_CODEX_MODEL || fileValues.PIKMIN_CODEX_MODEL || defaultCodexResearchModel
      : runtimeEnv.PIKMIN_OPENAI_MODEL || fileValues.PIKMIN_OPENAI_MODEL || defaultResearchModel
  ));
  const effectiveReasoningEffort = validateReasoningEffort(reasoningEffort || (
    effectiveProvider === "local_codex"
      ? runtimeEnv.PIKMIN_CODEX_REASONING_EFFORT || fileValues.PIKMIN_CODEX_REASONING_EFFORT || defaultReasoningEffort
      : runtimeEnv.PIKMIN_OPENAI_REASONING_EFFORT || fileValues.PIKMIN_OPENAI_REASONING_EFFORT || defaultReasoningEffort
  ));
  if (effectiveProvider === "local_codex") {
    const command = runtimeEnv.PIKMIN_CODEX_COMMAND?.trim()
      || fileValues.PIKMIN_CODEX_COMMAND?.trim()
      || defaultCodexCommand;
    const connection = await verifyLocalCodexConnectionImpl({
      command,
      model: effectiveModel,
      reasoningEffort: effectiveReasoningEffort,
      statusImpl: codexStatusImpl,
    });
    return {
      connection,
      settings: await settingsStatus({ envFilePath, runtimeEnv, secretWriteAllowed, codexStatusImpl }),
    };
  }

  const submittedKey = apiKey?.trim() || null;
  if (submittedKey && !secretWriteAllowed) throw httpError(403, "只有從 localhost 開啟設定頁時才能測試尚未保存的 API key");
  const effectiveKey = submittedKey ? validateApiKey(submittedKey) : runtimeEnv.OPENAI_API_KEY?.trim();
  if (!effectiveKey) throw httpError(400, "OPENAI_API_KEY 尚未設定");
  const connection = {
    ...await verifyOpenAIConnection({ apiKey: effectiveKey, model: effectiveModel, fetchImpl }),
    reasoning_effort: effectiveReasoningEffort,
  };
  return {
    connection,
    settings: await settingsStatus({ envFilePath, runtimeEnv, secretWriteAllowed, codexStatusImpl }),
  };
}

export async function removeApiKey({
  envFilePath = defaultSettingsPath,
  runtimeEnv = process.env,
  secretWriteAllowed = false,
  codexStatusImpl = localCodexStatus,
} = {}) {
  if (!secretWriteAllowed) throw httpError(403, "只有從 localhost 開啟設定頁時才能移除 API key");
  const statusBefore = await settingsStatus({ envFilePath, runtimeEnv, secretWriteAllowed, codexStatusImpl });
  await updateEnvFile(envFilePath, { OPENAI_API_KEY: null });
  delete runtimeEnv.OPENAI_API_KEY;
  return {
    settings: await settingsStatus({ envFilePath, runtimeEnv, secretWriteAllowed, codexStatusImpl }),
    environment_value_can_return_on_restart: statusBefore.api_key_source === "environment",
  };
}

export async function researchProviderConfiguration({
  envFilePath = defaultSettingsPath,
  runtimeEnv = process.env,
  codexStatusImpl = localCodexStatus,
} = {}) {
  const status = await settingsStatus({ envFilePath, runtimeEnv, codexStatusImpl });
  return {
    provider: status.provider,
    model: status.model,
    reasoning_effort: status.reasoning_effort,
    ready: status.provider_ready,
    codex_command: status.local_codex.command,
    codex_status: status.local_codex,
  };
}

export function isLoopbackRequest(request) {
  const hostname = new URL(request.url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function validateApiKey(value) {
  const key = value.trim();
  if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(key)) {
    throw httpError(400, "API key 格式不正確；請貼上完整且不含空白的 sk- key");
  }
  return key;
}

function validateModel(value) {
  const model = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,80}$/.test(model)) {
    throw httpError(400, "模型名稱格式不正確");
  }
  return model;
}

function validateProvider(value) {
  const provider = String(value ?? "").trim();
  if (!["openai_api", "local_codex"].includes(provider)) {
    throw httpError(400, "AI 研究來源必須是 OpenAI API 或本機 Codex");
  }
  return provider;
}

function validateReasoningEffort(value) {
  const reasoningEffort = String(value ?? "").trim();
  if (!supportedReasoningEfforts.includes(reasoningEffort)) {
    throw httpError(400, `推理深度必須是 ${supportedReasoningEfforts.join("、")}`);
  }
  return reasoningEffort;
}

function maskedKeyHint(apiKey) {
  return `••••${apiKey.slice(-4)}`;
}

async function updateEnvFile(envFilePath, updates) {
  const existing = await readOptionalFile(envFilePath);
  const keys = new Set(Object.keys(updates));
  const lines = existing ? existing.replace(/\r\n/g, "\n").split("\n") : [];
  const seen = new Set();
  const next = [];

  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !keys.has(match[1])) {
      next.push(line);
      continue;
    }
    const key = match[1];
    if (seen.has(key)) continue;
    seen.add(key);
    if (updates[key] != null) next.push(`${key}=${updates[key]}`);
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key) && value != null) next.push(`${key}=${value}`);
  }

  while (next.at(-1) === "") next.pop();
  if (!next.length) {
    await unlink(envFilePath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }

  await mkdir(path.dirname(envFilePath), { recursive: true });
  const temporaryPath = `${envFilePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${next.join("\n")}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, envFilePath);
  await chmod(envFilePath, 0o600);
}

async function readOptionalFile(filePath) {
  return readFile(filePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
}

function parseEnv(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[2].startsWith("#")) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    values[match[1]] = value;
  }
  return values;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
