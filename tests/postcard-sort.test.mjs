import assert from "node:assert/strict";
import test from "node:test";
import {
  distanceKilometers,
  postcardCoordinates,
  sortPostcards,
} from "../lib/postcard-sort.mjs";

const records = [
  postcard("a", 4, "2026-05-03", 0, 1),
  postcard("b", 2, "2026-05-01", 0, 2),
  postcard("c", null, null, null, null),
  postcard("d", 4, "2026-05-02", 0, 3),
];

test("rating and date sorting support both directions while missing values stay last", () => {
  assert.deepEqual(ids(sortPostcards(records, { field: "rating", direction: "desc" })), ["a", "d", "b", "c"]);
  assert.deepEqual(ids(sortPostcards(records, { field: "rating", direction: "asc" })), ["b", "a", "d", "c"]);
  assert.deepEqual(ids(sortPostcards(records, { field: "date", direction: "desc" })), ["a", "d", "b", "c"]);
  assert.deepEqual(ids(sortPostcards(records, { field: "date", direction: "asc" })), ["b", "d", "a", "c"]);
});

test("distance sorting supports nearest and farthest with ungeocoded records last", () => {
  const origin = { latitude: 0, longitude: 0 };
  assert.deepEqual(ids(sortPostcards(records, { field: "distance", direction: "asc", origin })), ["a", "b", "d", "c"]);
  assert.deepEqual(ids(sortPostcards(records, { field: "distance", direction: "desc", origin })), ["d", "b", "a", "c"]);
  assert.ok(Math.abs(distanceKilometers(records[0], origin) - 111.2) < 0.2);
});

test("coordinates can be recovered from the postcard's raw coordinate label", () => {
  assert.deepEqual(
    postcardCoordinates({ location: { raw: "(35.6443480, 139.7052670)" } }),
    { latitude: 35.644348, longitude: 139.705267 },
  );
  assert.equal(postcardCoordinates({ location: { raw: "Ankang, Xinyi District" } }), null);
});

function postcard(id, rating, foundDate, latitude, longitude) {
  return {
    id,
    found_date: foundDate,
    curation: { rating },
    location: { raw: `${latitude}, ${longitude}`, latitude, longitude },
  };
}

function ids(values) {
  return values.map((record) => record.id);
}
