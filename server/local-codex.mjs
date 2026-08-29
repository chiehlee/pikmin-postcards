import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { projectRoot } from "../db/database.mjs";
import { metadataReasoningEffort, metadataSchema, researchSchema } from "./openai-research.mjs";

const execFileAsync = promisify(execFile);
const maxCapturedBytes = 4 * 1024 * 1024;

export const defaultCodexCommand = "codex";
export const defaultCodexResearchModel = "gpt-5.6-sol";
export const defaultCodexReasoningEffort = "high";
const codexAppServerStartupDelayMs = 750;

export async function localCodexUsage({
  command = process.env.PIKMIN_CODEX_COMMAND?.trim() || defaultCodexCommand,
  requestImpl = requestCodexRateLimits,
  checkedAt = new Date(),
} = {}) {
  const result = await requestImpl({ command });
  return normalizeCodexRateLimits(result, { checkedAt });
}

export function normalizeCodexRateLimits(result, { checkedAt = new Date() } = {}) {
  const limits = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  if (!limits || typeof limits !== "object") {
    throw new Error("Codex App Server 未回傳帳戶用量");
  }
  const windows = [limits.primary, limits.secondary]
    .filter((window) => window && Number.isFinite(Number(window.windowDurationMins)))
    .map((window) => normalizeCodexUsageWindow(window));
  if (windows.length === 0) throw new Error("Codex App Server 未回傳可用的配額視窗");
  const resetCredits = result?.rateLimitResetCredits;
  return {
    available: true,
    source: "codex_app_server",
    checked_at: new Date(checkedAt).toISOString(),
    plan_type: typeof limits.planType === "string" ? limits.planType : null,
    windows,
    spend_control_reached: Boolean(limits.spendControlReached),
    rate_limit_reached_type: typeof limits.rateLimitReachedType === "string"
      ? limits.rateLimitReachedType
      : null,
    reset_credits_available: Number.isFinite(Number(resetCredits?.availableCount))
      ? Number(resetCredits.availableCount)
      : null,
  };
}

export function requestCodexRateLimits({
  command = defaultCodexCommand,
  spawnImpl = spawn,
  startupDelayMs = codexAppServerStartupDelayMs,
  timeoutMs = 15_000,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let initializeSent = false;
    const child = spawnImpl(command, ["app-server"], {
      cwd: projectRoot,
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const startupTimer = setTimeout(() => {
      initializeSent = true;
      send({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "pikmin-postcards",
            title: "Pikmin Postcards",
            version: "0.1.0",
          },
          capabilities: { experimentalApi: true },
        },
      });
    }, startupDelayMs);
    const timeoutTimer = setTimeout(() => {
      finish(new Error("讀取 Codex 帳戶用量逾時"));
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdoutBuffer += chunk;
      let newlineIndex;
      while ((newlineIndex = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          if (message.error) {
            finish(new Error("Codex App Server 初始化失敗"));
            return;
          }
          send({ method: "initialized" });
          send({ id: 2, method: "account/rateLimits/read", params: null });
        } else if (message.id === 2) {
          if (message.error) {
            finish(new Error("Codex App Server 無法讀取帳戶用量"));
            return;
          }
          finish(null, message.result);
          return;
        }
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderrBuffer = `${stderrBuffer}${chunk}`.slice(-4_000);
    });
    child.stdin?.on("error", (error) => finish(error));
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (settled) return;
      const detail = sanitizedOutput(stderrBuffer, { limit: 500, fromEnd: true });
      finish(new Error(detail || `Codex App Server 提前結束（${signal || code || "unknown"}）`));
    });

    function send(message) {
      if (settled || !child.stdin?.writable) return;
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      clearTimeout(timeoutTimer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(value);
    }

    if (startupDelayMs <= 0 && !initializeSent) {
      clearTimeout(startupTimer);
      initializeSent = true;
      send({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "pikmin-postcards", title: "Pikmin Postcards", version: "0.1.0" },
          capabilities: { experimentalApi: true },
        },
      });
    }
  });
}

function normalizeCodexUsageWindow(window) {
  const durationMinutes = Number(window.windowDurationMins);
  const usedPercent = clampPercentage(window.usedPercent);
  const resetsAtSeconds = Number(window.resetsAt);
  return {
    id: durationMinutes === 300
      ? "five_hour"
      : durationMinutes === 10_080 ? "weekly" : `minutes_${durationMinutes}`,
    window_duration_minutes: durationMinutes,
    used_percent: usedPercent,
    remaining_percent: Math.max(0, Math.min(100, 100 - usedPercent)),
    resets_at: Number.isFinite(resetsAtSeconds)
      ? new Date(resetsAtSeconds * 1_000).toISOString()
      : null,
  };
}

