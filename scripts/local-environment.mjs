#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "help";
const projectRoot = path.resolve(argument("--project-root") ?? sourceProjectRoot);
const locatorPath = path.join(projectRoot, ".pikmin-local.json");
const savedLocator = await readJsonOptional(locatorPath);
const dataRoot = path.resolve(
  argument("--data-root")
    ?? process.env.PIKMIN_DATA_ROOT?.trim()
    ?? savedLocator?.data_root
    ?? path.join(projectRoot, "..", "pikmin-postcards-data"),
);
const templateRoot = path.join(sourceProjectRoot, "templates/fresh-data");
const configPath = path.join(dataRoot, "config/runtime.json");
const skipDependencies = process.argv.includes("--skip-dependencies");
const skipSync = process.argv.includes("--skip-sync");
const skipBuild = process.argv.includes("--skip-build");

const managedPaths = [
  { repository: "data", archive: "snapshots", initialize: initializeSnapshots },
  { repository: "public/images", archive: "images" },
  { repository: "research/raw", archive: "research/raw" },
  { repository: "imports/source-bundles", archive: "imports/source-bundles" },
  { repository: "var", archive: "runtime" },
  { repository: ".wrangler/logs", archive: "logs/wrangler" },
];

if (command === "setup") {
  await setup();
} else if (command === "start") {
  await start();
} else if (command === "status") {
  await status();
} else {
  console.log([
    "Pikmin Postcard Archive local environment",
    "",
    "  setup  Create or reconnect the external archive, install dependencies, sync SQLite, and build",
    "  start  Start the local/LAN server using the saved port",
    "  status Show the resolved repository, archive, database, logs, and port",
  ].join("\n"));
}

