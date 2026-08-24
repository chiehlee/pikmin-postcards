import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("production server bundle does not embed the build machine's database source path", async () => {
  const serverDirectory = path.join(projectRoot, "dist/server");
  const sourceUrl = pathToFileURL(path.join(projectRoot, "db/database.mjs")).href;
  const bundleFiles = (await readdir(serverDirectory, { recursive: true }))
    .filter((file) => file.endsWith(".js"));

  assert.ok(bundleFiles.length > 0, "Expected production server bundles");
  for (const file of bundleFiles) {
    const bundle = await readFile(path.join(serverDirectory, file), "utf8");
    assert.equal(
      bundle.includes(sourceUrl),
      false,
      `Production bundle ${file} contains the build-time database source path`,
    );
  }
});

test("production site serves dialogs, keyless maps, and canonical assets", { timeout: 20_000 }, async () => {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const runtimeAssetDirectory = path.join(projectRoot, "public/images/runtime-test");
  const runtimeAsset = path.join(runtimeAssetDirectory, "post-build.png");
  const server = spawn(
    process.execPath,
    [
      "node_modules/vinext/dist/cli.js",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  let serverOutput = "";
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });

  try {
    await mkdir(runtimeAssetDirectory, { recursive: true });
    await copyFile(path.join(projectRoot, "public/images/postcards/2026/05/pc-020.png"), runtimeAsset);
    const home = await waitForResponse(`${origin}/`, server, () => serverOutput);
    const html = await home.text();
    assert.match(home.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html, /<title>Pikmin 明信片收藏研究庫<\/title>/);

    const settingsPage = await fetch(`${origin}/settings`);
    assert.equal(settingsPage.status, 200);
    const settingsHtml = await settingsPage.text();
    assert.match(settingsHtml, /<title>設定 · Pikmin 明信片收藏研究庫<\/title>/);
    assert.match(settingsHtml, /本機 Codex/);
    assert.match(settingsHtml, /OpenAI API Key/);

    const settingsResponse = await fetch(`${origin}/api/settings`);
    assert.equal(settingsResponse.status, 200);
    const settingsPayload = await settingsResponse.json();
    assert.equal(typeof settingsPayload.settings.api_key_configured, "boolean");
    assert.ok(["openai_api", "local_codex"].includes(settingsPayload.settings.provider));
    assert.ok(["none", "low", "medium", "high", "xhigh", "max"].includes(settingsPayload.settings.reasoning_effort));
    assert.equal(typeof settingsPayload.settings.local_codex.installed, "boolean");
    assert.equal(settingsPayload.settings.secret_write_allowed, true);
    assert.equal(Object.hasOwn(settingsPayload.settings, "api_key"), false);
    assert.equal(Object.hasOwn(settingsPayload.settings, "OPENAI_API_KEY"), false);

    const archiveResponse = await fetch(`${origin}/api/archive`);
    assert.equal(archiveResponse.status, 200);
    const archivePayload = await archiveResponse.json();
    assert.equal(archivePayload.api_version, 1);
    assert.ok(archivePayload.postcards.length > 100);
    assert.equal(Array.isArray(archivePayload.friends), true);

    const clientPaths = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)]
      .map((match) => match[1]);
    assert.ok(clientPaths.length > 0, "Expected production client bundles in the HTML");
    const clientCode = (await Promise.all(clientPaths.map(async (clientPath) => {
      const response = await fetch(new URL(clientPath, origin));
      assert.equal(response.status, 200, `Failed to load ${clientPath}`);
      return response.text();
    }))).join("\n");
    assert.match(clientCode, /RELATED POSTCARD/);
    assert.doesNotMatch(clientCode, /RELATED SCREENSHOTS/);
    assert.match(clientCode, /關閉長版研究/);
    assert.match(clientCode, /research-modal-scroll/);
    assert.match(clientCode, /載入 Google Map/);
    assert.match(clientCode, /故事參考圖片/);
    assert.match(clientCode, /查看圖片來源/);
    assert.match(clientCode, /https:\/\/www\.google\.com\/maps\?/);
    assert.doesNotMatch(clientCode, /Google Maps Embed 尚未設定/);
    assert.doesNotMatch(clientCode, /NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY/);
    assert.doesNotMatch(clientCode, /One Grantai Fontain/, "Canonical postcard data must come from the backend API, not the client bundle");

    const image = await fetch(`${origin}/images/postcards/2026/05/pc-020.png`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type") ?? "", /image\/png/);
    assert.ok((await image.arrayBuffer()).byteLength > 0);

    const runtimeImage = await fetch(`${origin}/api/assets?path=${encodeURIComponent('/images/runtime-test/post-build.png')}`);
    assert.equal(runtimeImage.status, 200);
    assert.match(runtimeImage.headers.get("content-type") ?? "", /image\/png/);
    assert.match(runtimeImage.headers.get("etag") ?? "", /^"[a-f0-9]{64}"$/);
    assert.ok((await runtimeImage.arrayBuffer()).byteLength > 0);

    const unsafeAsset = await fetch(`${origin}/api/assets?path=${encodeURIComponent('/images/../private.png')}`);
    assert.equal(unsafeAsset.status, 400);
  } finally {
    server.kill("SIGTERM");
    if (server.exitCode == null) await new Promise((resolve) => server.once("exit", resolve));
    await rm(runtimeAssetDirectory, { recursive: true, force: true });
  }
});

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForResponse(url, server, output) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode != null) {
      throw new Error(`Production server exited before becoming ready:\n${output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Server startup races are expected during this bounded readiness loop.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Production server did not become ready:\n${output()}`);
}
