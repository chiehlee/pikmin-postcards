import { DatabaseSync } from "node:sqlite";
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const defaultDatabasePath = path.join(projectRoot, "var/pikmin-postcards.sqlite3");

export async function backupDatabase(databasePath = defaultDatabasePath) {
  try {
    const details = await stat(databasePath);
    if (!details.isFile() || details.size === 0) return null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  const checkpoint = new DatabaseSync(databasePath);
  checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  checkpoint.close();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.resolve(databasePath) === path.resolve(defaultDatabasePath)
    ? path.join(projectRoot, "var/backups")
    : path.join(path.dirname(databasePath), "backups");
  const destination = path.join(backupDir, `pikmin-postcards-${stamp}.sqlite3`);
  await mkdir(backupDir, { recursive: true });
  await copyFile(databasePath, destination);
  return destination;
}

export async function openDatabase(databasePath = defaultDatabasePath) {
  await mkdir(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA busy_timeout = 5000");
  await migrate(database);
  return database;
}

export async function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT
  `);

  const migrationDir = path.join(projectRoot, "db/migrations");
  const files = (await readdir(migrationDir))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  const applied = new Set(
    database.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version),
  );

  for (const fileName of files) {
    const version = Number.parseInt(fileName.split("_", 1)[0], 10);
    if (applied.has(version)) continue;
    const sql = await readFile(path.join(migrationDir, fileName), "utf8");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      database
        .prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)")
        .run(version, fileName);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
