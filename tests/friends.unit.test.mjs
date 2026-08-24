import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeFriendProfile,
  friendEvidenceFingerprint,
  friendEvidenceForPostcard,
  rebuildFriends,
} from "../lib/friends.mjs";

test("a changed visible sender ID remains a separate provisional friend", () => {
  const archive = rebuildFriends([
    postcard("pc-a", "Player", "2026-08-01"),
    postcard("pc-b", "Player2", "2026-08-02"),
    { ...postcard("pc-c", "Unconfirmed", "2026-08-03"), acquisition: { sender_status: "unknown" } },
  ], { profiles: [] });

  assert.deepEqual(archive.profiles.map((profile) => profile.name).sort(), ["Player", "Player2"]);
  assert.equal(archive.schema_version, 1);
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
    postcard("pc-a", "Player", "2026-08-01"),
    postcard("pc-b", "Player", "2026-08-02"),
  ], {
    schema_version: 2,
    profiles: [{
      name: "Player",
      evidence_postcard_ids: ["pc-a"],
      avatar,
    }],
  });

  assert.deepEqual(archive.profiles[0].avatar, avatar);
  assert.equal(archive.schema_version, 2);
});

test("multiple postcards on one day remain one observation and never establish a base", () => {
  const cards = [1, 2, 3, 4].map((number) => postcard(
    `pc-${number}`,
    "Day trip",
    "2026-08-01",
    taiwanLocation("臺北市", "北投區", `臺北市北投區第${number}里`),
  ));
  const profile = analyzeFriendProfile("Day trip", cards);

  assert.equal(profile.likely_base.area, null);
  assert.equal(profile.likely_base.status, "insufficient-evidence");
  assert.equal(profile.base_analysis.dated_observation_count, 1);
});

test("three independent dates across weeks establish only a conservative district signal", () => {
  const cards = [
    postcard("pc-1", "Local", "2026-01-01", taiwanLocation("台北市", "北投區", "臺北市北投區文化里")),
    postcard("pc-2", "Local", "2026-01-20", taiwanLocation("臺北市", "北投區", "臺北市北投區開明里")),
    postcard("pc-3", "Local", "2026-02-05", taiwanLocation("臺北市", "北投區", "臺北市北投區中央里")),
  ];
  const profile = analyzeFriendProfile("Local", cards);

  assert.equal(profile.likely_base.area, "臺北市北投區");
  assert.equal(profile.likely_base.status, "early-signal");
  assert.equal(profile.likely_base.confidence, "medium");
  assert.equal(profile.base_analysis.origin, "automatic");
  assert.deepEqual(profile.frequent_areas, [{ area: "臺北市北投區", date_count: 3, share: 1 }]);
});

test("three nearby dates are recorded as a possible trip cluster rather than a base", () => {
  const cards = [
    postcard("pc-1", "Traveler", "2026-03-01", japanLocation("東京都新宿区百人町二丁目")),
    postcard("pc-2", "Traveler", "2026-03-03", japanLocation("東京都新宿区西新宿")),
    postcard("pc-3", "Traveler", "2026-03-05", japanLocation("東京都新宿区歌舞伎町")),
  ];
  const profile = analyzeFriendProfile("Traveler", cards);

  assert.equal(profile.likely_base.area, null);
  assert.deepEqual(profile.trip_clusters, [{
    area: "東京都新宿区",
    date_count: 3,
    first_date: "2026-03-01",
    last_date: "2026-03-05",
    status: "possible-trip-cluster",
  }]);
});

test("a broad city signal can emerge from recurring districts but not from a tied city", () => {
  const cards = [
    postcard("pc-1", "Metro", "2026-01-01", taiwanLocation("高雄市", "內門區", "高雄市內門區內南里")),
    postcard("pc-2", "Metro", "2026-02-01", taiwanLocation("高雄市", "阿蓮區", "高雄市阿蓮區阿蓮里")),
    postcard("pc-3", "Metro", "2026-03-01", taiwanLocation("高雄市", "前鎮區", "高雄市前鎮區興邦里")),
    postcard("pc-4", "Metro", "2026-04-01", taiwanLocation("臺南市", "中西區", "臺南市中西區赤嵌里")),
    postcard("pc-5", "Metro", "2026-05-01", taiwanLocation("臺南市", "安平區", "臺南市安平區建平里")),
  ];
  assert.equal(analyzeFriendProfile("Metro", cards).likely_base.area, "高雄市");

  const tied = cards.concat(postcard("pc-6", "Metro", "2026-06-01", taiwanLocation("臺南市", "東區", "臺南市東區東門里")));
  assert.equal(analyzeFriendProfile("Metro", tied).likely_base.area, null);
});

test("Hong Kong and overseas locations use stable local-language area labels", () => {
  const hongKong = [
    postcard("pc-1", "HK", "2026-01-01", overseasLocation("HK", "香港", null, "灣仔")),
    postcard("pc-2", "HK", "2026-02-01", overseasLocation("HK", "香港", null, "佐敦")),
    postcard("pc-3", "HK", "2026-03-01", overseasLocation("HK", "香港", null, "銅鑼灣")),
  ];
  assert.equal(analyzeFriendProfile("HK", hongKong).likely_base.area, "香港");

  const overseas = [
    postcard("pc-4", "US", "2026-01-01", overseasLocation("US", "United States", "Laramie", "Downtown")),
    postcard("pc-5", "US", "2026-02-01", overseasLocation("US", "United States", "Laramie", "West Side")),
    postcard("pc-6", "US", "2026-03-01", overseasLocation("US", "United States", "Laramie", "University")),
  ];
  assert.equal(analyzeFriendProfile("US", overseas).likely_base.area, "Laramie, United States");
});

