import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ensureFriendAvatars, normalizeAvatarCropHint } from "../server/friend-avatars.mjs";

const run = promisify(execFile);

test("backend creates a traceable Mii crop and keeps an equal existing derivative", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pikmin-friend-avatar-"));
  const sourceDirectory = path.join(temporaryDirectory, "sources");
  const outputDirectory = path.join(temporaryDirectory, "friends");
  const smallSource = path.join(sourceDirectory, "small.png");
  const largeSource = path.join(sourceDirectory, "large.png");
  await mkdir(sourceDirectory, { recursive: true });
  await run("magick", ["-size", "100x200", "gradient:red-blue", smallSource]);
  await run("magick", ["-size", "240x480", "gradient:green-yellow", largeSource]);

  const snapshots = {
    postcards: {
      postcards: [
        postcard("pc-small", "Player", "small-sha", smallSource),
      ],
    },
    friends: { profiles: [profile("Player", ["pc-small"])] },
  };

  try {
    const first = await ensureFriendAvatars(snapshots, {
      affectedNames: ["Player"],
      outputDirectory,
      resolveSourcePath: (record) => record.test_source_path,
    });
    assert.equal(first.at(-1).status, "generated");
    const smallAvatar = structuredClone(snapshots.friends.profiles[0].avatar);
    assert.equal(smallAvatar.source_postcard_id, "pc-small");
    assert.deepEqual(smallAvatar.crop, { x: 65, y: 75, width: 10, height: 10 });

    snapshots.postcards.postcards.push(postcard("pc-large", "Player", "large-sha", largeSource));
    snapshots.friends.profiles[0].evidence_postcard_ids.push("pc-large");
    const upgraded = await ensureFriendAvatars(snapshots, {
      affectedNames: ["Player"],
      outputDirectory,
      resolveSourcePath: (record) => record.test_source_path,
    });
    assert.equal(upgraded.at(-1).status, "generated");
    const avatar = structuredClone(snapshots.friends.profiles[0].avatar);
    assert.equal(avatar.source_postcard_id, "pc-large");
    assert.equal(avatar.source_asset_sha256, "large-sha");
    assert.equal(avatar.crop_confidence, "high");
    assert.deepEqual(avatar.crop, { x: 156, y: 180, width: 24, height: 24 });
    assert.ok((await readFile(path.join(outputDirectory, path.basename(avatar.path)))).length > 0);
    assert.equal(snapshots.friends.profiles[0].avatar_generation.status, "generated");

    const second = await ensureFriendAvatars(snapshots, {
      affectedNames: ["Player"],
      outputDirectory,
      resolveSourcePath: (record) => record.test_source_path,
    });
    assert.equal(second.at(-1).status, "preserved-better-or-equal");
    assert.deepEqual(snapshots.friends.profiles[0].avatar, avatar);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("backend records missing crop evidence without blocking postcard persistence", async () => {
  const snapshots = {
    postcards: { postcards: [{ ...postcard("pc-1", "Player", "sha", "/unused"), visual: {} }] },
    friends: { profiles: [profile("Player", ["pc-1"])] },
  };
  const report = await ensureFriendAvatars(snapshots, { affectedNames: ["Player"] });
  assert.equal(report.at(-1).status, "awaiting-crop-evidence");
  assert.equal(snapshots.friends.profiles[0].avatar, undefined);
  assert.equal(snapshots.friends.profiles[0].avatar_generation.status, "awaiting-crop-evidence");
});

test("backend records processor failures and leaves canonical friend evidence intact", async () => {
  const snapshots = {
    postcards: { postcards: [postcard("pc-1", "Player", "sha", "/unused")] },
    friends: { profiles: [profile("Player", ["pc-1"])] },
  };
  const report = await ensureFriendAvatars(snapshots, {
    affectedNames: ["Player"],
    identify: async () => { throw new Error("ImageMagick unavailable"); },
  });
  assert.equal(report.at(-1).status, "failed");
  assert.equal(snapshots.friends.profiles[0].avatar_generation.status, "failed");
  assert.deepEqual(snapshots.friends.profiles[0].evidence_postcard_ids, ["pc-1"]);
});

test("a failed quality upgrade preserves the existing avatar and reports that state", async () => {
  const existingAvatar = {
    path: "/images/friends/existing.webp",
    crop: { x: 1, y: 1, width: 2, height: 2 },
  };
  const snapshots = {
    postcards: { postcards: [postcard("pc-1", "Player", "sha", "/unused")] },
    friends: { profiles: [{ ...profile("Player", ["pc-1"]), avatar: existingAvatar }] },
  };
  const report = await ensureFriendAvatars(snapshots, {
    affectedNames: ["Player"],
    outputDirectory: "/unused",
    identify: async () => ({ width: 100, height: 200 }),
    render: async () => { throw new Error("processor stopped"); },
  });
  assert.equal(report.at(-1).status, "failed-preserved-existing");
  assert.equal(snapshots.friends.profiles[0].avatar, existingAvatar);
  assert.equal(snapshots.friends.profiles[0].avatar_generation.status, "failed-preserved-existing");
});

test("avatar crop hints reject low-confidence, partial, and out-of-bounds model output", () => {
  assert.deepEqual(normalizeAvatarCropHint({ center_x: 0.7, center_y: 0.4, size: 0.1, confidence: "high" }), {
    center_x: 0.7,
    center_y: 0.4,
    size: 0.1,
    confidence: "high",
  });
  assert.equal(normalizeAvatarCropHint({ center_x: 0.7, center_y: 0.4, size: 0.1, confidence: "low" }), null);
  assert.equal(normalizeAvatarCropHint({ center_x: null, center_y: null, size: null, confidence: "low" }), null);
  assert.equal(normalizeAvatarCropHint({ center_x: 0.01, center_y: 0.4, size: 0.1, confidence: "high" }), null);
});

function postcard(id, sender, sha256, sourcePath) {
  return {
    id,
    sender,
    acquisition: { sender_status: "confirmed" },
    asset: { path: `/images/postcards/${id}.png`, sha256 },
    visual: {
      sender_avatar_crop: { center_x: 0.7, center_y: 0.4, size: 0.1, confidence: "high" },
    },
    test_source_path: sourcePath,
  };
}

function profile(name, evidenceIds) {
  return {
    name,
    evidence_postcard_ids: evidenceIds,
    likely_base: { area: null, status: "insufficient-evidence", confidence: "low", confidence_label: "低", reason: "test" },
    frequent_areas: [],
    trip_clusters: [],
    avoid_send: { areas: [], reason: "test" },
  };
}