async function setup() {
  assertSupportedNode();
  assertExternalDataRoot();
  const previousConfig = await readJsonOptional(configPath);
  const port = parsePort(argument("--port") ?? previousConfig?.port ?? 3000);

  await mkdir(dataRoot, { recursive: true });
  for (const managed of managedPaths) await connectManagedPath(managed);
  await mkdir(path.join(dataRoot, "config"), { recursive: true });
  await writeJsonAtomic(configPath, {
    schema_version: 1,
    project_root: projectRoot,
    data_root: dataRoot,
    host: "0.0.0.0",
    port,
    installed_at: previousConfig?.installed_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await writeJsonAtomic(locatorPath, {
    schema_version: 1,
    data_root: dataRoot,
  });

  if (!skipDependencies) await runNpm(["ci"]);
  if (!skipSync) await runNpm(["run", "db:sync"]);
  if (!skipBuild) await runNpm(["run", "build"]);

  console.log([
    "",
    "Local environment ready.",
    `Archive: ${dataRoot}`,
    `Local:   http://localhost:${port}`,
    `LAN/VPN: http://<this-mac-ip>:${port}`,
    "Start:   npm run local",
  ].join("\n"));
}

async function start() {
  assertSupportedNode();
  const config = await requireRuntimeConfig();
  await assertManagedPathsConnected();
  await run(
    path.join(projectRoot, "node_modules/.bin/vinext"),
    ["start", "--hostname", config.host, "--port", String(config.port)],
    {
      env: {
        ...process.env,
        PIKMIN_PROJECT_ROOT: projectRoot,
        PIKMIN_DATA_ROOT: dataRoot,
        WRANGLER_LOG_PATH: path.join(dataRoot, "logs/wrangler"),
      },
    },
  );
}

async function status() {
  const config = await requireRuntimeConfig();
  const connections = [];
  for (const managed of managedPaths) {
    const repositoryPath = path.join(projectRoot, managed.repository);
    const expected = path.join(dataRoot, managed.archive);
    connections.push({
      repository: repositoryPath,
      archive: expected,
      connected: await symlinkPointsTo(repositoryPath, expected),
    });
  }
  console.log(JSON.stringify({
    project_root: projectRoot,
    data_root: dataRoot,
    database: path.join(dataRoot, "runtime/pikmin-postcards.sqlite3"),
    archive_backups: path.join(dataRoot, "backups"),
    logs: path.join(dataRoot, "logs"),
    host: config.host,
    port: config.port,
    local_url: `http://localhost:${config.port}`,
    connections,
  }, null, 2));
}

async function connectManagedPath({ repository, archive, initialize }) {
  const repositoryPath = path.join(projectRoot, repository);
  const archivePath = path.join(dataRoot, archive);
  const details = await lstatOptional(repositoryPath);

  if (details?.isSymbolicLink()) {
    if (!await symlinkPointsTo(repositoryPath, archivePath)) {
      const actual = await readlink(repositoryPath);
      throw new Error(`${repositoryPath} already points to ${actual}; expected ${archivePath}`);
    }
    if (!await lstatOptional(archivePath)) await initializeArchivePath(archivePath, initialize);
    return;
  }

  if (details) {
    if (!details.isDirectory()) throw new Error(`${repositoryPath} must be a directory or symlink`);
    const archiveDetails = await lstatOptional(archivePath);
    if (archiveDetails && !archiveDetails.isDirectory()) throw new Error(`${archivePath} is not a directory`);
    if (archiveDetails && !await directoryIsEmpty(archivePath)) {
      throw new Error(`Refusing to merge two archives: both ${repositoryPath} and ${archivePath} contain data`);
    }
    await mkdir(path.dirname(archivePath), { recursive: true });
    if (archiveDetails) await rm(archivePath, { recursive: true });
    try {
      await rename(repositoryPath, archivePath);
    } catch (error) {
      if (error.code !== "EXDEV") throw error;
      await cp(repositoryPath, archivePath, { recursive: true, errorOnExist: true });
      const migrationBackup = path.join(dataRoot, "migration-backups", `${repository.replaceAll("/", "-")}-${Date.now()}`);
      await mkdir(path.dirname(migrationBackup), { recursive: true });
      await rename(repositoryPath, migrationBackup);
    }
  } else {
    await initializeArchivePath(archivePath, initialize);
  }

  await mkdir(path.dirname(repositoryPath), { recursive: true });
  const relativeTarget = path.relative(path.dirname(repositoryPath), archivePath) || ".";
  await symlink(relativeTarget, repositoryPath, "dir");
}

async function initializeArchivePath(archivePath, initialize) {
  await mkdir(archivePath, { recursive: true });
  if (initialize) await initialize(archivePath);
}

async function initializeSnapshots(target) {
  for (const name of ["postcards.json", "friends.json", "imports.json", "context.json"]) {
    const destination = path.join(target, name);
    if (!await lstatOptional(destination)) await cp(path.join(templateRoot, name), destination, { errorOnExist: true });
  }
}

async function assertManagedPathsConnected() {
  for (const managed of managedPaths) {
    const repositoryPath = path.join(projectRoot, managed.repository);
    const archivePath = path.join(dataRoot, managed.archive);
    if (!await symlinkPointsTo(repositoryPath, archivePath)) {
      throw new Error(`Local archive is not connected: ${repositoryPath}. Run npm run setup:local first.`);
    }
  }
}

async function symlinkPointsTo(linkPath, expectedPath) {
  const details = await lstatOptional(linkPath);
  if (!details?.isSymbolicLink()) return false;
  try {
    return await realpath(linkPath) === await realpath(expectedPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const target = await readlink(linkPath);
    return path.resolve(path.dirname(linkPath), target) === path.resolve(expectedPath);
  }
}

async function requireRuntimeConfig() {
  const config = await readJsonOptional(configPath);
  if (!config) throw new Error(`Local environment is not installed. Run npm run setup:local first (${configPath}).`);
  return { ...config, port: parsePort(config.port), host: config.host || "0.0.0.0" };
}

function assertExternalDataRoot() {
  const relative = path.relative(projectRoot, dataRoot);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
    throw new Error(`Archive data root must be outside the Git repository: ${dataRoot}`);
  }
}

function assertSupportedNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`Node.js 22.13+ is required; current version is ${process.versions.node}`);
  }
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${value}`);
  return port;
}

async function runNpm(args) {
  return run(process.execPath, [npmExecutable(), ...args], {
    env: {
      ...process.env,
      PIKMIN_PROJECT_ROOT: projectRoot,
      PIKMIN_DATA_ROOT: dataRoot,
      WRANGLER_LOG_PATH: path.join(dataRoot, "logs/wrangler"),
    },
  });
}

function npmExecutable() {
  return process.env.npm_execpath || path.join(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
}

function run(executable, args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: projectRoot, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(executable)} ${args.join(" ")} failed (${signal ?? code})`));
    });
  });
}

async function writeJsonAtomic(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function readJsonOptional(target) {
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function lstatOptional(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function directoryIsEmpty(target) {
  return (await readdir(target)).length === 0;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
