import assert from "node:assert/strict";
import test from "node:test";
import { googleMapsEmbedUrl, googleMapsSearchUrl } from "../lib/map-links.mjs";

test("Google Maps links preserve a researched place query without requiring an API key", () => {
  const query = "One Grantai Fountain・Our Lady of Carmel, Taipa";
  const search = new URL(googleMapsSearchUrl(query));
  const embed = new URL(googleMapsEmbedUrl(query));

  assert.equal(search.origin, "https://www.google.com");
  assert.equal(search.pathname, "/maps/search/");
  assert.equal(search.searchParams.get("api"), "1");
  assert.equal(search.searchParams.get("query"), query);

  assert.equal(embed.origin, "https://www.google.com");
  assert.equal(embed.pathname, "/maps");
  assert.equal(embed.searchParams.get("q"), query);
  assert.equal(embed.searchParams.get("output"), "embed");
  assert.equal(embed.searchParams.has("key"), false);
});

test("coordinate map queries round-trip without losing signs or commas", () => {
  const query = "-34.475459,150.4220084";
  const embed = new URL(googleMapsEmbedUrl(query));
  assert.equal(embed.searchParams.get("q"), query);
});
