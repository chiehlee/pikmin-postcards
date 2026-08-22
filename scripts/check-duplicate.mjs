import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { acquisitionFromEvidence } from "../lib/acquisition.mjs";
import { findDuplicate } from "../lib/dedupe.mjs";
import { openDatabase } from "../db/database.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

if (!["--image", "--poi", "--found-date"].some((key) => args.has(key))) {
  console.error(
    "Usage: node scripts/check-duplicate.mjs [--image path] --poi name --found-date YYYY-MM-DD [--sender name] [--origin self_found|received|unknown]",
  );
  process.exit(1);
}

const database = await openDatabase();
const existingRecords = database
  .prepare("SELECT document_json FROM postcards ORDER BY sort_order")
  .all()
  .map((row) => JSON.parse(row.document_json));
database.close();
const imagePath = args.get("--image");
const imageHash = imagePath
  ? createHash("sha256").update(await readFile(path.resolve(imagePath))).digest("hex")
  : null;
const sender = args.get("--sender") ?? null;
const origin = args.get("--origin") ?? (sender ? "received" : "unknown");
if (!["self_found", "received", "unknown"].includes(origin)) {
  throw new Error("--origin must be self_found, received, or unknown");
}
const acquisition = origin === "self_found"
  ? acquisitionFromEvidence({ sendToFriendButtonVisible: true })
  : origin === "received"
    ? acquisitionFromEvidence({ sender, sendToFriendButtonVisible: false })
    : acquisitionFromEvidence();

const result = findDuplicate(
  {
    poi_name: args.get("--poi"),
    found_date: args.get("--found-date"),
    sender,
    acquisition,
    sha256: imageHash,
  },
  existingRecords,
);

console.log(
  JSON.stringify(
    {
      duplicate: result.duplicate,
      match_type: result.match_type,
      confidence: result.confidence,
      matched_id: result.record?.id ?? null,
      matched_poi_name: result.record?.poi_name ?? null,
    },
    null,
    2,
  ),
);
