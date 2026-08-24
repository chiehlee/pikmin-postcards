import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isLoopbackRequest,
  removeApiKey,
  saveSettings,
  settingsStatus,
  testSettingsConnection,
} from "../server/settings-store.mjs";

const validKey = "sk-project-test_only_1234567890";
const availableCodex = {
  installed: true,
  authenticated: true,
  available: true,
  command: "codex",
  version: "codex-cli 0.test",
  auth_status: "Logged in using ChatGPT",
};
const codexStatusImpl = async () => availableCodex;

test("secret-write UI capability is limited to loopback hostnames", () => {
  assert.equal(isLoopbackRequest(new Request("http://localhost:3000/api/settings")), true);
  assert.equal(isLoopbackRequest(new Request("http://127.0.0.1:3000/api/settings")), true);
  assert.equal(isLoopbackRequest(new Request("http://[::1]:3000/api/settings")), true);
  assert.equal(isLoopbackRequest(new Request("http://192.168.50.83:3000/api/settings")), false);
});

test("settings persist server secrets atomically without returning the key", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pikmin-settings-"));
  const envFilePath = path.join(directory, ".env.local");
  const runtimeEnv = {};
  await import("node:fs/promises").then(({ writeFile }) => writeFile(
    envFilePath,
    "# preserve this comment\nUNRELATED=value\nPIKMIN_OPENAI_MODEL=old-model\n",
  ));
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ data: [{ id: "gpt-5.6-terra" }, { id: "other-model" }] });
  };

  const saved = await saveSettings({ apiKey: validKey, model: "gpt-5.6-terra" }, {
    envFilePath, runtimeEnv, fetchImpl, secretWriteAllowed: true, codexStatusImpl,
  });
  const contents = await readFile(envFilePath, "utf8");
  assert.match(contents, /# preserve this comment/);
  assert.match(contents, /UNRELATED=value/);
  assert.match(contents, /PIKMIN_OPENAI_MODEL=gpt-5\.6-terra/);
  assert.match(contents, /PIKMIN_AI_PROVIDER=openai_api/);
  assert.match(contents, /PIKMIN_OPENAI_REASONING_EFFORT=high/);
  assert.match(contents, new RegExp(`OPENAI_API_KEY=${validKey}`));
  assert.equal((await stat(envFilePath)).mode & 0o777, 0o600);
  assert.equal(runtimeEnv.OPENAI_API_KEY, validKey);
  assert.equal(saved.settings.api_key_hint, "••••7890");
  assert.equal(saved.settings.api_key_source, "settings_file");
  assert.equal(saved.connection.model_available, true);
  assert.doesNotMatch(JSON.stringify(saved), new RegExp(validKey));
  assert.equal(requests[0].url, "https://api.openai.com/v1/models");
  assert.equal(requests[0].options.headers.authorization, `Bearer ${validKey}`);

  const removed = await removeApiKey({ envFilePath, runtimeEnv, secretWriteAllowed: true, codexStatusImpl });
  assert.equal(removed.settings.api_key_configured, false);
  assert.equal(runtimeEnv.OPENAI_API_KEY, undefined);
  assert.doesNotMatch(await readFile(envFilePath, "utf8"), /OPENAI_API_KEY/);
  assert.match(await readFile(envFilePath, "utf8"), /PIKMIN_OPENAI_MODEL=gpt-5\.6-terra/);
});

