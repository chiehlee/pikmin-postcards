import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import {
  buildCodexExecArgs,
  conciseCodexFailure,
  defaultCodexCommandCandidates,
  localCodexStatus,
  localCodexUsage,
  normalizeCodexRateLimits,
  requestCodexRateLimits,
} from "../server/local-codex.mjs";

test("local Codex status detects the CLI and ChatGPT authentication without exposing credentials", async () => {
  const calls = [];
  const status = await localCodexStatus({
    command: "/opt/bin/codex",
    execFileImpl: async (command, args) => {
      calls.push({ command, args });
      return args[0] === "--version"
        ? { stdout: "codex-cli 0.test\n", stderr: "" }
        : { stdout: "Logged in using ChatGPT\n", stderr: "" };
    },
  });

  assert.deepEqual(calls, [
    { command: "/opt/bin/codex", args: ["--version"] },
    { command: "/opt/bin/codex", args: ["login", "status"] },
  ]);
  assert.deepEqual(status, {
    installed: true,
    authenticated: true,
    available: true,
    command: "/opt/bin/codex",
    version: "codex-cli 0.test",
    auth_status: "Logged in using ChatGPT",
  });
});

test("local Codex status falls back to the standalone install when the service PATH is stale", async () => {
  const commands = [];
  const status = await localCodexStatus({
    commandCandidates: ["codex", "/Users/test/.local/bin/codex"],
    execFileImpl: async (command, args) => {
      commands.push(command);
      if (command === "codex") throw Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
      return args[0] === "--version"
        ? { stdout: "codex-cli 0.149.0\n", stderr: "" }
        : { stdout: "Logged in using ChatGPT\n", stderr: "" };
    },
  });

  assert.deepEqual(commands, ["codex", "/Users/test/.local/bin/codex", "/Users/test/.local/bin/codex"]);
  assert.equal(status.available, true);
  assert.equal(status.command, "/Users/test/.local/bin/codex");
  assert.deepEqual(defaultCodexCommandCandidates({ home: "/Users/test" }), [
    "codex",
    "/Users/test/.local/bin/codex",
    "/Users/test/.codex/packages/standalone/current/bin/codex",
  ]);
});

test("Codex account rate limits normalize five-hour and weekly remaining usage", async () => {
  const raw = {
    rateLimits: {
      planType: "plus",
      primary: { usedPercent: 39, windowDurationMins: 300, resetsAt: 1_787_985_524 },
      secondary: { usedPercent: 30, windowDurationMins: 10_080, resetsAt: 1_788_491_847 },
      spendControlReached: false,
      rateLimitReachedType: null,
    },
    rateLimitResetCredits: { availableCount: 1, credits: [] },
  };
  const usage = normalizeCodexRateLimits(raw, { checkedAt: new Date("2026-08-29T00:00:00.000Z") });

  assert.deepEqual(usage, {
    available: true,
    source: "codex_app_server",
    checked_at: "2026-08-29T00:00:00.000Z",
    plan_type: "plus",
    windows: [
      {
        id: "five_hour",
        window_duration_minutes: 300,
        used_percent: 39,
        remaining_percent: 61,
        resets_at: "2026-08-29T06:38:44.000Z",
      },
      {
        id: "weekly",
        window_duration_minutes: 10_080,
        used_percent: 30,
        remaining_percent: 70,
        resets_at: "2026-09-04T03:17:27.000Z",
      },
    ],
    spend_control_reached: false,
    rate_limit_reached_type: null,
    reset_credits_available: 1,
  });

  const calls = [];
  const delegated = await localCodexUsage({
    command: "/opt/bin/codex",
    checkedAt: new Date("2026-08-29T00:00:00.000Z"),
    requestImpl: async (input) => {
      calls.push(input);
      return raw;
    },
  });
  assert.deepEqual(calls, [{ command: "/opt/bin/codex" }]);
  assert.equal(delegated.windows[0].remaining_percent, 61);
});

test("Codex account usage rejects missing quota windows instead of inventing availability", () => {
  assert.throws(() => normalizeCodexRateLimits({ rateLimits: { planType: "plus" } }), /配額視窗/);
});

