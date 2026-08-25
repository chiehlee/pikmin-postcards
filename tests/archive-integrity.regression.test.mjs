import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = path.join(root, "templates/fresh-data");

test("versioned fresh-install snapshots contain no collection records", async () => {
  const definitions = [
    ["postcards.json", "postcards"],
    ["friends.json", "profiles"],
    ["imports.json", "imports"],
    ["context.json", "records"],
  ];
  for (const [filename, collection] of definitions) {
    const snapshot = JSON.parse(await readFile(path.join(templateRoot, filename), "utf8"));
    assert.deepEqual(snapshot[collection], [], `${filename} is not an empty-system template`);
  }
});

test("Git tracks application source but no mutable archive or exported collection", async () => {
  const { stdout } = await execFileAsync("git", ["ls-files"], { cwd: root });
  const tracked = stdout.trim().split("\n").filter(Boolean);
  const forbidden = [
    /^data\//,
    /^public\/images\//,
    /^research\/raw\//,
    /^research\/recovery\//,
    /^imports\/source-bundles\//,
    /^imports\/[^/]+\//,
    /^var\//,
  ];
  assert.deepEqual(tracked.filter((filename) => forbidden.some((pattern) => pattern.test(filename))), []);
});

test("collection-specific bootstrap and recovery commands are not shipped", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  for (const name of [
    "normalize:bootstrap",
    "backfill:acquisition",
    "backfill:research-details",
    "backfill:location-names",
    "friends:avatars",
    "research:redo",
  ]) {
    assert.equal(packageJson.scripts[name], undefined, `${name} exposes collection-specific data work`);
  }
});
