import assert from "node:assert/strict";
import test from "node:test";
import {
  addressPrecisionFromNominatim,
  canonicalAddressFromNominatim,
  geocodeFinalLocation,
  locationComponentsFromNominatim,
  resolvedNominatimGeocode,
  searchAddressCandidate,
  suppliedCoordinateEvidence,
} from "../server/geocoding.mjs";

const taipeiResult = {
  lat: "25.031517",
  lon: "121.552113",
  display_name: "77號, 中央南路一段, 中央里, 北投區, 臺北市, 112, 臺灣",
  addresstype: "building",
  osm_type: "way",
  osm_id: 12345,
  address: {
    house_number: "77",
    road: "中央南路一段",
    village: "中央里",
    city_district: "北投區",
    city: "臺北市",
    postcode: "112",
    country: "臺灣",
    country_code: "tw",
  },
};

test("final-address geocoding records numeric coordinates and complete provenance", async () => {
  let request;
  const result = await geocodeFinalLocation({
    address_local: "臺北市北投區中央南路一段77號",
    country_code: "TW",
    language: "zh-Hant-TW",
    precision: "full_address",
  }, {
    endpoint: "https://geocoder.example/search",
    respectRateLimit: false,
    userAgent: "test-suite/1.0",
    now: () => new Date("2026-08-25T01:02:03.000Z"),
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return Response.json([taipeiResult]);
    },
  });

  assert.equal(request.url.searchParams.get("q"), "臺北市北投區中央南路一段77號");
  assert.equal(request.url.searchParams.get("countrycodes"), "tw");
  assert.equal(request.url.searchParams.get("accept-language"), "zh-Hant-TW,zh-TW,en");
  assert.equal(request.options.headers["user-agent"], "test-suite/1.0");
  assert.equal(result.latitude, 25.031517);
  assert.equal(result.longitude, 121.552113);
  assert.deepEqual(result.geocode, {
    status: "resolved",
    provider: "nominatim",
    query: "臺北市北投區中央南路一段77號",
    matched_label: taipeiResult.display_name,
    matched_type: "building",
    precision: "full_address",
    confidence: "high",
    resolved_at: "2026-08-25T01:02:03.000Z",
    attribution: "© OpenStreetMap contributors",
    source_url: "https://www.openstreetmap.org/way/12345",
    osm_type: "way",
    osm_id: "12345",
    error: null,
  });
});

test("address formatters use local conventions and a same-resolution zh-TW form", () => {
  assert.equal(addressPrecisionFromNominatim(taipeiResult), "full_address");
  assert.equal(canonicalAddressFromNominatim(taipeiResult, {
    countryCode: "TW",
    countryEndonym: "臺灣",
  }), "臺北市北投區中央里中央南路一段77號");
  assert.deepEqual(locationComponentsFromNominatim(taipeiResult), {
    city: "臺北市",
    district: "北投區",
    locality: "中央里",
    region: null,
    county: null,
    country_code: "TW",
  });

  const boston = {
    display_name: "77, Summer Street, Downtown Boston, Boston, Suffolk County, Massachusetts, 02110, United States",
    address: {
      house_number: "77",
      road: "Summer Street",
      neighbourhood: "Downtown Boston",
      city: "Boston",
      state: "Massachusetts",
      postcode: "02110",
      country: "United States",
      country_code: "us",
    },
  };
  assert.equal(canonicalAddressFromNominatim(boston, {
    countryCode: "US",
    countryEndonym: "United States",
  }), "77 Summer Street, Downtown Boston, Boston, Massachusetts, 02110, United States");
  assert.equal(canonicalAddressFromNominatim({
    ...boston,
    address: {
      ...boston.address,
      road: "夏街",
      neighbourhood: "波士頓市中心",
      city: "波士頓",
      state: "麻薩諸塞州",
      country: "美國",
    },
  }, {
    countryCode: "US",
    countryZhTw: "美國",
    translated: true,
  }), "美國麻薩諸塞州波士頓波士頓市中心夏街77號");

  assert.equal(canonicalAddressFromNominatim({
    display_name: "油麻地警署, 627, 廣東道, 渡船角, 香港, 九龍, 中国",
    address: {
      house_number: "627",
      road: "廣東道",
      neighbourhood: "渡船角",
      city: "香港",
      region: "九龍",
      country: "中国",
      country_code: "cn",
    },
  }, {
    countryCode: "HK",
    countryEndonym: "香港",
  }), "九龍, 渡船角, 廣東道627號, 香港");
});

test("POI candidate search combines the name with the already researched location", async () => {
  let query;
  const result = await searchAddressCandidate({
    poiName: "北投教會",
    location: {
      address_local: "臺北市北投區",
      country_code: "TW",
      language: "zh-Hant-TW",
    },
  }, {
    endpoint: "https://geocoder.example/search",
    respectRateLimit: false,
    fetchImpl: async (url) => {
      query = new URL(url).searchParams.get("q");
      return Response.json([taipeiResult]);
    },
  });
  assert.equal(query, "北投教會, 臺北市北投區");
  assert.equal(result.osm_id, 12345);
});

test("AI-supplied coordinates require a cited source and preserve its attribution", () => {
  assert.throws(() => suppliedCoordinateEvidence({ latitude: 25, longitude: 121 }, {
    address_local: "臺北市北投區",
    precision: "district",
  }), /coordinate_source_url/);

  const result = suppliedCoordinateEvidence({
    latitude: 25.1,
    longitude: 121.5,
    coordinate_source_url: "https://example.com/place",
    coordinate_source_label: "地方政府開放資料",
    coordinate_confidence: "high",
  }, {
    address_local: "臺北市北投區",
    precision: "district",
  }, { now: () => new Date("2026-08-25T01:02:03.000Z") });
  assert.equal(result.geocode.provider, "research_source");
  assert.equal(result.geocode.attribution, "地方政府開放資料");
  assert.equal(result.geocode.source_url, "https://example.com/place");
});

test("a resolved Nominatim record rejects invalid coordinates", () => {
  assert.throws(() => resolvedNominatimGeocode({
    result: { ...taipeiResult, lat: "not-a-number" },
    query: "invalid",
  }), /無效座標/);
});
