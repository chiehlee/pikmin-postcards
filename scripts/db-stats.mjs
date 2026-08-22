import path from "node:path";
import { defaultDatabasePath, openDatabase } from "../db/database.mjs";

const databasePath = argument("--database")
  ? path.resolve(argument("--database"))
  : defaultDatabasePath;
const database = await openDatabase(databasePath);

try {
  const scalar = (table) => database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count;
  const stats = {
    postcards: scalar("postcards"),
    assets: scalar("assets"),
    friends: scalar("friends"),
    imports: scalar("imports"),
    context_records: scalar("context_records"),
    provenance_occurrences: scalar("postcard_provenance"),
    directed_relations: scalar("postcard_relations"),
    research_sources: scalar("research_sources"),
    by_curation_status: database
      .prepare("SELECT curation_status AS status, count(*) AS count FROM postcards GROUP BY curation_status ORDER BY count DESC")
      .all(),
    by_research_status: database
      .prepare("SELECT research_status AS status, count(*) AS count FROM postcards GROUP BY research_status ORDER BY count DESC")
      .all(),
  };
  console.log(JSON.stringify(stats, null, 2));
} finally {
  database.close();
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
