import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, lstat, mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "scripts/local-environment.mjs");

test("fresh local setup moves mutable data outside the repository and is idempotent", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-local-setup-"));
  const project = path.join(temporaryDirectory, "pikmin-postcards");
  const archive = path.join(temporaryDirectory, "pikmin-postcards-data");

  try {
    await mkdir(path.join(project, "data"), { recursive: true });
    await mkdir(path.join(project, "public/images/postcards"), { recursive: true });
    await mkdir(path.join(project, "research/raw"), { recursive: true });
    await mkdir(path.join(project, "imports/source-bundles"), { recursive: true });
    await mkdir(path.join(project, "var"), { recursive: true });
    await mkdir(path.join(project, ".wrangler/logs"), { recursive: true });
    await writeFile(path.join(project, "data/postcards.json"), '{"postcards":[]}\n');
    await writeFile(path.join(project, "public/images/postcards/example.png"), "image-bytes");
    await writeFile(path.join(project, "research/raw/example.md"), "research");
    await writeFile(path.join(project, "imports/source-bundles/example.zip"), "bundle");
    await writeFile(path.join(project, "var/archive.sqlite3"), "database");
    await writeFile(path.join(project, ".wrangler/logs/wrangler.log"), "log");

    const args = [
      installer,
      "setup",
      "--project-root", project,
      "--data-root", archive,
      "--port", "4317",
      "--skip-dependencies",
      "--skip-sync",
      "--skip-build",
    ];
    await execFileAsync(process.execPath, args, { cwd: root });
    await execFileAsync(process.execPath, args, { cwd: root });

    const mappings = [
      ["data", "snapshots"],
      ["public/images", "images"],
      ["research/raw", "research/raw"],
      ["imports/source-bundles", "imports/source-bundles"],
      ["var", "runtime"],
      [".wrangler/logs", "logs/wrangler"],
    ];
    for (const [repositoryPath, archivePath] of mappings) {
      const link = path.join(project, repositoryPath);
      assert.ok((await lstat(link)).isSymbolicLink(), `${repositoryPath} is not a symlink`);
      assert.equal(
        path.resolve(path.dirname(link), await readlink(link)),
        path.join(archive, archivePath),
      );
    }

    assert.equal(await readFile(path.join(archive, "images/postcards/example.png"), "utf8"), "image-bytes");
    assert.equal(await readFile(path.join(archive, "research/raw/example.md"), "utf8"), "research");
    assert.equal(await readFile(path.join(archive, "runtime/archive.sqlite3"), "utf8"), "database");
    const config = JSON.parse(await readFile(path.join(archive, "config/runtime.json"), "utf8"));
    assert.equal(config.port, 4317);
    assert.equal(config.data_root, archive);
    const locator = JSON.parse(await readFile(path.join(project, ".pikmin-local.json"), "utf8"));
    assert.equal(locator.data_root, archive);

    await mkdir(path.join(project, "scripts"), { recursive: true });
    await copyFile(path.join(root, "scripts/start-production.mjs"), path.join(project, "scripts/start-production.mjs"));
    await mkdir(path.join(project, "dist/server"), { recursive: true });
    await writeFile(path.join(project, "dist/server/index.js"), "// synthetic production entry\n");
    await mkdir(path.join(project, "node_modules/vinext/dist/config"), { recursive: true });
    await mkdir(path.join(project, "node_modules/vinext/dist/server"), { recursive: true });
    await writeFile(path.join(project, "node_modules/vinext/package.json"), JSON.stringify({
      type: "module",
      exports: {
        "./internal/config/dotenv": "./dist/config/dotenv.js",
        "./server/prod-server": "./dist/server/prod-server.js",
      },
    }));
    await writeFile(path.join(project, "node_modules/vinext/dist/config/dotenv.js"), "export function loadDotenv() {}\n");
    await writeFile(path.join(project, "node_modules/vinext/dist/server/prod-server.js"), [
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      "export async function startProdServer(options) {",
      "  fs.writeFileSync(path.join(process.env.PIKMIN_DATA_ROOT, 'start-probe.json'), JSON.stringify({ options, project: process.env.PIKMIN_PROJECT_ROOT }));",
      "}",
    ].join("\n"));
    await execFileAsync(process.execPath, [
      installer,
      "start",
      "--project-root", project,
    ], { cwd: root });
    const probe = JSON.parse(await readFile(path.join(archive, "start-probe.json"), "utf8"));
    assert.deepEqual(probe.options, { host: "0.0.0.0", port: 4317, outDir: path.join(project, "dist") });
    assert.equal(probe.project, project);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("fresh local setup rejects archive data inside the Git repository", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-local-boundary-"));
  const project = path.join(temporaryDirectory, "pikmin-postcards");
  await mkdir(project, { recursive: true });
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        installer,
        "setup",
        "--project-root", project,
        "--data-root", path.join(project, "runtime-data"),
        "--skip-dependencies",
        "--skip-sync",
        "--skip-build",
      ], { cwd: root }),
      /Archive data root must be outside the Git repository/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("a genuinely fresh local setup initializes an empty collection", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-local-empty-"));
  const project = path.join(temporaryDirectory, "pikmin-postcards");
  const archive = path.join(temporaryDirectory, "pikmin-postcards-data");
  await mkdir(project, { recursive: true });
  try {
    await execFileAsync(process.execPath, [
      installer,
      "setup",
      "--project-root", project,
      "--data-root", archive,
      "--skip-dependencies",
      "--skip-sync",
      "--skip-build",
    ], { cwd: root });

    const definitions = [
      ["postcards.json", "postcards"],
      ["friends.json", "profiles"],
      ["imports.json", "imports"],
      ["context.json", "records"],
    ];
    for (const [filename, collection] of definitions) {
      const snapshot = JSON.parse(await readFile(path.join(archive, "snapshots", filename), "utf8"));
      assert.deepEqual(snapshot[collection], [], `${filename} was not initialized empty`);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("setup publishes an immutable production build outside the repository", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-local-build-"));
  const project = path.join(temporaryDirectory, "pikmin-postcards");
  const archive = path.join(temporaryDirectory, "pikmin-postcards-data");
  const fakeNpm = path.join(temporaryDirectory, "fake-npm.mjs");
  await mkdir(project, { recursive: true });
  await writeFile(fakeNpm, [
    "import { mkdir, writeFile } from 'node:fs/promises';",
    "import path from 'node:path';",
    "const output = path.join(process.cwd(), 'dist/server');",
    "await mkdir(output, { recursive: true });",
    "await writeFile(path.join(output, 'BUILD_ID'), 'synthetic-build\\n');",
    "await writeFile(path.join(output, 'index.js'), '// immutable synthetic build\\n');",
  ].join("\n"));
  try {
    await execFileAsync(process.execPath, [
      installer,
      "setup",
      "--project-root", project,
      "--data-root", archive,
      "--skip-dependencies",
      "--skip-sync",
    ], { cwd: root, env: { ...process.env, npm_execpath: fakeNpm } });

    const config = JSON.parse(await readFile(path.join(archive, "config/runtime.json"), "utf8"));
    assert.equal(config.build_path, path.join(archive, "runtime/builds/synthetic-build"));
    assert.equal(
      await readFile(path.join(config.build_path, "server/index.js"), "utf8"),
      "// immutable synthetic build\n",
    );
    assert.equal((await lstat(config.build_path)).isDirectory(), true);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
