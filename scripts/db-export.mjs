import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { defaultDatabasePath, openDatabase, projectRoot } from "../db/database.mjs";
import { exportSnapshots, writeSnapshots } from "../db/snapshots.mjs";

const databasePath = argument("--database")
  ? path.resolve(argument("--database"))
  : defaultDatabasePath;
const outputDirectory = argument("--output-dir")
  ? path.resolve(argument("--output-dir"))
  : path.join(projectRoot, "data");

if (outputDirectory === path.join(projectRoot, "data")) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(projectRoot, "var/backups", `snapshots-${stamp}`);
  await mkdir(backupDir, { recursive: true });
  for (const file of ["postcards.json", "friends.json", "imports.json", "context.json"]) {
    await copyFile(path.join(projectRoot, "data", file), path.join(backupDir, file));
  }
}

await mkdir(outputDirectory, { recursive: true });
const database = await openDatabase(databasePath);
try {
  const snapshots = exportSnapshots(database);
  await writeSnapshots(snapshots, outputDirectory);
  console.log(`Exported SQLite snapshots to ${outputDirectory}`);
} finally {
  database.close();
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
