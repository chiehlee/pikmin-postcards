import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../db/database.mjs";
import { defaultResearchModel, verifyOpenAIConnection } from "./openai-research.mjs";

export const defaultSettingsPath = path.join(projectRoot, ".env.local");
export const supportedModelSuggestions = [
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
];

export async function settingsStatus({
  envFilePath = defaultSettingsPath,
  runtimeEnv = process.env,
  secretWriteAllowed = false,
} = {}) {
  const fileValues = parseEnv(await readOptionalFile(envFilePath));
  const apiKey = runtimeEnv.OPENAI_API_KEY?.trim() || "";
  const model = runtimeEnv.PIKMIN_OPENAI_MODEL?.trim()
    || fileValues.PIKMIN_OPENAI_MODEL?.trim()
    || defaultResearchModel;
  return {
    api_key_configured: Boolean(apiKey),
    api_key_hint: apiKey ? maskedKeyHint(apiKey) : null,
    api_key_source: apiKey
      ? (fileValues.OPENAI_API_KEY === apiKey ? "settings_file" : "environment")
      : "none",
    model,
    model_suggestions: supportedModelSuggestions,
    secret_write_allowed: secretWriteAllowed,
    persistence: ".env.local",
  };
}

export async function saveSettings({ apiKey, model }, {
  envFilePath = defaultSettingsPath,
  runtimeEnv = process.env,
  fetchImpl = globalThis.fetch,
  secretWriteAllowed = false,
} = {}) {
  const normalizedModel = validateModel(model);
  const normalizedKey = apiKey == null ? null : validateApiKey(apiKey);
  if (normalizedKey && !secretWriteAllowed) throw httpError(403, "只有從 localhost 開啟設定頁時才能送出 API key");

  let connection = null;
  if (normalizedKey) {
    connection = await verifyOpenAIConnection({
      apiKey: normalizedKey,
      model: normalizedModel,
      fetchImpl,
    });
  }

  const updates = { PIKMIN_OPENAI_MODEL: normalizedModel };
  if (normalizedKey) updates.OPENAI_API_KEY = normalizedKey;
  await updateEnvFile(envFilePath, updates);
  runtimeEnv.PIKMIN_OPENAI_MODEL = normalizedModel;
  if (normalizedKey) runtimeEnv.OPENAI_API_KEY = normalizedKey;

  return {
    settings: await settingsStatus({ envFilePath, runtimeEnv, secretWriteAllowed }),
    connection,
  };
}

/**
 * @param {{ apiKey?: string | null, model?: string | null }} input
 * @param {{ envFilePath?: string, runtimeEnv?: NodeJS.ProcessEnv | Record<string, string | undefined>, fetchImpl?: typeof fetch, secretWriteAllowed?: boolean }} options
 */
export async function testSettingsConnection({ apiKey = null, model = null } = {}, {
  envFilePath = defaultSettingsPath,
  runtimeEnv = process.env,
  fetchImpl = globalThis.fetch,
  secretWriteAllowed = false,
} = {}) {
  const submittedKey = apiKey?.trim() || null;
  if (submittedKey && !secretWriteAllowed) throw httpError(403, "只有從 localhost 開啟設定頁時才能測試尚未保存的 API key");
  const effectiveKey = submittedKey ? validateApiKey(submittedKey) : runtimeEnv.OPENAI_API_KEY?.trim();
  if (!effectiveKey) throw httpError(400, "OPENAI_API_KEY 尚未設定");
  const effectiveModel = validateModel(model || runtimeEnv.PIKMIN_OPENAI_MODEL || defaultResearchModel);
  const connection = await verifyOpenAIConnection({ apiKey: effectiveKey, model: effectiveModel, fetchImpl });
  return {
    connection,
    settings: await settingsStatus({ envFilePath, runtimeEnv, secretWriteAllowed }),
  };
}

export async function removeApiKey({
  envFilePath = defaultSettingsPath,
  runtimeEnv = process.env,
  secretWriteAllowed = false,
} = {}) {
  if (!secretWriteAllowed) throw httpError(403, "只有從 localhost 開啟設定頁時才能移除 API key");
  const statusBefore = await settingsStatus({ envFilePath, runtimeEnv, secretWriteAllowed });
  await updateEnvFile(envFilePath, { OPENAI_API_KEY: null });
  delete runtimeEnv.OPENAI_API_KEY;
  return {
    settings: await settingsStatus({ envFilePath, runtimeEnv, secretWriteAllowed }),
    environment_value_can_return_on_restart: statusBefore.api_key_source === "environment",
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
