import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("production site serves dialogs, keyless maps, and canonical assets", { timeout: 20_000 }, async () => {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
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
    const home = await waitForResponse(`${origin}/`, server, () => serverOutput);
    const html = await home.text();
    assert.match(home.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html, /<title>Pikmin Postcard Archive<\/title>/);

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
    assert.match(clientCode, /https:\/\/www\.google\.com\/maps\?/);
    assert.doesNotMatch(clientCode, /Google Maps Embed 尚未設定/);
    assert.doesNotMatch(clientCode, /NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY/);

    const image = await fetch(`${origin}/images/postcards/2026/05/pc-020.png`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type") ?? "", /image\/png/);
    assert.ok((await image.arrayBuffer()).byteLength > 0);
  } finally {
    server.kill("SIGTERM");
    if (server.exitCode == null) await new Promise((resolve) => server.once("exit", resolve));
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
