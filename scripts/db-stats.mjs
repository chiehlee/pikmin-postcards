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
    image_intake: scalar("image_intake"),
    image_intake_sources: scalar("image_intake_sources"),
    image_intake_by_status: database
      .prepare("SELECT status, count(*) AS count FROM image_intake GROUP BY status ORDER BY status")
      .all(),
    by_acquisition_type: database
      .prepare("SELECT acquisition_type AS type, count(*) AS count FROM postcards GROUP BY acquisition_type ORDER BY type")
      .all(),
    by_sender_status: database
      .prepare("SELECT sender_status AS status, count(*) AS count FROM postcards GROUP BY sender_status ORDER BY status")
      .all(),
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
