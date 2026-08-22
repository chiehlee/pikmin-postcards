import path from "node:path";
import { backupDatabase, defaultDatabasePath, openDatabase, projectRoot } from "../db/database.mjs";
import { loadSnapshots, replaceDatabaseFromSnapshots } from "../db/snapshots.mjs";

const databasePath = argument("--database")
  ? path.resolve(argument("--database"))
  : defaultDatabasePath;

const backupPath = await backupDatabase(databasePath);
const snapshots = await loadSnapshots();
const database = await openDatabase(databasePath);

try {
  replaceDatabaseFromSnapshots(database, snapshots);
  const stats = {
    database: path.relative(projectRoot, databasePath),
    backup: backupPath ? path.relative(projectRoot, backupPath) : null,
    postcards: database.prepare("SELECT count(*) AS count FROM postcards").get().count,
    assets: database.prepare("SELECT count(*) AS count FROM assets").get().count,
    friends: database.prepare("SELECT count(*) AS count FROM friends").get().count,
    imports: database.prepare("SELECT count(*) AS count FROM imports").get().count,
    context_records: database.prepare("SELECT count(*) AS count FROM context_records").get().count,
    image_intake: database.prepare("SELECT count(*) AS count FROM image_intake").get().count,
  };
  console.log(JSON.stringify(stats, null, 2));
} finally {
  database.close();
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
