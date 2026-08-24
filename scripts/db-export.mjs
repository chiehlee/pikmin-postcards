import { mkdir } from "node:fs/promises";
import path from "node:path";
import { backupDatabase, defaultDatabasePath, openDatabase, projectRoot } from "../db/database.mjs";
import { exportSnapshots, writeSnapshots } from "../db/snapshots.mjs";

const databasePath = argument("--database")
  ? path.resolve(argument("--database"))
  : defaultDatabasePath;
const outputDirectory = argument("--output-dir")
  ? path.resolve(argument("--output-dir"))
  : path.join(projectRoot, "data");

const backupPath = outputDirectory === path.join(projectRoot, "data")
  ? await backupDatabase(databasePath)
  : null;

await mkdir(outputDirectory, { recursive: true });
const database = await openDatabase(databasePath);
try {
  const snapshots = exportSnapshots(database);
  await writeSnapshots(snapshots, outputDirectory);
  console.log(JSON.stringify({
    output: outputDirectory,
    archive_backup_database: backupPath,
  }, null, 2));
} finally {
  database.close();
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
