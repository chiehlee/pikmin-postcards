import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { researchedLocationDisplay, validateLocationNaming } from "../lib/location-names.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const postcards = JSON.parse(await readFile(path.join(root, "data/postcards.json"), "utf8")).postcards;
const contexts = JSON.parse(await readFile(path.join(root, "data/context.json"), "utf8")).records;
const friends = JSON.parse(await readFile(path.join(root, "data/friends.json"), "utf8")).profiles;

test("canonical postcard ids, hashes and asset paths are unique", () => {
  assert.equal(new Set(postcards.map((record) => record.id)).size, postcards.length);
  assert.equal(new Set(postcards.map((record) => record.asset.sha256)).size, postcards.length);
  assert.equal(new Set(postcards.map((record) => record.asset.path)).size, postcards.length);
});

test("researched locations preserve the game text and compose local names consistently", () => {
  for (const postcard of postcards) {
    assert.ok(postcard.location.raw.trim(), `${postcard.id} lost its game-displayed location`);
    assert.deepEqual(validateLocationNaming(postcard.location), [], postcard.id);
    assert.equal(postcard.location.display, researchedLocationDisplay(postcard.location), postcard.id);
  }

  const nasu = postcards.find((record) => record.id === "pc-0089");
  assert.equal(nasu.location.raw, "Nasu, Yumoto");
  assert.equal(nasu.location.endonym, "栃木県那須町湯本");
  assert.equal(nasu.location.zh_tw, null);
  assert.equal(nasu.location.display, "栃木県那須町湯本");

  const seoul = postcards.find((record) => record.id === "pc-0084");
  assert.equal(seoul.location.endonym, "서울특별시");
  assert.equal(seoul.location.zh_tw, "首爾特別市");
  assert.equal(seoul.location.display, "서울특별시（首爾特別市）");

  const laramie = postcards.find((record) => record.id === "pc-0030");
  assert.equal(laramie.location.display, "Laramie, Wyoming（懷俄明州拉勒米）");
});

test("all canonical assets exist and match their recorded SHA-256", async () => {
  for (const record of [...postcards, ...contexts]) {
    const bytes = await readFile(path.join(root, "public", record.asset.path));
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, record.asset.sha256, `${record.id} checksum mismatch`);
  }
});

test("related postcard references are valid and symmetric", () => {
  const byId = new Map(postcards.map((record) => [record.id, record]));
  for (const record of postcards) {
    for (const relation of record.related_postcards ?? []) {
      const target = byId.get(relation.id);
      assert.ok(target, `${record.id} references missing ${relation.id}`);
      assert.ok(
        target.related_postcards?.some(
          (reverse) => (
            reverse.id === record.id
            && reverse.relationship === relation.relationship
            && (reverse.note ?? null) === (relation.note ?? null)
          ),
        ),
        `${record.id} -> ${relation.id} is not symmetric`,
      );
    }
  }
});

test("distinct imported screenshots remain independent even when postcard metadata repeats", () => {
  const ironDonQuixotes = postcards.filter((record) => record.poi_name === "鉄のドンキホーテ");
  assert.deepEqual(ironDonQuixotes.map((record) => record.id), ["pc-0111", "pc-0112"]);
  assert.equal(new Set(ironDonQuixotes.map((record) => record.asset.sha256)).size, 2);
  assert.equal(new Set(ironDonQuixotes.map((record) => record.location.raw)).size, 1);
  assert.ok(ironDonQuixotes.every((record) => (
    record.related_postcards.some((relation) => (
      ironDonQuixotes.some((other) => other.id === relation.id && other.id !== record.id)
      && relation.relationship === "same-metadata-different-image"
    ))
  )));
});

test("friend evidence covers every confirmed sender and references real postcards", () => {
  const postcardsById = new Map(postcards.map((record) => [record.id, record]));
  const postcardIds = new Set(postcards.map((record) => record.id));
  const confirmedSenders = new Set(postcards.map((record) => record.sender).filter(Boolean));
  assert.deepEqual(new Set(friends.map((profile) => profile.name)), confirmedSenders);
  for (const profile of friends) {
    for (const id of profile.evidence_postcard_ids) {
      assert.ok(postcardIds.has(id), `${profile.name} references missing ${id}`);
      assert.equal(postcardsById.get(id).sender, profile.name);
    }
    const source = postcardsById.get(profile.avatar.source_postcard_id);
    assert.ok(profile.evidence_postcard_ids.includes(source.id), `${profile.name} avatar source is not evidence`);
    assert.equal(profile.avatar.source_asset_sha256, source.asset.sha256);
  }
});

test("friend Mii crops are local, traceable derivatives of canonical screenshots", async () => {
  for (const profile of friends) {
    assert.equal(profile.avatar.kind, "mii_crop");
    const bytes = await readFile(path.join(root, "public", profile.avatar.path));
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, profile.avatar.sha256, `${profile.name} avatar checksum mismatch`);
    assert.ok(profile.avatar.width > 0 && profile.avatar.height > 0);
  }
});

test("sender absence is separated from self-found and truly unknown senders", () => {
  assert.equal(postcards.filter((record) => record.acquisition.type === "self_found").length, 68);
  assert.equal(postcards.filter((record) => record.acquisition.type === "received").length, 80);
  assert.equal(postcards.filter((record) => record.acquisition.type === "unknown").length, 0);
  assert.equal(postcards.filter((record) => record.acquisition.sender_status === "confirmed").length, 77);
  assert.equal(postcards.filter((record) => record.acquisition.sender_status === "not_applicable").length, 68);
  assert.deepEqual(
    postcards
      .filter((record) => record.acquisition.sender_status === "unknown")
      .map((record) => record.id)
      .sort(),
    ["pc-0045", "pc-0056", "pc-0083"],
  );
  assert.equal(postcards.find((record) => record.id === "pc-0020").acquisition.type, "self_found");
  assert.equal(postcards.find((record) => record.id === "pc-0126").sender, "柳柳");
});

test("merged archive has the expected preservation totals", () => {
  assert.equal(postcards.length, 148);
  assert.equal(contexts.length, 1);
  assert.equal(friends.length, 29);
  assert.equal(postcards.filter((record) => record.provenance.length > 1).length, 2);
});

test("research detail preserves available material and records gap re-research separately", async () => {
  const byStatus = Object.fromEntries(
    ["raw_preserved", "structured_preserved", "not_recovered"].map((status) => [
      status,
      postcards.filter((record) => record.research.detail.status === status).length,
    ]),
  );
  assert.deepEqual(byStatus, {
    raw_preserved: 20,
    structured_preserved: 128,
    not_recovered: 0,
  });

  for (const record of postcards) {
    const detail = record.research.detail;
    await readFile(path.join(root, detail.source_path), "utf8");
    if (detail.status === "not_recovered") {
      assert.equal(detail.body, null, `${record.id} must not invent missing research`);
      assert.ok(detail.preservation_note, `${record.id} must explain the preservation gap`);
    } else {
      assert.ok(detail.body?.trim(), `${record.id} is missing preserved research detail`);
      assert.equal(detail.preservation_note, null);
    }
  }

  assert.equal(postcards.find((record) => record.id === "pc-0020").research.detail.status, "raw_preserved");
  assert.equal(postcards.find((record) => record.id === "pc-0130").research.detail.status, "structured_preserved");
  assert.equal(postcards.find((record) => record.id === "pc-0021").research.status, "re-researched_after_compaction_gap_2026-08-23");
});