test("a supported legacy manual signal is preserved until stronger evidence conflicts", () => {
  const cards = [
    postcard("pc-1", "Manual", "2026-05-01", taiwanLocation("臺北市", "北投區", "臺北市北投區文化里")),
    postcard("pc-2", "Manual", "2026-05-05", taiwanLocation("臺北市", "北投區", "臺北市北投區開明里")),
  ];
  const previous = legacyProfile("Manual", ["pc-1", "pc-2"], "臺北市北投區");
  const profile = analyzeFriendProfile("Manual", cards, previous);

  assert.equal(profile.likely_base.area, "臺北市北投區");
  assert.equal(profile.base_analysis.origin, "preserved_manual");

  const contradicted = cards.concat([
    postcard("pc-3", "Manual", "2026-06-01", taiwanLocation("高雄市", "苓雅區", "高雄市苓雅區意誠里")),
    postcard("pc-4", "Manual", "2026-07-01", taiwanLocation("高雄市", "苓雅區", "高雄市苓雅區人和里")),
    postcard("pc-5", "Manual", "2026-08-01", taiwanLocation("高雄市", "苓雅區", "高雄市苓雅區林富里")),
  ]);
  assert.equal(analyzeFriendProfile("Manual", contradicted, previous).likely_base.area, "高雄市苓雅區");
});

test("only affected players are recomputed and fingerprints detect effective evidence changes", () => {
  const playerCards = [
    postcard("pc-1", "Player", "2026-01-01", taiwanLocation("臺北市", "北投區", "臺北市北投區文化里")),
    postcard("pc-2", "Player", "2026-02-01", taiwanLocation("臺北市", "北投區", "臺北市北投區開明里")),
    postcard("pc-3", "Player", "2026-03-01", taiwanLocation("臺北市", "北投區", "臺北市北投區中央里")),
  ];
  const first = rebuildFriends(playerCards.concat(postcard("pc-x", "Other", "2026-01-01")), { profiles: [] });
  first.profiles.find((profile) => profile.name === "Other").sentinel = "preserved";
  const unchanged = rebuildFriends(playerCards.concat(postcard("pc-x", "Other", "2026-01-01")), first);
  assert.equal(unchanged.profiles.find((profile) => profile.name === "Other").sentinel, "preserved");

  const changed = structuredClone(playerCards);
  changed[2].location = taiwanLocation("高雄市", "苓雅區", "高雄市苓雅區林富里");
  const next = rebuildFriends(changed.concat(postcard("pc-x", "Other", "2026-01-01")), first, { affectedNames: ["Player"] });
  assert.equal(next.profiles.find((profile) => profile.name === "Other").sentinel, "preserved");
  assert.notEqual(
    next.profiles.find((profile) => profile.name === "Player").base_analysis.evidence_fingerprint,
    first.profiles.find((profile) => profile.name === "Player").base_analysis.evidence_fingerprint,
  );
});

test("friend evidence fingerprints contain location evidence but ignore unrelated research text", () => {
  const card = postcard("pc-1", "Player", null, overseasLocation("US", "United States", "Laramie", null));
  card.location.latitude = 41.31;
  card.location.longitude = -105.59;
  const evidence = friendEvidenceForPostcard(card);
  assert.equal(evidence.location.city, "Laramie");
  assert.equal(evidence.location.latitude, 41.31);

  const before = friendEvidenceFingerprint([card]);
  card.research = { summary: "unrelated update" };
  assert.equal(friendEvidenceFingerprint([card]), before);
  card.location.city = "Cheyenne";
  assert.notEqual(friendEvidenceFingerprint([card]), before);
});

function postcard(id, sender, foundDate, location = {}) {
  return {
    id,
    sender,
    found_date: foundDate,
    acquisition: { sender_status: "confirmed" },
    location,
  };
}

function taiwanLocation(city, district, addressLocal) {
  return {
    country_code: "TW",
    country: "臺灣",
    country_endonym: "臺灣",
    city,
    district,
    endonym: addressLocal,
    address_local: addressLocal,
  };
}

function japanLocation(addressLocal) {
  return {
    country_code: "JP",
    country: "日本",
    country_endonym: "日本",
    endonym: addressLocal,
    address_local: addressLocal,
  };
}

function overseasLocation(countryCode, country, city, district) {
  return {
    country_code: countryCode,
    country,
    country_endonym: country,
    city,
    district,
    endonym: district ?? city ?? country,
    address_local: district ?? city ?? country,
  };
}

function legacyProfile(name, ids, area) {
  return {
    name,
    evidence_postcard_ids: ids,
    likely_base: {
      area,
      status: "early-signal",
      confidence: "medium",
      confidence_label: "中",
      reason: "人工判斷",
    },
    frequent_areas: [],
    trip_clusters: [],
    avoid_send: { areas: [], reason: "尚無" },
  };
}
