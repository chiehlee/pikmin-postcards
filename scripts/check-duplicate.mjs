import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDuplicate } from "../lib/dedupe.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

if (!["--image", "--poi", "--found-date"].some((key) => args.has(key))) {
  console.error(
    "Usage: node scripts/check-duplicate.mjs [--image path] --poi name --found-date YYYY-MM-DD [--sender name]",
  );
  process.exit(1);
}

const archive = JSON.parse(
  await readFile(path.join(root, "data/postcards.json"), "utf8"),
);
const imagePath = args.get("--image");
const imageHash = imagePath
  ? createHash("sha256").update(await readFile(path.resolve(imagePath))).digest("hex")
  : null;

const result = findDuplicate(
  {
    poi_name: args.get("--poi"),
    found_date: args.get("--found-date"),
    sender: args.get("--sender") ?? null,
    sha256: imageHash,
  },
  archive.postcards,
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
