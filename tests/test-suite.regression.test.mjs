import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

test("every test file belongs to exactly one executable suite", async () => {
  const files = (await readdir(testDirectory)).filter((name) => name.endsWith(".test.mjs"));
  const suitePattern = /\.(unit|regression|functional)\.test\.mjs$/;
  const uncategorized = files.filter((name) => !suitePattern.test(name));
  assert.deepEqual(uncategorized, [], `Uncategorized tests are skipped by suite commands: ${uncategorized}`);

  for (const suite of ["unit", "regression", "functional"]) {
    assert.ok(
      files.some((name) => name.endsWith(`.${suite}.test.mjs`)),
      `The ${suite} suite must contain at least one test file`,
    );
  }
});

test("package test gates execute every named suite", async () => {
  const packageJson = JSON.parse(await readFile(path.join(testDirectory, "../package.json"), "utf8"));
  assert.equal(packageJson.scripts.test, "npm run test:all");
  assert.match(packageJson.scripts["test:all"], /test:unit.*test:regression.*test:functional/);
  assert.match(packageJson.scripts.verify, /test:all/);
  for (const suite of ["unit", "regression", "functional"]) {
    assert.match(packageJson.scripts[`test:${suite}`], new RegExp(`tests/\\*\\.${suite}\\.test\\.mjs`));
  }
});
