import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicate, metadataKey } from "../lib/dedupe.mjs";

const goldenPyramid = {
  id: "pc-0020",
  poi_name: "金字塔2",
  found_date: "2026-05-17",
  sender: null,
  location: { raw: "Ankang, Xinyi District" },
  acquisition: { type: "self_found", sender_status: "not_applicable" },
  asset: { sha256: "original-screenshot-hash" },
};

test("identical screenshot hash is an exact duplicate", () => {
  const match = findDuplicate(
    { poi_name: "unread", found_date: "2026-01-01", sender: null, sha256: "original-screenshot-hash" },
    [goldenPyramid],
  );
  assert.equal(match.duplicate, true);
  assert.equal(match.candidate, true);
  assert.equal(match.match_type, "sha256");
  assert.equal(match.record.id, "pc-0020");
});

test("matching metadata flags a candidate but preserves a different screenshot", () => {
  const match = findDuplicate(
    {
      poi_name: "金字塔2",
      found_date: "2026-05-17",
      sender: null,
      location: { raw: "Ankang, Xinyi District" },
      acquisition: { type: "self_found", sender_status: "not_applicable" },
      sha256: "different-status-bar-hash",
    },
    [goldenPyramid],
  );
  assert.equal(match.duplicate, false);
  assert.equal(match.candidate, true);
  assert.equal(match.match_type, "poi_found_date_sender_origin_location");
  assert.equal(match.confidence, "probable");
  assert.equal(match.record.id, "pc-0020");
});

test("a different confirmed sender is not silently merged", () => {
  const match = findDuplicate(
    { poi_name: "金字塔2", found_date: "2026-05-17", sender: "菎娜", location: { raw: "Ankang, Xinyi District" }, sha256: "new-hash" },
    [goldenPyramid],
  );
  assert.equal(match.duplicate, false);
  assert.equal(match.candidate, false);
});

test("self-found and received-with-unknown-sender are not silently merged", () => {
  const match = findDuplicate(
    {
      poi_name: "金字塔2",
      found_date: "2026-05-17",
      sender: null,
      location: { raw: "Ankang, Xinyi District" },
      acquisition: { type: "received", sender_status: "unknown" },
      sha256: "new-received-hash",
    },
    [goldenPyramid],
  );
  assert.equal(match.duplicate, false);
  assert.equal(match.candidate, false);
});

test("the same POI name at a different location is not a duplicate candidate", () => {
  const match = findDuplicate(
    {
      poi_name: "金字塔2",
      found_date: "2026-05-17",
      sender: null,
      location: { raw: "Datong, Taipei" },
      acquisition: { type: "self_found", sender_status: "not_applicable" },
      sha256: "different-location-hash",
    },
    [goldenPyramid],
  );
  assert.equal(match.duplicate, false);
  assert.equal(match.candidate, false);
});

test("Unicode normalization does not split equivalent Japanese names", () => {
  assert.equal(
    metadataKey({ poi_name: "カジキ", found_date: "2026-05-05", sender: "りゅう", location: { raw: "東京" } }),
    metadataKey({ poi_name: "カジキ", found_date: "2026-05-05", sender: "りゅう", location: { raw: "東京" } }),
  );
});
