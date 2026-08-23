import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { storeLocalPath } from "../db/asset-paths.mjs";
import { projectRoot } from "../db/database.mjs";

const defaultMaxBytes = 100 * 1024 * 1024;

export async function readUploadSource({ file = null, sourceUrl = null, maxBytes = defaultMaxBytes }) {
  if (file && typeof file.arrayBuffer === "function" && file.size > 0) {
    if (file.size > maxBytes) throw new Error("圖片超過 100 MiB 上限");
    return {
      bytes: Buffer.from(await file.arrayBuffer()),
      sourceKind: "local",
      sourceIdentity: `browser-upload:${file.name}`,
      safeLocator: `browser-upload:${file.name}`,
      originalFilename: path.basename(file.name || "uploaded-image"),
    };
  }
  if (sourceUrl?.trim()) return downloadRemote(sourceUrl.trim(), maxBytes);
  throw new Error("請選擇圖片，或提供圖片網址");
}

export async function stageImage(source, database, inboxDirectory = path.join(projectRoot, "var/image-inbox")) {
  const detected = detectImage(source.bytes);
  const sha256 = digest(source.bytes);
  const canonical = database.prepare("SELECT sha256, local_path FROM assets WHERE sha256 = ?").get(sha256);
  const prior = database.prepare("SELECT local_path FROM image_intake WHERE sha256 = ?").get(sha256);
  const absolutePath = canonical
    ? path.resolve(projectRoot, canonical.local_path)
    : prior
      ? path.resolve(projectRoot, prior.local_path)
      : path.join(inboxDirectory, `${sha256}${detected.extension}`);
  await ensureLocalCopy(absolutePath, source.bytes, sha256);
  const localPath = canonical?.local_path ?? prior?.local_path ?? storeLocalPath(absolutePath);
  const status = canonical ? "canonicalized" : "pending";

  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      INSERT INTO image_intake (
        sha256, local_path, bytes, media_type, file_extension, status, asset_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sha256) DO UPDATE SET
        local_path = excluded.local_path,
        bytes = excluded.bytes,
        media_type = excluded.media_type,
        file_extension = excluded.file_extension,
        status = excluded.status,
        asset_sha256 = excluded.asset_sha256,
        last_seen_at = CURRENT_TIMESTAMP
    `).run(sha256, localPath, source.bytes.length, detected.mediaType, detected.extension, status, canonical?.sha256 ?? null);
    database.prepare(`
      INSERT INTO image_intake_sources (
        intake_sha256, source_kind, source_locator, source_locator_sha256, original_filename
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(intake_sha256, source_locator_sha256) DO UPDATE SET
        source_kind = excluded.source_kind,
        source_locator = excluded.source_locator,
        original_filename = excluded.original_filename,
        last_seen_at = CURRENT_TIMESTAMP
    `).run(
      sha256,
      source.sourceKind,
      source.safeLocator,
      digest(Buffer.from(source.sourceIdentity)),
      source.originalFilename,
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return {
    sha256,
    bytes: source.bytes,
    byteLength: source.bytes.length,
    mediaType: detected.mediaType,
    extension: detected.extension,
    localPath,
    originalFilename: source.originalFilename,
    canonicalPostcardId: canonical
      ? database.prepare("SELECT id FROM postcards WHERE asset_sha256 = ?").get(sha256)?.id ?? null
      : null,
  };
}

async function downloadRemote(value, maxBytes) {
  const requestedUrl = new URL(value);
  if (!["http:", "https:"].includes(requestedUrl.protocol)) throw new Error("圖片網址只支援 HTTP 或 HTTPS");
  const downloadUrl = new URL(requestedUrl);
  if (/(^|\.)dropbox\.com$/i.test(downloadUrl.hostname)) {
    downloadUrl.searchParams.delete("raw");
    downloadUrl.searchParams.set("dl", "1");
  }
  const response = await fetch(downloadUrl, {
    redirect: "follow",
    headers: { "user-agent": "pikmin-postcard-archive/0.1" },
  });
  if (!response.ok) throw new Error(`圖片下載失敗（HTTP ${response.status}）`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("圖片超過 100 MiB 上限");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error("圖片超過 100 MiB 上限");
  return {
    bytes,
    sourceKind: "remote",
    sourceIdentity: requestedUrl.href,
    safeLocator: `${requestedUrl.origin}${requestedUrl.pathname}`,
    originalFilename: path.basename(decodeURIComponent(requestedUrl.pathname)) || "downloaded-image",
  };
}

function detectImage(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return { mediaType: "image/png", extension: ".png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mediaType: "image/jpeg", extension: ".jpeg" };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return { mediaType: "image/webp", extension: ".webp" };
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return { mediaType: "image/gif", extension: ".gif" };
  const brand = bytes.length >= 12 ? bytes.subarray(8, 12).toString("ascii") : "";
  if (bytes.subarray(4, 8).toString("ascii") === "ftyp" && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return { mediaType: "image/heic", extension: ".heic" };
  throw new Error("不支援或不是有效圖片；請使用 PNG、JPEG、WebP、GIF 或 HEIC");
}

async function ensureLocalCopy(targetPath, bytes, expectedHash) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  try {
    const existing = await readFile(targetPath);
    if (digest(existing) !== expectedHash) throw new Error(`本機圖片路徑已有不同內容：${targetPath}`);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
  try {
    await copyFile(temporaryPath, targetPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (digest(await readFile(targetPath)) !== expectedHash) throw new Error(`圖片寫入時路徑內容已改變：${targetPath}`);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
