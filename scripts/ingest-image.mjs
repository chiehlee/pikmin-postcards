import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStoredLocalPath, storeLocalPath } from "../db/asset-paths.mjs";
import {
  backupDatabase,
  defaultDatabasePath,
  openDatabase,
  projectRoot,
} from "../db/database.mjs";

const source = argument("--source");
if (!source) {
  console.error(
    "Usage: node scripts/ingest-image.mjs --source /path/to/image-or-url [--database path] [--inbox-dir path] [--max-mb 100]",
  );
  process.exit(1);
}

const databasePath = argument("--database")
  ? path.resolve(argument("--database"))
  : defaultDatabasePath;
const inboxDirectory = argument("--inbox-dir")
  ? path.resolve(argument("--inbox-dir"))
  : path.join(projectRoot, "var/image-inbox");
const maxMegabytes = Number(argument("--max-mb") ?? 100);
if (!Number.isFinite(maxMegabytes) || maxMegabytes <= 0) {
  throw new Error("--max-mb must be a positive number");
}

const sourceImage = await readSource(source, Math.floor(maxMegabytes * 1024 * 1024));
const detected = detectImage(sourceImage.bytes);
const sha256 = digest(sourceImage.bytes);
const backupPath = await backupDatabase(databasePath);
const database = await openDatabase(databasePath);

try {
  const canonical = database
    .prepare("SELECT sha256, local_path FROM assets WHERE sha256 = ?")
    .get(sha256);
  const previousIntake = database
    .prepare("SELECT local_path FROM image_intake WHERE sha256 = ?")
    .get(sha256);
  const absoluteLocalPath = canonical
    ? resolveStoredLocalPath(canonical.local_path)
    : previousIntake
      ? resolveStoredLocalPath(previousIntake.local_path)
      : path.join(inboxDirectory, `${sha256}${detected.extension}`);

  await ensureLocalCopy(absoluteLocalPath, sourceImage.bytes, sha256);

  const localPath = canonical?.local_path ?? previousIntake?.local_path ?? storeLocalPath(absoluteLocalPath);
  const status = canonical ? "canonicalized" : "pending";
  const sourceHash = digest(Buffer.from(sourceImage.sourceIdentity));
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
    `).run(
      sha256,
      localPath,
      sourceImage.bytes.length,
      detected.mediaType,
      detected.extension,
      status,
      canonical?.sha256 ?? null,
    );
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
      sourceImage.sourceKind,
      sourceImage.safeLocator,
      sourceHash,
      sourceImage.originalFilename,
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  console.log(
    JSON.stringify(
      {
        sha256,
        bytes: sourceImage.bytes.length,
        media_type: detected.mediaType,
        original_filename: sourceImage.originalFilename,
        local_path: localPath,
        status,
        database: storeLocalPath(databasePath),
        backup: backupPath ? storeLocalPath(backupPath) : null,
      },
      null,
      2,
    ),
  );
} finally {
  database.close();
}

async function readSource(value, maxBytes) {
  if (/^https?:\/\//i.test(value)) return downloadRemote(value, maxBytes);

  const localPath = value.startsWith("file:")
    ? fileURLToPath(value)
    : path.resolve(value);
  const details = await stat(localPath);
  if (!details.isFile()) throw new Error(`Image source is not a file: ${localPath}`);
  if (details.size > maxBytes) {
    throw new Error(`Image exceeds the ${formatBytes(maxBytes)} intake limit`);
  }
  return {
    bytes: await readFile(localPath),
    sourceKind: "local",
    sourceIdentity: localPath,
    safeLocator: localPath,
    originalFilename: path.basename(localPath),
  };
}

async function downloadRemote(value, maxBytes) {
  const requestedUrl = new URL(value);
  const downloadUrl = new URL(value);
  if (/(^|\.)dropbox\.com$/i.test(downloadUrl.hostname)) {
    downloadUrl.searchParams.delete("raw");
    downloadUrl.searchParams.set("dl", "1");
  }

  const response = await fetch(downloadUrl, {
    redirect: "follow",
    headers: { "user-agent": "pikmin-postcard-archive/0.1" },
  });
  if (!response.ok) {
    throw new Error(`Image download failed with HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Image exceeds the ${formatBytes(maxBytes)} intake limit`);
  }
  if (!response.body) throw new Error("Image download returned an empty body");

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new Error(`Image exceeds the ${formatBytes(maxBytes)} intake limit`);
    }
    chunks.push(buffer);
  }

  return {
    bytes: Buffer.concat(chunks),
    sourceKind: "remote",
    sourceIdentity: requestedUrl.href,
    safeLocator: `${requestedUrl.origin}${requestedUrl.pathname}`,
    originalFilename: responseFilename(response, requestedUrl),
  };
}

function responseFilename(response, requestedUrl) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return path.basename(decodeURIComponent(encoded));
    } catch {
      return path.basename(encoded);
    }
  }
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  let urlFilename = requestedUrl.pathname;
  try {
    urlFilename = decodeURIComponent(urlFilename);
  } catch {
    // Keep the encoded pathname when a remote server sends malformed escapes.
  }
  return path.basename(plain ?? urlFilename) || "downloaded-image";
}

function detectImage(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return { mediaType: "image/png", extension: ".png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mediaType: "image/jpeg", extension: ".jpeg" };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mediaType: "image/webp", extension: ".webp" };
  }
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) {
    return { mediaType: "image/gif", extension: ".gif" };
  }
  const heifBrand = bytes.length >= 12 ? bytes.subarray(8, 12).toString("ascii") : "";
  if (bytes.subarray(4, 8).toString("ascii") === "ftyp" && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(heifBrand)) {
    return { mediaType: "image/heic", extension: ".heic" };
  }
  throw new Error("Unsupported or invalid image; expected PNG, JPEG, WebP, GIF, or HEIC");
}

async function ensureLocalCopy(targetPath, bytes, expectedHash) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  try {
    const existing = await readFile(targetPath);
    if (digest(existing) !== expectedHash) {
      throw new Error(`Managed image path contains different bytes: ${targetPath}`);
    }
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
  try {
    await copyFile(temporaryPath, targetPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readFile(targetPath);
    if (digest(existing) !== expectedHash) {
      throw new Error(`Managed image path changed during intake: ${targetPath}`);
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function formatBytes(value) {
  return `${Math.ceil(value / 1024 / 1024)} MiB`;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
