#!/usr/bin/env node

import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serviceLabel = "com.chiehstudio.pikmin-postcards";
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const launchAgentPath = path.join(os.homedir(), "Library/LaunchAgents", `${serviceLabel}.plist`);
const locatorPath = path.join(projectRoot, ".pikmin-local.json");
const pollIntervalMs = 5_000;
const retryIntervalMs = 30_000;
const healthTimeoutMs = 30_000;
const gracefulStopMs = 15_000;

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    console.error(`[pikmin-service] ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}

async function main() {
  const command = process.argv[2] ?? "status";
  if (command === "install") return installService();
  if (command === "uninstall") return uninstallService();
  if (command === "restart") return restartService();
  if (command === "status") return serviceStatus();
  if (command === "run") return runSupervisor();
  throw new Error(`Unknown service command: ${command}`);
}

async function installService() {
  assertMacOS();
  const environment = await localEnvironment();
  await mkdir(path.dirname(launchAgentPath), { recursive: true });
  await mkdir(path.join(environment.dataRoot, "logs"), { recursive: true });
  await writeAtomic(
    launchAgentPath,
    renderLaunchAgent({
      label: serviceLabel,
      nodePath: process.execPath,
      scriptPath,
      projectRoot,
      logPath: path.join(environment.dataRoot, "logs/pikmin-service.log"),
      executablePath: serviceExecutablePath(),
    }),
    0o644,
  );

  const target = serviceTarget();
  await runCommand("launchctl", ["bootout", target], { allowFailure: true, quiet: true });
  await runCommand("launchctl", ["bootstrap", `gui/${process.getuid()}`, launchAgentPath]);
  await runCommand("launchctl", ["enable", target]);
  await runCommand("launchctl", ["kickstart", "-k", target]);
  console.log(`Pikmin service installed: ${target}`);
  console.log(`Local: http://localhost:${environment.config.port}`);
}

async function uninstallService() {
  assertMacOS();
  await runCommand("launchctl", ["bootout", serviceTarget()], { allowFailure: true, quiet: true });
  await rm(launchAgentPath, { force: true });
  console.log(`Pikmin service removed: ${serviceLabel}`);
}

async function restartService() {
  assertMacOS();
  await runCommand("launchctl", ["kickstart", "-k", serviceTarget()]);
  console.log(`Pikmin service restarted: ${serviceLabel}`);
}

async function serviceStatus() {
  assertMacOS();
  const environment = await localEnvironment();
  const status = await runCommand("launchctl", ["print", serviceTarget()], { allowFailure: true, capture: true });
  const healthy = await archiveStatus(environment.config.port);
  console.log(JSON.stringify({
    installed: status.code === 0,
    running: status.code === 0 && /state = running/.test(status.stdout),
    healthy: Boolean(healthy),
    port: environment.config.port,
    local_url: `http://localhost:${environment.config.port}`,
    active_jobs: activeJobCount(healthy),
    launch_agent: launchAgentPath,
    log: path.join(environment.dataRoot, "logs/pikmin-service.log"),
  }, null, 2));
}

async function runSupervisor() {
  const environment = await localEnvironment();
  const statePath = path.join(environment.dataRoot, "config/service.json");
  let server = null;
  let stopping = false;
  let nextRetryAt = 0;
  let waitingForJobsCommit = null;

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log(`received ${signal}; stopping server`);
    await stopServer(server);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  server = await startServer(environment.config.port);

  while (!stopping) {
    if (!server || server.exitCode !== null) {
      log("server is not running; restarting it");
      server = await startServer(environment.config.port);
    }

    const head = await currentCommit();
    const state = await readJsonOptional(statePath);
    if (head && state?.deployed_commit !== head && Date.now() >= nextRetryAt) {
      const archive = await archiveStatus(environment.config.port);
      const activeJobs = activeJobCount(archive);
      if (activeJobs > 0) {
        if (waitingForJobsCommit !== head) {
          log(`commit ${shortCommit(head)} is ready, but ${activeJobs} AI job(s) are active; update deferred`);
          waitingForJobsCommit = head;
        }
      } else {
        waitingForJobsCommit = null;
        try {
          const changedPaths = state?.deployed_commit
            ? await changedFiles(state.deployed_commit, head)
            : [];
          const plan = classifyChangedPaths(changedPaths, { initial: !state?.deployed_commit });
          if (plan.build) {
            log(`building commit ${shortCommit(head)}`);
            const previousConfig = await readJson(environment.configPath);
            await publishUpdate(previousConfig.port, plan);
            const updatedConfig = await readJson(environment.configPath);
            await stopServer(server);
            server = null;
            try {
              server = await startServer(updatedConfig.port);
            } catch (error) {
              log(`new build failed health check; restoring previous build: ${error.message}`);
              await writeAtomic(environment.configPath, `${JSON.stringify(previousConfig, null, 2)}\n`, 0o600);
              server = await startServer(previousConfig.port);
              throw error;
            }
          }
          await writeAtomic(statePath, `${JSON.stringify({
            schema_version: 1,
            deployed_commit: head,
            deployed_at: new Date().toISOString(),
          }, null, 2)}\n`, 0o600);
          log(`commit ${shortCommit(head)} is live`);
          nextRetryAt = 0;
        } catch (error) {
          log(`update failed; current live build remains available: ${error.message}`);
          nextRetryAt = Date.now() + retryIntervalMs;
        }
      }
    }

    await delay(pollIntervalMs);
  }
}

