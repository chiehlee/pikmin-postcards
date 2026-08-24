import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const postcardsPath = path.join(projectRoot, "data/postcards.json");
const friendsPath = path.join(projectRoot, "data/friends.json");
const outputDirectory = path.join(projectRoot, "public/images/friends");
const shouldCommit = process.argv.includes("--commit");

// These screenshots were captured with the postcard sheet scrolled lower than usual.
const shiftedPostcardIds = new Set(["pc-0082", "pc-0084", "pc-0137", "pc-0150"]);
const defaultCrop = { centerX: 0.69, centerY: 0.373, size: 0.13 };
const shiftedCrop = { ...defaultCrop, centerY: 0.675 };
const cropOverrides = new Map([
  ["pc-0150", { ...shiftedCrop, centerX: 0.675 }],
]);

const postcardArchive = JSON.parse(await readFile(postcardsPath, "utf8"));
const friendArchive = JSON.parse(await readFile(friendsPath, "utf8"));
const postcardsById = new Map(postcardArchive.postcards.map((postcard) => [postcard.id, postcard]));

if (shouldCommit) await mkdir(outputDirectory, { recursive: true });

const report = [];
for (const profile of friendArchive.profiles) {
  const candidates = await Promise.all(profile.evidence_postcard_ids.map(async (postcardId) => {
    const postcard = postcardsById.get(postcardId);
    if (!postcard) throw new Error(`${profile.name} references missing postcard ${postcardId}`);
    if (postcard.sender !== profile.name || postcard.acquisition?.sender_status !== "confirmed") {
      throw new Error(`${profile.name} avatar evidence ${postcardId} is not a confirmed received postcard`);
    }
    const sourcePath = path.join(projectRoot, "public", postcard.asset.path);
    const { width, height } = await imageDimensions(sourcePath);
    return { postcard, sourcePath, width, height };
  }));
  candidates.sort((left, right) =>
    right.width * right.height - left.width * left.height
    || right.width - left.width
    || left.postcard.id.localeCompare(right.postcard.id),
  );

  const source = candidates[0];
  const cropRatio = cropOverrides.get(source.postcard.id)
    ?? (shiftedPostcardIds.has(source.postcard.id) ? shiftedCrop : defaultCrop);
  const size = Math.round(source.width * cropRatio.size);
  const x = clamp(Math.round(source.width * cropRatio.centerX - size / 2), 0, source.width - size);
  const y = clamp(Math.round(source.height * cropRatio.centerY - size / 2), 0, source.height - size);
  const filename = `${createHash("sha256").update(profile.name).digest("hex").slice(0, 12)}.webp`;
  const outputPath = path.join(outputDirectory, filename);

  const result = {
    friend: profile.name,
    source_postcard_id: source.postcard.id,
    source_dimensions: `${source.width}x${source.height}`,
    crop: { x, y, size },
    path: `/images/friends/${filename}`,
  };

  if (shouldCommit) {
    await run("magick", [
      source.sourcePath,
      "-crop", `${size}x${size}+${x}+${y}`,
      "+repage",
      "-resize", "128x128>",
      "-strip",
      "-define", "webp:lossless=true",
      outputPath,
    ]);
    const bytes = await readFile(outputPath);
    const dimensions = await imageDimensions(outputPath);
    profile.avatar = {
      kind: "mii_crop",
      path: result.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: dimensions.width,
      height: dimensions.height,
      source_postcard_id: source.postcard.id,
      source_asset_sha256: source.postcard.asset.sha256,
      source_width: source.width,
      source_height: source.height,
      crop: { x, y, width: size, height: size },
    };
    profile.avatar_generation = {
      version: 1,
      status: "repair-backfill",
      source_postcard_id: source.postcard.id,
    };
  }
  report.push(result);
}

if (shouldCommit) {
  const temporaryPath = `${friendsPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(friendArchive, null, 2)}\n`);
  await rename(temporaryPath, friendsPath);
}

console.log(JSON.stringify({ committed: shouldCommit, avatars: report }, null, 2));

async function imageDimensions(imagePath) {
  const { stdout } = await run("magick", ["identify", "-format", "%w %h", imagePath]);
  const [width, height] = stdout.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`Unable to read image dimensions: ${imagePath}`);
  }
  return { width, height };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
