import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { projectRoot } from "../db/database.mjs";

const maximumImages = 3;
const maximumImageBytes = 10 * 1024 * 1024;
const maximumRedirects = 4;

export async function preserveResearchImages({
  postcardId,
  jobId,
  candidates,
  outputRoot = path.join(projectRoot, "public/images/research"),
  publicPrefix = "/images/research",
  fetchImpl = globalThis.fetch,
  validateRemoteUrl = assertPublicHttpUrl,
} = {}) {
  const images = [];
  const failures = [];
  const seenHashes = new Set();
  const selected = Array.isArray(candidates) ? candidates.slice(0, maximumImages) : [];

  for (const [index, candidate] of selected.entries()) {
    try {
      const sourcePage = normalizedHttpUrl(candidate?.source_page_url);
      const sourceImage = normalizedHttpUrl(candidate?.image_url);
      await validateRemoteUrl(sourcePage);
      const response = await fetchWithValidatedRedirects(sourceImage, { fetchImpl, validateRemoteUrl });
      if (!response.ok) throw new Error(`圖片下載 HTTP ${response.status}`);
      const bytes = await readLimitedBody(response, maximumImageBytes);
      const detected = detectImage(bytes);
      if (!detected) throw new Error("下載內容不是支援的 PNG、JPEG、WebP 或 GIF 圖片");

      const checksum = sha256(bytes);
      if (seenHashes.has(checksum)) continue;
      seenHashes.add(checksum);

      const directory = path.join(outputRoot, safeSegment(postcardId));
      const filename = `${safeSegment(jobId).slice(-24)}-${index + 1}-${checksum.slice(0, 12)}${detected.extension}`;
      const target = path.join(directory, filename);
      const temporary = `${target}.tmp-${process.pid}`;
      await mkdir(directory, { recursive: true });
      await writeFile(temporary, bytes, { flag: "wx" });
      try {
        await rename(temporary, target);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }

      images.push({
        path: `${publicPrefix}/${safeSegment(postcardId)}/${filename}`,
        sha256: checksum,
        bytes: bytes.length,
        media_type: detected.mediaType,
        source_page_url: safeRemoteLocator(sourcePage),
        source_page_url_sha256: sha256(Buffer.from(sourcePage.href)),
        source_image_url: safeRemoteLocator(response.url || sourceImage),
        source_image_url_sha256: sha256(Buffer.from((response.url || sourceImage).toString())),
        caption: boundedText(candidate.caption, 300, "圖片說明"),
        alt: boundedText(candidate.alt, 300, "替代文字"),
        credit: nullableBoundedText(candidate.credit, 200),
      });
    } catch (error) {
      failures.push({
        source_page_url: safeRemoteLocatorOrNull(candidate?.source_page_url),
        error: safeErrorMessage(error),
      });
    }
  }

  return { images, failures };
}

export function safeRemoteLocator(value) {
  const url = normalizedHttpUrl(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href;
}

async function fetchWithValidatedRedirects(initialUrl, { fetchImpl, validateRemoteUrl }) {
  let current = normalizedHttpUrl(initialUrl);
  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    await validateRemoteUrl(current);
    const response = await fetchImpl(current, {
      redirect: "manual",
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1",
        "user-agent": "PikminPostcardArchive/1.0 research-image-preserver",
      },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("圖片下載 redirect 缺少 Location");
    current = new URL(location, current);
  }
  throw new Error(`圖片下載 redirect 超過 ${maximumRedirects} 次`);
}

async function assertPublicHttpUrl(value) {
  const url = normalizedHttpUrl(value);
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("不允許存取本機圖片網址");
  const addresses = net.isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("不允許存取 private／loopback 圖片網址");
  }
}

function normalizedHttpUrl(value) {
  const url = value instanceof URL ? new URL(value) : new URL(String(value ?? ""));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("圖片來源必須是無帳密的 HTTP(S) URL");
  }
  return url;
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || a >= 224;
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mapped ? isPrivateAddress(mapped) : false;
  }
  return true;
}

async function readLimitedBody(response, limit) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new Error(`圖片超過 ${limit} bytes 上限`);
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > limit) throw new Error(`圖片超過 ${limit} bytes 上限`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

function detectImage(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { extension: ".png", mediaType: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: ".jpg", mediaType: "image/jpeg" };
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { extension: ".webp", mediaType: "image/webp" };
  }
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) {
    return { extension: ".gif", mediaType: "image/gif" };
  }
  return null;
}

function boundedText(value, maximum, label) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label}不可為空`);
  if (result.length > maximum) throw new Error(`${label}超過 ${maximum} 字元`);
  return result;
}

function nullableBoundedText(value, maximum) {
  if (value == null || !String(value).trim()) return null;
  return boundedText(value, maximum, "圖片署名");
}

function safeSegment(value) {
  const segment = String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "-");
  if (!segment) throw new Error("研究圖片路徑缺少安全識別碼");
  return segment;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeRemoteLocatorOrNull(value) {
  try {
    return safeRemoteLocator(value);
  } catch {
    return null;
  }
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/[^\s]+/g, (url) => safeRemoteLocatorOrNull(url) ?? "[INVALID URL]");
}