function clampPercentage(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

export async function localCodexStatus({
  command = process.env.PIKMIN_CODEX_COMMAND?.trim() || null,
  commandCandidates = defaultCodexCommandCandidates(),
  execFileImpl = execFileAsync,
} = {}) {
  const candidates = command ? [command] : commandCandidates;
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const versionResult = await execFileImpl(candidate, ["--version"], commandOptions(8_000));
      const version = firstLine(versionResult.stdout || versionResult.stderr);
      let login;
      try {
        login = await execFileImpl(candidate, ["login", "status"], commandOptions(12_000));
      } catch (error) {
        return {
          installed: true,
          authenticated: false,
          available: false,
          command: candidate,
          version,
          auth_status: sanitizedMessage(error) || "尚未登入",
        };
      }
      const authStatus = firstLine(login.stdout || login.stderr) || "登入狀態未知";
      const authenticated = /logged in/i.test(authStatus);
      return {
        installed: true,
        authenticated,
        available: authenticated,
        command: candidate,
        version,
        auth_status: authStatus,
      };
    } catch (error) {
      lastError = error;
      if (error?.code !== "ENOENT") break;
    }
  }
  return {
    installed: false,
    authenticated: false,
    available: false,
    command: command || defaultCodexCommand,
    version: null,
    auth_status: lastError?.code === "ENOENT" ? "找不到 Codex CLI" : sanitizedMessage(lastError),
  };
}

export function defaultCodexCommandCandidates({ home = os.homedir() } = {}) {
  return [...new Set([
    defaultCodexCommand,
    path.join(home, ".local/bin/codex"),
    path.join(home, ".codex/packages/standalone/current/bin/codex"),
  ])];
}

export async function verifyLocalCodexConnection({
  command = process.env.PIKMIN_CODEX_COMMAND?.trim() || null,
  model = process.env.PIKMIN_CODEX_MODEL?.trim() || defaultCodexResearchModel,
  reasoningEffort = process.env.PIKMIN_CODEX_REASONING_EFFORT?.trim() || defaultCodexReasoningEffort,
  workingDirectory = projectRoot,
  statusImpl = localCodexStatus,
  runCommand = runCodexCommand,
} = {}) {
  const status = await statusImpl(command ? { command } : {});
  const resolvedCommand = status.command || command || defaultCodexCommand;
  if (!status.installed) throw httpError(503, "找不到 Codex CLI；請先依設定頁指令安裝");
  if (!status.authenticated) throw httpError(503, "Codex CLI 尚未登入；請先執行 codex login");

  const probeSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean", const: true },
      message: { type: "string" },
    },
    required: ["ok", "message"],
  };
  const probe = await runStructuredCodex({
    command: resolvedCommand,
    model,
    reasoningEffort,
    workingDirectory,
    schema: probeSchema,
    prompt: "This is a connection probe. Return JSON with ok=true and a brief Traditional Chinese message. Do not inspect or modify files.",
    runCommand,
    search: false,
    timeoutMs: 180_000,
  });
  if (probe.ok !== true) throw new Error("Codex CLI 測試未回傳成功狀態");
  return {
    ok: true,
    provider: "local_codex",
    checked_at: new Date().toISOString(),
    model,
    reasoning_effort: reasoningEffort,
    model_available: true,
    accessible_model_count: null,
    version: status.version,
    auth_status: status.auth_status,
    message: probe.message,
  };
}

export async function runLocalCodexResearch({
  command = process.env.PIKMIN_CODEX_COMMAND?.trim() || defaultCodexCommand,
  model = process.env.PIKMIN_CODEX_MODEL?.trim() || defaultCodexResearchModel,
  reasoningEffort = process.env.PIKMIN_CODEX_REASONING_EFFORT?.trim() || defaultCodexReasoningEffort,
  skill,
  prompt,
  imagePath,
  workingDirectory = projectRoot,
  runCommand = runCodexCommand,
  signal,
} = {}) {
  if (!skill?.trim()) throw new Error("本機 Codex 研究缺少專案 SKILL");
  if (!imagePath) throw new Error("本機 Codex 研究缺少圖片路徑");
  const fullPrompt = [
    "你正在執行 Pikmin 明信片研究工作。不得修改任何檔案；只回傳符合 JSON Schema 的最終結果。",
    "以下專案 SKILL 是本次工作的權威規則，必須完整遵守：",
    skill.trim(),
    "本次工作：",
    prompt.trim(),
  ].join("\n\n");
  return runStructuredCodex({
    command,
    model,
    reasoningEffort,
    workingDirectory,
    schema: researchSchema,
    prompt: fullPrompt,
    imagePath,
    runCommand,
    signal,
    search: true,
    timeoutMs: 45 * 60_000,
  });
}

