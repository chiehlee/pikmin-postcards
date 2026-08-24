import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { publicPathToLocalPath, resolveStoredLocalPath } from "../db/asset-paths.mjs";
import { projectRoot } from "../db/database.mjs";

const run = promisify(execFile);
const generationVersion = 1;
const acceptedConfidences = new Set(["high", "medium"]);

export function normalizeAvatarCropHint(input) {
  if (!input || typeof input !== "object") return null;
  const centerX = input.center_x;
  const centerY = input.center_y;
  const size = input.size;
  const confidence = input.confidence;
  if (![centerX, centerY, size].every(Number.isFinite) || !acceptedConfidences.has(confidence)) return null;
  if (size < 0.02 || size > 0.4) return null;
  const radius = size / 2;
  if (centerX < radius || centerX > 1 - radius || centerY < radius || centerY > 1 - radius) return null;
  return { center_x: centerX, center_y: centerY, size, confidence };
}

export async function ensureFriendAvatars(snapshots, {
  affectedNames,
  command = process.env.PIKMIN_MAGICK_COMMAND?.trim() || "magick",
  outputDirectory = path.join(projectRoot, "public/images/friends"),
  resolveSourcePath = defaultSourcePath,
  identify = imageDimensions,
  render = renderAvatar,
} = {}) {
  const names = new Set((affectedNames ?? []).filter(Boolean));
  const postcardsById = new Map(snapshots.postcards.postcards.map((postcard) => [postcard.id, postcard]));
  const report = [];

  for (const profile of snapshots.friends.profiles) {
    if (names.size && !names.has(profile.name)) continue;
    const candidates = [];
    const candidateFailures = [];
    for (const postcardId of profile.evidence_postcard_ids) {
      const postcard = postcardsById.get(postcardId);
      const hint = normalizeAvatarCropHint(postcard?.visual?.sender_avatar_crop);
      if (
        !postcard
        || postcard.sender !== profile.name
        || postcard.acquisition?.sender_status !== "confirmed"
        || !hint
      ) continue;
      try {
        const sourcePath = resolveSourcePath(postcard);
        const dimensions = await identify(sourcePath, { command });
        const crop = cropPixels(dimensions, hint);
        candidates.push({ postcard, hint, sourcePath, dimensions, crop });
      } catch (error) {
        candidateFailures.push({ postcard_id: postcard.id, error: conciseError(error) });
      }
    }

    candidates.sort((left, right) => (
      confidenceRank(right.hint.confidence) - confidenceRank(left.hint.confidence)
      || cropArea(right.crop) - cropArea(left.crop)
      || right.dimensions.width * right.dimensions.height - left.dimensions.width * left.dimensions.height
      || left.postcard.id.localeCompare(right.postcard.id)
    ));
    const candidate = candidates[0];
    if (!candidate) {
      if (candidateFailures.length) {
        profile.avatar_generation = {
          version: generationVersion,
          status: profile.avatar ? "failed-preserved-existing" : "failed",
          source_postcard_id: candidateFailures[0].postcard_id,
          reason: candidateFailures[0].error,
        };
      } else if (!profile.avatar) {
        profile.avatar_generation = {
          version: generationVersion,
          status: "awaiting-crop-evidence",
          reason: "尚無已確認寄件人且通過信心與邊界驗證的 Mii crop。",
        };
      }
      report.push({
        friend: profile.name,
        status: profile.avatar_generation?.status ?? "preserved",
        ...(candidateFailures[0] ?? {}),
      });
      continue;
    }

    if (!shouldReplaceAvatar(profile.avatar, candidate)) {
      profile.avatar_generation = {
        version: generationVersion,
        status: "preserved-better-or-equal",
        candidate_source_postcard_id: candidate.postcard.id,
      };
      report.push({ friend: profile.name, status: "preserved-better-or-equal", postcard_id: candidate.postcard.id });
      continue;
    }

    const cropFingerprint = JSON.stringify(candidate.crop);
    const filename = [
      sha256(profile.name).slice(0, 12),
      candidate.postcard.asset.sha256.slice(0, 8),
      sha256(cropFingerprint).slice(0, 8),
    ].join("-") + ".webp";
    const outputPath = path.join(outputDirectory, filename);
    const temporaryPath = path.join(outputDirectory, `.${filename}.${randomUUID()}.tmp.webp`);
    try {
      await mkdir(outputDirectory, { recursive: true });
      await render({
        command,
        sourcePath: candidate.sourcePath,
        outputPath: temporaryPath,
        crop: candidate.crop,
      });
      const bytes = await readFile(temporaryPath);
      const outputDimensions = await identify(temporaryPath, { command });
      await rename(temporaryPath, outputPath);
      profile.avatar = {
        kind: "mii_crop",
        path: `/images/friends/${filename}`,
        sha256: sha256(bytes),
        width: outputDimensions.width,
        height: outputDimensions.height,
        source_postcard_id: candidate.postcard.id,
        source_asset_sha256: candidate.postcard.asset.sha256,
        source_width: candidate.dimensions.width,
        source_height: candidate.dimensions.height,
        crop: {
          x: candidate.crop.x,
          y: candidate.crop.y,
          width: candidate.crop.size,
          height: candidate.crop.size,
        },
        crop_confidence: candidate.hint.confidence,
      };
      profile.avatar_generation = {
        version: generationVersion,
        status: "generated",
        source_postcard_id: candidate.postcard.id,
      };
      report.push({ friend: profile.name, status: "generated", postcard_id: candidate.postcard.id, path: profile.avatar.path });
    } catch (error) {
      await rm(temporaryPath, { force: true });
      profile.avatar_generation = {
        version: generationVersion,
        status: profile.avatar ? "failed-preserved-existing" : "failed",
        source_postcard_id: candidate.postcard.id,
        reason: conciseError(error),
      };
      report.push({
        friend: profile.name,
        status: profile.avatar_generation.status,
        postcard_id: candidate.postcard.id,
        error: conciseError(error),
      });
    }
  }

  return report;
}