test("settings enforce local-only submitted secrets and expose only environment status", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pikmin-settings-"));
  const envFilePath = path.join(directory, ".env.local");
  const runtimeEnv = { OPENAI_API_KEY: validKey, PIKMIN_OPENAI_MODEL: "gpt-5.6" };
  const status = await settingsStatus({ envFilePath, runtimeEnv, secretWriteAllowed: false, codexStatusImpl });
  assert.deepEqual({
    configured: status.api_key_configured,
    hint: status.api_key_hint,
    source: status.api_key_source,
    allowed: status.secret_write_allowed,
  }, { configured: true, hint: "••••7890", source: "environment", allowed: false });
  assert.doesNotMatch(JSON.stringify(status), new RegExp(validKey));

  await assert.rejects(
    saveSettings({ apiKey: "sk-project-another_123456789", model: "gpt-5.6" }, {
      envFilePath, runtimeEnv, fetchImpl: async () => Response.json({ data: [] }), secretWriteAllowed: false, codexStatusImpl,
    }),
    /只有從 localhost/,
  );
  await assert.rejects(
    removeApiKey({ envFilePath, runtimeEnv, secretWriteAllowed: false, codexStatusImpl }),
    /只有從 localhost/,
  );
});

test("connection test can use the saved server key without returning it", async () => {
  const runtimeEnv = { OPENAI_API_KEY: validKey, PIKMIN_OPENAI_MODEL: "gpt-5.6" };
  const result = await testSettingsConnection({}, {
    envFilePath: path.join(await mkdtemp(path.join(os.tmpdir(), "pikmin-settings-")), ".env.local"),
    runtimeEnv,
    fetchImpl: async () => Response.json({ data: [{ id: "gpt-5.6" }] }),
    secretWriteAllowed: false,
    codexStatusImpl,
  });
  assert.equal(result.connection.ok, true);
  assert.equal(result.connection.model_available, true);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(validKey));
});

test("local Codex provider persists independently and runs an authenticated CLI probe", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pikmin-settings-"));
  const envFilePath = path.join(directory, ".env.local");
  const runtimeEnv = {};
  const saved = await saveSettings({
    provider: "local_codex",
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
  }, {
    envFilePath,
    runtimeEnv,
    secretWriteAllowed: false,
    codexStatusImpl,
  });

  assert.equal(saved.settings.provider, "local_codex");
  assert.equal(saved.settings.provider_ready, true);
  assert.equal(saved.settings.model, "gpt-5.6-sol");
  assert.equal(saved.settings.reasoning_effort, "xhigh");
  assert.match(await readFile(envFilePath, "utf8"), /PIKMIN_AI_PROVIDER=local_codex/);
  assert.match(await readFile(envFilePath, "utf8"), /PIKMIN_CODEX_MODEL=gpt-5\.6-sol/);
  assert.match(await readFile(envFilePath, "utf8"), /PIKMIN_CODEX_REASONING_EFFORT=xhigh/);
  assert.equal(runtimeEnv.OPENAI_API_KEY, undefined);

  const probes = [];
  const result = await testSettingsConnection({
    provider: "local_codex",
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
  }, {
    envFilePath,
    runtimeEnv,
    codexStatusImpl,
    verifyLocalCodexConnectionImpl: async (input) => {
      probes.push(input);
      return {
        ok: true,
        provider: "local_codex",
        checked_at: "2026-08-23T00:00:00.000Z",
        model: input.model,
        reasoning_effort: input.reasoningEffort,
        model_available: true,
        accessible_model_count: null,
        version: availableCodex.version,
        auth_status: availableCodex.auth_status,
        message: "本機 Codex 測試成功",
      };
    },
  });
  assert.equal(result.connection.provider, "local_codex");
  assert.equal(result.connection.model, "gpt-5.6-terra");
  assert.equal(result.connection.reasoning_effort, "medium");
  assert.equal(probes[0].command, "codex");
  assert.equal(probes[0].reasoningEffort, "medium");
});

test("settings reject unknown reasoning effort before persisting", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pikmin-settings-"));
  const envFilePath = path.join(directory, ".env.local");
  await assert.rejects(
    saveSettings({ provider: "local_codex", model: "gpt-5.6-sol", reasoningEffort: "ultra" }, {
      envFilePath,
      runtimeEnv: {},
      codexStatusImpl,
    }),
    /推理深度必須是/,
  );
});
