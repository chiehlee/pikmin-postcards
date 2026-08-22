import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicate, metadataKey } from "../lib/dedupe.mjs";

const goldenPyramid = {
  id: "pc-0020",
  poi_name: "金字塔2",
  found_date: "2026-05-17",
  sender: null,
  asset: { sha256: "original-screenshot-hash" },
};

test("identical screenshot hash is an exact duplicate", () => {
  const match = findDuplicate(
    { poi_name: "unread", found_date: "2026-01-01", sender: null, sha256: "original-screenshot-hash" },
    [goldenPyramid],
  );
  assert.equal(match.duplicate, true);
  assert.equal(match.match_type, "sha256");
  assert.equal(match.record.id, "pc-0020");
});

test("the supplied 金字塔2 test case is caught when screenshot bytes differ", () => {
  const match = findDuplicate(
    { poi_name: "金字塔2", found_date: "2026-05-17", sender: null, sha256: "different-status-bar-hash" },
    [goldenPyramid],
  );
  assert.equal(match.duplicate, true);
  assert.equal(match.match_type, "poi_found_date_sender");
  assert.equal(match.confidence, "probable");
  assert.equal(match.record.id, "pc-0020");
});

test("a different confirmed sender is not silently merged", () => {
  const match = findDuplicate(
    { poi_name: "金字塔2", found_date: "2026-05-17", sender: "菎娜", sha256: "new-hash" },
    [goldenPyramid],
  );
  assert.equal(match.duplicate, false);
});

test("Unicode normalization does not split equivalent Japanese names", () => {
  assert.equal(
    metadataKey({ poi_name: "カジキ", found_date: "2026-05-05", sender: "りゅう" }),
    metadataKey({ poi_name: "カジキ", found_date: "2026-05-05", sender: "りゅう" }),
  );
});
