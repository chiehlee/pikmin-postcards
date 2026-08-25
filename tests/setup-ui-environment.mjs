import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const runtime = path.join(root, "test-results/ui-runtime");
const snapshots = path.join(runtime, "data");

await rm(runtime, { recursive: true, force: true });
await mkdir(snapshots, { recursive: true });
for (const name of ["postcards.json", "friends.json", "imports.json", "context.json"]) {
  await copyFile(path.join(root, "templates/fresh-data", name), path.join(snapshots, name));
}
