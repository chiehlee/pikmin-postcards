import { execFile } from "node:child_process";
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

export async function localCodexStatus({
  command = process.env.PIKMIN_CODEX_COMMAND?.trim() || defaultCodexCommand,
  execFileImpl = execFileAsync,
} = {}) {
  try {
    const versionResult = await execFileImpl(command, ["--version"], commandOptions(8_000));
    const version = firstLine(versionResult.stdout || versionResult.stderr);
    let login;
    try {
      login = await execFileImpl(command, ["login", "status"], commandOptions(12_000));
    } catch (error) {
      return {
        installed: true,
        authenticated: false,
        available: false,
        command,
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
      command,
      version,
      auth_status: authStatus,
    };
  } catch (error) {
    return {
      installed: false,
      authenticated: false,
      available: false,
      command,
      version: null,
      auth_status: error?.code === "ENOENT" ? "找不到 Codex CLI" : sanitizedMessage(error),
    };
  }
}

export async function verifyLocalCodexConnection({
  command = process.env.PIKMIN_CODEX_COMMAND?.trim() || defaultCodexCommand,
  model = process.env.PIKMIN_CODEX_MODEL?.trim() || defaultCodexResearchModel,
  reasoningEffort = process.env.PIKMIN_CODEX_REASONING_EFFORT?.trim() || defaultCodexReasoningEffort,
  workingDirectory = projectRoot,
  statusImpl = localCodexStatus,
  runCommand = runCodexCommand,
} = {}) {
  const status = await statusImpl({ command });
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
    command,
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