test("Codex App Server usage request completes the JSONL handshake before reading rate limits", async () => {
  const sent = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    child.signalCode = "SIGTERM";
    return true;
  };
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      const message = JSON.parse(String(chunk).trim());
      sent.push(message);
      if (message.id === 1) {
        queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: 1, result: { userAgent: "test" } })}\n`));
      } else if (message.id === 2) {
        queueMicrotask(() => child.stdout.write(`${JSON.stringify({
          id: 2,
          result: {
            rateLimits: {
              planType: "plus",
              primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1_787_985_524 },
            },
          },
        })}\n`));
      }
      callback();
    },
  });

  const result = await requestCodexRateLimits({
    command: "/opt/bin/codex",
    startupDelayMs: 0,
    timeoutMs: 1_000,
    spawnImpl: (command, args, options) => {
      assert.equal(command, "/opt/bin/codex");
      assert.deepEqual(args, ["app-server"]);
      assert.deepEqual(options.stdio, ["pipe", "pipe", "pipe"]);
      return child;
    },
  });

  assert.equal(result.rateLimits.primary.usedPercent, 20);
  assert.deepEqual(sent.map(({ id, method }) => ({ id, method })), [
    { id: 1, method: "initialize" },
    { id: undefined, method: "initialized" },
    { id: 2, method: "account/rateLimits/read" },
  ]);
  assert.equal(child.signalCode, "SIGTERM");
});

test("Codex research command is ephemeral, read-only, schema constrained, and image aware", () => {
  const args = buildCodexExecArgs({
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    workingDirectory: "/project",
    schemaPath: "/tmp/result.schema.json",
    outputPath: "/tmp/result.json",
    imagePath: "/project/image.png",
    search: true,
  });

  assert.deepEqual(args.slice(0, 2), ["--search", "exec"]);
  assert.ok(args.includes("--ephemeral"));
  assert.deepEqual(args.slice(args.indexOf("--sandbox"), args.indexOf("--sandbox") + 2), ["--sandbox", "read-only"]);
  assert.deepEqual(args.slice(args.indexOf("--cd"), args.indexOf("--cd") + 2), ["--cd", path.resolve("/project")]);
  assert.deepEqual(
    args.slice(args.indexOf("--config"), args.indexOf("--config") + 2),
    ["--config", 'model_reasoning_effort="xhigh"'],
  );
  assert.deepEqual(args.slice(args.indexOf("--image"), args.indexOf("--image") + 2), ["--image", "/project/image.png"]);
  assert.equal(args.at(-1), "-");
});

test("Codex failures keep the provider message without leaking the submitted prompt", () => {
  const prompt = "PRIVATE USER NOTE and the entire maintained skill";
  const message = conciseCodexFailure({
    error: Object.assign(new Error(`Command failed: codex exec -\n${prompt}`), { code: 1 }),
    stderr: [
      prompt,
      "ERROR: {",
      '  "error": {',
      '    "code": "unsupported_value",',
      '    "message": "Unsupported value: \'minimal\' is not supported. Supported values are: \'none\', \'low\'.",',
      '    "param": "reasoning.effort"',
      "  }",
      "}",
    ].join("\n"),
  });

  assert.match(message, /Unsupported value: 'minimal'/);
  assert.doesNotMatch(message, /PRIVATE USER NOTE/);
  assert.ok(message.length < 500);
});

test("Codex failures surface a concise non-JSON usage-limit diagnostic", () => {
  const message = conciseCodexFailure({
    error: Object.assign(new Error("Command failed with submitted private prompt"), { code: 1 }),
    stderr: [
      "submitted private prompt and maintained skill",
      "hook: UserPromptSubmit Completed",
      "ERROR: You've hit your usage limit. Try again at Aug 30th, 2026 1:10 PM.",
    ].join("\n"),
  });

  assert.equal(message, "You've hit your usage limit. Try again at Aug 30th, 2026 1:10 PM.");
  assert.doesNotMatch(message, /private prompt|maintained skill/);
});