function defaultSourcePath(postcard) {
  return resolveStoredLocalPath(publicPathToLocalPath(postcard.asset.path));
}

function cropPixels({ width, height }, hint) {
  const size = Math.min(Math.max(1, Math.round(width * hint.size)), width, height);
  return {
    x: clamp(Math.round(width * hint.center_x - size / 2), 0, width - size),
    y: clamp(Math.round(height * hint.center_y - size / 2), 0, height - size),
    size,
  };
}

function shouldReplaceAvatar(avatar, candidate) {
  if (!avatar) return true;
  if (
    avatar.source_asset_sha256 === candidate.postcard.asset.sha256
    && avatar.crop?.x === candidate.crop.x
    && avatar.crop?.y === candidate.crop.y
    && avatar.crop?.width === candidate.crop.size
  ) return false;
  const currentArea = Number(avatar.crop?.width ?? 0) * Number(avatar.crop?.height ?? 0);
  return cropArea(candidate.crop) > currentArea * 1.1;
}

async function imageDimensions(imagePath, { command }) {
  const { stdout } = await run(command, ["identify", "-format", "%w %h", imagePath]);
  const [width, height] = stdout.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("無法讀取 avatar 來源圖片尺寸");
  }
  return { width, height };
}

async function renderAvatar({ command, sourcePath, outputPath, crop }) {
  await run(command, [
    sourcePath,
    "-crop", `${crop.size}x${crop.size}+${crop.x}+${crop.y}`,
    "+repage",
    "-resize", "128x128>",
    "-strip",
    "-define", "webp:lossless=true",
    outputPath,
  ]);
}

function cropArea(crop) {
  return crop.size * crop.size;
}

function confidenceRank(value) {
  return value === "high" ? 2 : value === "medium" ? 1 : 0;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function conciseError(error) {
  const value = error instanceof Error ? error.message : String(error);
  return value.replaceAll(projectRoot, "[project]").slice(0, 240);
}
