import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { projectRoot } from "../db/database.mjs";
import { runCodexCommand, runLocalCodexMetadata, runLocalCodexResearch } from "../server/local-codex.mjs";

test("aborting a local Codex command terminates the child process", async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const execution = runCodexCommand(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { signal: controller.signal, timeoutMs: 10_000 },
  );
  setTimeout(() => controller.abort(), 80);

  await assert.rejects(execution, (error) => {
    assert.equal(error.code, "JOB_CANCELLED");
    assert.match(error.message, /使用者中止/);
    return true;
  });
  assert.ok(Date.now() - startedAt < 2_000);
});

test("local Codex research receives the maintained skill and returns structured output without writing the archive", async () => {
  const imagePath = path.join(projectRoot, "public/images/postcards/2026/05/pc-020.png");
  const expected = { visible: { poi_name: "probe" }, research: { summary: "probe" } };
  let invocation;

  const result = await runLocalCodexResearch({
    command: "/mock/codex",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    skill: "# TEST SKILL\nFollow this exact skill.",
    prompt: "Research the attached postcard.",
    imagePath,
    workingDirectory: projectRoot,
    runCommand: async (command, args, options) => {
      invocation = { command, args, options };
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, `${JSON.stringify(expected)}\n`, "utf8");
      return { stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(result, expected);
  assert.equal(invocation.command, "/mock/codex");
  assert.equal(invocation.options.cwd, projectRoot);
  assert.equal(invocation.options.signal, undefined);
  assert.match(invocation.options.input, /# TEST SKILL/);
  assert.match(invocation.options.input, /Research the attached postcard/);
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf("--sandbox"), invocation.args.indexOf("--sandbox") + 2),
    ["--sandbox", "read-only"],
  );
  assert.equal(invocation.args[invocation.args.indexOf("--image") + 1], imagePath);
  assert.equal(invocation.args[invocation.args.indexOf("--config") + 1], 'model_reasoning_effort="medium"');
});

test("local Codex quick intake forces GPT-5.6's lowest supported reasoning and disables search", async () => {
  const imagePath = path.join(projectRoot, "public/images/postcards/2026/05/pc-020.png");
  const expected = { visible: { poi_name: "快速辨識" } };
  let invocation;
  const result = await runLocalCodexMetadata({
    command: "/mock/codex",
    model: "gpt-5.6-sol",
    skill: "# TEST SKILL",
    prompt: "Only read visible metadata.",
    imagePath,
    workingDirectory: projectRoot,
    runCommand: async (command, args, options) => {
      invocation = { command, args, options };
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, `${JSON.stringify(expected)}\n`, "utf8");
      return { stdout: "", stderr: "" };
    },
  });
  assert.deepEqual(result, expected);
  assert.equal(invocation.args.includes("--search"), false);
  assert.equal(invocation.args[invocation.args.indexOf("--config") + 1], 'model_reasoning_effort="none"');
  assert.match(invocation.options.input, /不得做網路研究/);
});
