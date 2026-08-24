#!/usr/bin/env node

import path from "node:path";
import {
  createArchiveBackup,
  resolveArchiveDataRoot,
  verifyArchiveBackup,
} from "../db/archive-backup.mjs";
import { defaultDatabasePath } from "../db/database.mjs";

const command = process.argv[2] ?? "create";

if (command === "create") {
  const databasePath = path.resolve(argument("--database") ?? defaultDatabasePath);
  const dataRoot = await resolveArchiveDataRoot({
    databasePath,
    configuredDataRoot: argument("--data-root") ?? process.env.PIKMIN_DATA_ROOT,
  });
  const backup = await createArchiveBackup({ databasePath, dataRoot });
  console.log(JSON.stringify({
    backup: backup?.directory ?? null,
    database: backup?.databasePath ?? null,
    file_count: backup?.manifest.file_count ?? 0,
    total_bytes: backup?.manifest.total_bytes ?? 0,
    assets: backup?.manifest.asset_binding ?? null,
    image_storage: "filesystem-hardlink-snapshot",
  }, null, 2));
} else if (command === "verify") {
  const backupDirectory = argument("--backup");
  if (!backupDirectory) throw new Error("verify 需要 --backup /path/to/archive-backup");
  console.log(JSON.stringify(await verifyArchiveBackup(backupDirectory), null, 2));
} else {
  throw new Error(`未知的 archive backup 指令：${command}`);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