async function publishUpdate(port, plan) {
  const args = [scriptPath.replace("local-service.mjs", "local-environment.mjs"), "setup", "--port", String(port)];
  if (!plan.installDependencies) args.push("--skip-dependencies");
  if (!plan.syncDatabase) args.push("--skip-sync");
  await runCommand(process.execPath, args, { cwd: projectRoot });
}

async function startServer(port) {
  const child = spawn(
    process.execPath,
    [path.join(projectRoot, "scripts/local-environment.mjs"), "start"],
    {
      cwd: projectRoot,
      env: { ...process.env, PATH: serviceExecutablePath() },
      detached: true,
      stdio: "inherit",
    },
  );
  child.once("exit", (code, signal) => log(`server exited (${signal ?? code})`));
  const archive = await waitForArchive(port, healthTimeoutMs);
  if (!archive || child.exitCode !== null) {
    await stopServer(child);
    throw new Error(`server did not become healthy on port ${port}`);
  }
  log(`server healthy at http://localhost:${port}`);
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
    return;
  }
  if (await Promise.race([exited.then(() => true), delay(gracefulStopMs).then(() => false)])) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await exited;
}

async function localEnvironment() {
  const locator = await readJsonOptional(locatorPath);
  if (!locator?.data_root) {
    throw new Error(`Local environment is not installed. Run npm run setup:local first (${locatorPath}).`);
  }
  const dataRoot = path.resolve(locator.data_root);
  const configPath = path.join(dataRoot, "config/runtime.json");
  const config = await readJsonOptional(configPath);
  if (!config?.port || !config?.build_path) {
    throw new Error(`Local production runtime is not ready. Run npm run setup:local first (${configPath}).`);
  }
  return { dataRoot, configPath, config };
}

async function currentCommit() {
  const result = await runCommand("git", ["rev-parse", "HEAD"], { cwd: projectRoot, allowFailure: true, capture: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

async function changedFiles(previousCommit, currentCommit) {
  const result = await runCommand(
    "git",
    ["diff", "--name-only", previousCommit, currentCommit, "--"],
    { cwd: projectRoot, allowFailure: true, capture: true },
  );
  if (result.code !== 0) return ["unknown-runtime-change"];
  return result.stdout.split("\n").map((entry) => entry.trim()).filter(Boolean);
}

export function classifyChangedPaths(paths, { initial = false } = {}) {
  if (initial) return { build: true, installDependencies: false, syncDatabase: false };
  const installDependencies = paths.some((entry) => ["package.json", "package-lock.json"].includes(entry));
  const syncDatabase = paths.some((entry) => entry.startsWith("db/migrations/") || entry.startsWith("templates/fresh-data/"));
  const documentationOnly = paths.length > 0 && paths.every((entry) => (
    entry === "README.md"
      || entry.startsWith("docs/")
      || entry.startsWith("tests/")
      || entry.startsWith(".github/")
  ));
  return {
    build: !documentationOnly,
    installDependencies,
    syncDatabase,
  };
}

export function activeJobCount(archive) {
  if (!Array.isArray(archive?.jobs)) return 0;
  return archive.jobs.filter((job) => !["completed", "failed", "cancelled"].includes(job?.status)).length;
}

async function archiveStatus(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/archive`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function waitForArchive(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const archive = await archiveStatus(port);
    if (archive) return archive;
    await delay(500);
  }
  return null;
}

export function renderLaunchAgent({ label, nodePath, scriptPath: serviceScript, projectRoot: root, logPath, executablePath }) {
  const value = (input) => escapeXml(String(input));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${value(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${value(nodePath)}</string>
    <string>${value(serviceScript)}</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${value(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${value(executablePath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${value(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${value(logPath)}</string>
</dict>
</plist>
`;
}

function serviceExecutablePath() {
  return [...new Set([
    path.join(os.homedir(), ".local/bin"),
    path.dirname(process.execPath),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ])].join(path.delimiter);
}

function serviceTarget() {
  return `gui/${process.getuid()}/${serviceLabel}`;
}

function assertMacOS() {
  if (process.platform !== "darwin") throw new Error("The automatic local service currently supports macOS launchd only.");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shortCommit(commit) {
  return commit.slice(0, 8);
}

function log(message) {
  console.log(`[pikmin-service] ${new Date().toISOString()} ${message}`);
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function readJsonOptional(target) {
  try {
    return await readJson(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(target, contents, mode) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode });
  await chmod(temporary, mode);
  await rename(temporary, target);
}

function runCommand(executable, args, {
  cwd = projectRoot,
  allowFailure = false,
  capture = false,
  quiet = false,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, PATH: serviceExecutablePath() },
      stdio: capture ? ["ignore", "pipe", "pipe"] : (quiet ? "ignore" : "inherit"),
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      const result = { code: code ?? 1, signal, stdout, stderr };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new Error(`${path.basename(executable)} ${args.join(" ")} failed (${signal ?? code})${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
