import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preserveResearchImages, safeRemoteLocator } from "../server/research-images.mjs";

test("research images are capped, validated by bytes, downloaded locally, and stripped of URL secrets", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-research-images-"));
  const fixture = await readFile(new URL("../public/og.png", import.meta.url));
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/valid.png")) {
      response.writeHead(200, { "content-type": "image/png", "content-length": fixture.length });
      response.end(fixture);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("not an image");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  try {
    const result = await preserveResearchImages({
      postcardId: "pc-test",
      jobId: "job-functional-test",
      candidates: [
        candidate(`${origin}/valid.png?token=first`, "第一張"),
        candidate(`${origin}/valid.png?token=duplicate`, "相同內容"),
        candidate(`${origin}/not-image?token=never-store`, "錯誤內容"),
        candidate(`${origin}/valid.png?token=fourth-is-ignored`, "第四張"),
      ],
      outputRoot: temporaryDirectory,
      publicPrefix: "/test-research",
      validateRemoteUrl: async () => {},
    });

    assert.equal(result.images.length, 1, "same-byte candidates should be deduplicated");
    assert.equal(result.failures.length, 1, "only the first three candidates should be attempted");
    const [image] = result.images;
    assert.match(image.path, /^\/test-research\/pc-test\//);
    assert.equal(image.media_type, "image/png");
    assert.equal(image.bytes, fixture.length);
    assert.equal(image.caption, "第一張");
    assert.equal(image.credit, "測試來源");
    assert.doesNotMatch(JSON.stringify(result), /token=/);
    const localPath = path.join(temporaryDirectory, "pc-test", path.basename(image.path));
    assert.equal((await stat(localPath)).size, fixture.length);
    assert.deepEqual(await readFile(localPath), fixture);
    assert.equal(image.sha256.length, 64);
    assert.equal(image.source_image_url_sha256.length, 64);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("research image preservation rejects loopback sources without making a request", async () => {
  let requested = false;
  const result = await preserveResearchImages({
    postcardId: "pc-test",
    jobId: "job-loopback-test",
    candidates: [candidate("http://localhost/private.png?secret=value", "不採用")],
    fetchImpl: async () => {
      requested = true;
      throw new Error("must not run");
    },
  });

  assert.equal(requested, false);
  assert.equal(result.images.length, 0);
  assert.equal(result.failures.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /secret=value/);
  assert.equal(safeRemoteLocator("https://example.com/photo.jpg?signature=secret#fragment"), "https://example.com/photo.jpg");
});

function candidate(imageUrl, caption) {
  return {
    source_page_url: `${imageUrl.split("/").slice(0, 3).join("/")}/story?session=private`,
    image_url: imageUrl,
    caption,
    alt: `${caption}的替代文字`,
    credit: "測試來源",
  };
}