export async function runLocalCodexMetadata({
  command = process.env.PIKMIN_CODEX_COMMAND?.trim() || defaultCodexCommand,
  model = process.env.PIKMIN_CODEX_MODEL?.trim() || defaultCodexResearchModel,
  skill,
  prompt,
  imagePath,
  workingDirectory = projectRoot,
  runCommand = runCodexCommand,
  signal,
} = {}) {
  if (!skill?.trim()) throw new Error("本機 Codex 快速建檔缺少專案 SKILL");
  if (!imagePath) throw new Error("本機 Codex 快速建檔缺少圖片路徑");
  const fullPrompt = [
    "你正在執行 Pikmin 明信片快速建檔。不得修改任何檔案；不得做網路研究；只回傳符合 JSON Schema 的畫面可見 metadata。",
    "以下專案 SKILL 是證據與保存規則；本次只執行其中的快速建檔分支：",
    skill.trim(),
    "本次工作：",
    prompt.trim(),
  ].join("\n\n");
  return runStructuredCodex({
    command,
    model,
    reasoningEffort: metadataReasoningEffort,
    workingDirectory,
    schema: metadataSchema,
    prompt: fullPrompt,
    imagePath,
    runCommand,
    signal,
    search: false,
    timeoutMs: 10 * 60_000,
  });
}

export function buildCodexExecArgs({
  model,
  reasoningEffort = defaultCodexReasoningEffort,
  workingDirectory,
  schemaPath,
  outputPath,
  imagePath = null,
  search = false,
}) {
  return [
    ...(search ? ["--search"] : []),
    "exec",
    "--ephemeral",
    "--sandbox", "read-only",
    "--cd", workingDirectory,
    "--model", model,
    "--config", `model_reasoning_effort=\"${reasoningEffort}\"`,
    "--output-schema", schemaPath,
    "--output-last-message", outputPath,
    "--color", "never",
    ...(imagePath ? ["--image", imagePath] : []),
    "-",
  ];
}

async function runStructuredCodex({
  command,
  model,
  reasoningEffort,
  workingDirectory,
  schema,
  prompt,
  imagePath = null,
  runCommand,
  signal,
  search,
  timeoutMs,
}) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-local-codex-"));
  const schemaPath = path.join(temporaryDirectory, "output.schema.json");
  const outputPath = path.join(temporaryDirectory, "last-message.json");
  try {
    await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
    const args = buildCodexExecArgs({
      model,
      reasoningEffort,
      workingDirectory,
      schemaPath,
      outputPath,
      imagePath,
      search,
    });
    await runCommand(command, args, {
      cwd: workingDirectory,
      input: prompt,
      timeoutMs,
      signal,
    });
    const output = (await readFile(outputPath, "utf8")).trim();
    if (!output) throw new Error("Codex CLI 沒有輸出最終研究結果");
    return JSON.parse(output);
  } catch (error) {
    if (error?.code === "JOB_CANCELLED") throw error;
    throw httpError(error?.status ?? 502, `本機 Codex 執行失敗：${sanitizedMessage(error)}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export function runCodexCommand(command, args, {
  cwd,
  input = "",
  timeoutMs = 45 * 60_000,
  signal,
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledError());
      return;
    }
    let aborted = false;
    let forceKillTimer;
    const child = execFile(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
      encoding: "utf8",
      maxBuffer: maxCapturedBytes,
      timeout: timeoutMs,
    }, (error, stdout, stderr) => {
      signal?.removeEventListener("abort", onAbort);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (aborted) {
        reject(cancelledError());
        return;
      }
      if (error) {
        const failure = new Error(conciseCodexFailure({ error, stderr, stdout }));
        failure.code = error.code;
        reject(failure);
        return;
      }
      resolve({ stdout, stderr });
    });
    const onAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 2_000);
      forceKillTimer.unref?.();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdin?.end(input);
  });
}

function cancelledError() {
  const error = new Error("AI 工作已由使用者中止");
  error.code = "JOB_CANCELLED";
  return error;
}

export function conciseCodexFailure({ error, stderr = "" } = {}) {
  const messages = [];
  const messagePattern = /"message"\s*:\s*("(?:\\.|[^"\\])*")/g;
  for (const match of String(stderr).matchAll(messagePattern)) {
    try {
      const message = JSON.parse(match[1]);
      if (typeof message === "string" && message.trim()) messages.push(message.trim());
    } catch {
      // Ignore malformed diagnostic fragments and use the generic exit message below.
    }
  }
  const providerMessage = messages.at(-1);
  if (providerMessage) return sanitizedOutput(providerMessage, { limit: 800, fromEnd: false });
  const errorLine = String(stderr)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^ERROR:\s*\S/i.test(line) && line !== "ERROR: {")
    .at(-1)
    ?.replace(/^ERROR:\s*/i, "");
  if (errorLine) return sanitizedOutput(errorLine, { limit: 800, fromEnd: false });
  const exitCode = error?.code == null ? "未知" : String(error.code);
  return `Codex CLI 未成功完成（exit code ${exitCode}）`;
}

function commandOptions(timeout) {
  return {
    cwd: projectRoot,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
    maxBuffer: 512 * 1024,
    timeout,
  };
}

function firstLine(value = "") {
  return String(value).trim().split(/\r?\n/, 1)[0] || null;
}

function sanitizedOutput(value = "", { limit = 4_000, fromEnd = true } = {}) {
  const sanitized = String(value).replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").trim();
  return fromEnd ? sanitized.slice(-limit) : sanitized.slice(0, limit);
}

function sanitizedMessage(error) {
  return sanitizedOutput(error instanceof Error ? error.message : String(error ?? "未知錯誤"));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
