import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildCodexExecArgs,
  conciseCodexFailure,
  localCodexStatus,
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
