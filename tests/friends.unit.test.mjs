import assert from "node:assert/strict";
import test from "node:test";
import { rebuildFriends } from "../lib/friends.mjs";

test("a changed visible sender ID remains a separate provisional friend", () => {
  const archive = rebuildFriends([
    postcard("pc-a", "Player"),
    postcard("pc-b", "Player2"),
  ], { profiles: [] });

  assert.deepEqual(archive.profiles.map((profile) => profile.name).sort(), ["Player", "Player2"]);
});

test("friend rebuild preserves a traceable avatar when evidence grows", () => {
  const avatar = {
    kind: "mii_crop",
    path: "/images/friends/example.webp",
    sha256: "avatar-sha",
    source_postcard_id: "pc-a",
    source_asset_sha256: "source-sha",
  };
  const archive = rebuildFriends([
    postcard("pc-a", "Player"),
    postcard("pc-b", "Player"),
  ], {
    profiles: [{
      name: "Player",
      evidence_postcard_ids: ["pc-a"],
      avatar,
    }],
  });

  assert.deepEqual(archive.profiles[0].avatar, avatar);
});

function postcard(id, sender) {
  return { id, sender, found_date: "2026-08-23" };
}
