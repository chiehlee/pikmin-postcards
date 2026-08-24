import { createHash, randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const archiveBackupFormat = "pikmin-postcard-archive-backup-v1";

export async function resolveArchiveDataRoot({ databasePath, configuredDataRoot = "" }) {
  if (configuredDataRoot?.trim()) return path.resolve(configuredDataRoot.trim());
  const runtimeDirectory = await realpath(path.dirname(databasePath));
  if (path.basename(runtimeDirectory) !== "runtime") {
    throw new Error("無法從資料庫路徑判斷 archive data root；請設定 PIKMIN_DATA_ROOT");
  }
  return path.dirname(runtimeDirectory);
}

export async function createArchiveBackup({
  databasePath,
  dataRoot,
  backupRoot = path.join(dataRoot, "backups"),
  now = new Date(),
} = {}) {
  if (!databasePath) throw new Error("建立 archive backup 時缺少 databasePath");
  if (!dataRoot) throw new Error("建立 archive backup 時缺少 dataRoot");
  const databaseDetails = await stat(databasePath);
  if (!databaseDetails.isFile() || databaseDetails.size === 0) return null;

  const timestamp = now.toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const backupId = `archive-${safeTimestamp}-${randomBytes(3).toString("hex")}`;
  const destination = path.join(backupRoot, backupId);
  const temporary = `${destination}.tmp`;
  await mkdir(backupRoot, { recursive: true });
  await rm(temporary, { recursive: true, force: true });

  const checkpoint = new DatabaseSync(databasePath);
  try {
    checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    checkpoint.close();
  }

  try {
    const databaseRelativePath = "runtime/pikmin-postcards.sqlite3";
    const bundledDatabasePath = path.join(temporary, databaseRelativePath);
    await mkdir(path.dirname(bundledDatabasePath), { recursive: true });
    await copyFile(databasePath, bundledDatabasePath);

    let hardlinkedFiles = 0;
    const sources = [
      { source: path.join(dataRoot, "snapshots"), destination: "snapshots", hardlink: false },
      { source: path.join(dataRoot, "images"), destination: "images", hardlink: true },
      { source: path.join(dataRoot, "research/raw"), destination: "research/raw", hardlink: true },
      { source: path.join(dataRoot, "imports/source-bundles"), destination: "imports/source-bundles", hardlink: true },
      { source: path.join(dataRoot, "runtime/image-inbox"), destination: "runtime/image-inbox", hardlink: true },
    ];
    for (const source of sources) {
      hardlinkedFiles += await copyTree(source.source, path.join(temporary, source.destination), {
        hardlinkFiles: source.hardlink,
      });
    }

    const assetBinding = verifyBundledDatabaseReferences(bundledDatabasePath, temporary, dataRoot);
    const files = await fileManifest(temporary);
    const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
    const migrations = databaseMigrations(bundledDatabasePath);
    const manifest = {
      format: archiveBackupFormat,
      backup_id: backupId,
      created_at: timestamp,
      database: {
        driver: "sqlite",
        path: databaseRelativePath,
        migrations,
      },
      storage: {
        image_mode: "filesystem",
        image_root: "images",
        intake_root: "runtime/image-inbox",
        hardlinked_files: hardlinkedFiles,
        note: "Hard links are independent directory entries: deleting the live file does not remove this backup copy.",
      },
      asset_binding: assetBinding,
      file_count: files.length,
      total_bytes: totalBytes,
      files,
    };
    await writeFile(path.join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(temporary, destination);
    return {
      directory: destination,
      databasePath: path.join(destination, databaseRelativePath),
      manifest,
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyArchiveBackup(backupDirectory) {
  const directory = path.resolve(backupDirectory);
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.format !== archiveBackupFormat) throw new Error("不支援的 archive backup 格式");
  if (!Array.isArray(manifest.files)) throw new Error("archive backup manifest 缺少 files");
  for (const expected of manifest.files) {
    const target = safeBundlePath(directory, expected.path);
    const details = await stat(target);
    if (!details.isFile() || details.size !== expected.bytes) {
      throw new Error(`backup 檔案大小不符：${expected.path}`);
    }
    const actual = await sha256File(target);
    if (actual !== expected.sha256) throw new Error(`backup checksum 不符：${expected.path}`);
  }
  const databasePath = safeBundlePath(directory, manifest.database?.path ?? "");
  const assetBinding = verifyBundledDatabaseReferences(databasePath, directory, null);
  if (assetBinding.database_assets !== manifest.asset_binding?.database_assets) {
    throw new Error("backup DB asset 數量與 manifest 不一致");
  }
  if (assetBinding.intake_assets !== manifest.asset_binding?.intake_assets) {
    throw new Error("backup DB intake 數量與 manifest 不一致");
  }
  return {
    ok: true,
    backup_id: manifest.backup_id,
    created_at: manifest.created_at,
    file_count: manifest.file_count,
    total_bytes: manifest.total_bytes,
    asset_binding: assetBinding,
  };
}

export function bundledPathForStoredAsset(storedPath, dataRoot = null) {
  if (typeof storedPath !== "string" || !storedPath.trim()) return null;
  const normalized = storedPath.split(path.sep).join("/");
  if (normalized.startsWith("/images/")) return normalized.slice(1);
  if (normalized.startsWith("public/images/")) return normalized.slice("public/".length);
  if (normalized.startsWith("var/image-inbox/")) return `runtime/${normalized.slice("var/".length)}`;
  if (path.isAbsolute(storedPath) && dataRoot) {
    const relative = path.relative(path.resolve(dataRoot), path.resolve(storedPath));
    if (relative && !relative.startsWith(`..${path.sep}`) && relative !== "..") {
      return relative.split(path.sep).join("/");
    }
  }
  if (path.isAbsolute(storedPath)) {
    const imageMarker = "/images/";
    const imageIndex = normalized.lastIndexOf(imageMarker);
    if (imageIndex !== -1) return normalized.slice(imageIndex + 1);
    const intakeMarker = "/runtime/image-inbox/";
    const intakeIndex = normalized.lastIndexOf(intakeMarker);
    if (intakeIndex !== -1) return normalized.slice(intakeIndex + 1);
  }
  return null;
}

async function copyTree(source, destination, { hardlinkFiles }) {
  const details = await lstatOptional(source);
  if (!details) return 0;
  if (!details.isDirectory()) throw new Error(`archive backup source 必須是目錄：${source}`);
  await mkdir(destination, { recursive: true });
  let hardlinked = 0;
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      hardlinked += await copyTree(sourcePath, destinationPath, { hardlinkFiles });
    } else if (entry.isFile()) {
      await mkdir(path.dirname(destinationPath), { recursive: true });
      if (hardlinkFiles) {
        try {
          await link(sourcePath, destinationPath);
          hardlinked += 1;
          continue;
        } catch (error) {
          if (!["EXDEV", "EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
        }
      }
      await copyFile(sourcePath, destinationPath);
    } else {
      throw new Error(`archive backup 不接受 symlink 或特殊檔案：${sourcePath}`);
    }
  }
  return hardlinked;
}

async function fileManifest(root) {
  const files = [];
  await walk(root, async (target, relative) => {
    files.push({
      path: relative,
      bytes: (await stat(target)).size,
      sha256: await sha256File(target),
    });
  });
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function walk(root, visit, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(root, visit, target);
    else if (entry.isFile()) await visit(target, path.relative(root, target).split(path.sep).join("/"));
    else throw new Error(`archive backup 含有不支援的特殊檔案：${target}`);
  }
}

function verifyBundledDatabaseReferences(databasePath, bundleRoot, dataRoot) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const assetRows = database.prepare("SELECT path, local_path FROM assets").all();
    const intakeRows = hasTable(database, "image_intake")
      ? database.prepare("SELECT local_path FROM image_intake").all()
      : [];
    const referenced = [
      ...assetRows.map((row) => row.path || row.local_path),
      ...intakeRows.map((row) => row.local_path),
    ];
    for (const storedPath of referenced) {
      const relative = bundledPathForStoredAsset(storedPath, dataRoot);
      if (!relative) throw new Error(`DB 圖片路徑無法放入 backup：${storedPath}`);
      const target = safeBundlePath(bundleRoot, relative);
      const details = statSyncSafe(target);
      if (!details?.isFile()) throw new Error(`backup 缺少 DB 指向的圖片：${relative}`);
    }
    return {
      database_assets: assetRows.length,
      intake_assets: intakeRows.length,
      missing: 0,
    };
  } finally {
    database.close();
  }
}

function databaseMigrations(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    if (!hasTable(database, "schema_migrations")) return [];
    return database.prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version").all();
  } finally {
    database.close();
  }
}

function hasTable(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name));
}

function statSyncSafe(target) {
  try {
    return statSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function safeBundlePath(root, relative) {
  if (!relative || path.isAbsolute(relative)) throw new Error(`不安全的 backup 路徑：${relative}`);
  const target = path.resolve(root, relative);
  const relation = path.relative(path.resolve(root), target);
  if (!relation || relation.startsWith(`..${path.sep}`) || relation === "..") {
    throw new Error(`不安全的 backup 路徑：${relative}`);
  }
  return target;
}

async function sha256File(target) {
  return createHash("sha256").update(await readFile(target)).digest("hex");
}

async function lstatOptional(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
