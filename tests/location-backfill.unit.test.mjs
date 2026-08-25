import assert from "node:assert/strict";
import test from "node:test";
import {
  backfillPostcardLocation,
  backfillPostcardLocations,
  isAddressUpgradeCandidate,
} from "../server/location-backfill.mjs";

function postcard(overrides = {}) {
  return {
    id: "pc-test",
    poi_name: "北投教會",
    location: {
      raw: "Chang'an, Beitou District",
      display: "臺北市北投區長安里",
      endonym: "臺北市北投區長安里",
      zh_tw: null,
      language: "zh-Hant-TW",
      name_status: "researched",
      name_confidence: "medium",
      country: "臺灣",
      country_code: "TW",
      country_endonym: "臺灣",
      address_local: "臺北市北投區長安里",
      precision: "locality",
      normalization_confidence: "medium",
    },
    ...overrides,
  };
}

const church = {
  lat: "25.134159",
  lon: "121.500279",
  name: "北投教會",
  display_name: "北投教會, 71號, 大興街, 長安里, 北投區, 臺北市, 112, 臺灣",
  category: "amenity",
  type: "place_of_worship",
  addresstype: "amenity",
  osm_type: "node",
  osm_id: 9876,
  namedetails: { name: "北投教會", "name:en": "Beitou Church" },
  address: {
    house_number: "71",
    road: "大興街",
    village: "長安里",
    city_district: "北投區",
    city: "臺北市",
    postcode: "112",
    country: "臺灣",
    country_code: "tw",
  },
};

test("a conservative exact POI match upgrades the address and uses that result for coordinates", async () => {
  let fallbackCalls = 0;
  const result = await backfillPostcardLocation(postcard(), {
    searchCandidate: async () => church,
    searchAddress: async () => {
      fallbackCalls += 1;
      return null;
    },
    now: () => new Date("2026-08-25T01:02:03.000Z"),
  });
  assert.equal(fallbackCalls, 0);
  assert.equal(result.addressUpgraded, true);
  assert.equal(result.location.address_local, "臺北市北投區長安里大興街71號");
  assert.equal(result.location.display, "臺北市北投區長安里大興街71號");
  assert.equal(result.location.precision, "full_address");
  assert.equal(result.location.latitude, 25.134159);
  assert.equal(result.location.longitude, 121.500279);
  assert.equal(result.location.geocode.query, "北投教會, 臺北市北投區長安里");
  assert.equal(result.location.geocode.provider, "nominatim");
});

test("a nonmatching candidate cannot silently change the address", async () => {
  const wrong = {
    ...church,
    name: "北投公園",
    display_name: church.display_name.replace("北投教會", "北投公園"),
    namedetails: { name: "北投公園" },
  };
  const result = await backfillPostcardLocation(postcard(), {
    searchCandidate: async () => wrong,
    searchAddress: async ({ query }) => ({
      ...church,
      name: "長安里",
      namedetails: { name: "長安里" },
      display_name: query,
      address: { city: "臺北市", city_district: "北投區", village: "長安里", country: "臺灣", country_code: "tw" },
    }),
  });
  assert.equal(result.addressUpgraded, false);
  assert.equal(result.location.address_local, "臺北市北投區長安里");
  assert.equal(result.location.geocode.query, "臺北市北投區長安里");
});

test("non-Chinese and non-Japanese address upgrades require a same-resolution translation", async () => {
  const boston = postcard({
    poi_name: "Old State House",
    location: {
      raw: "Boston",
      display: "Boston, Massachusetts, United States（美國麻薩諸塞州波士頓）",
      endonym: "Boston",
      zh_tw: "美國麻薩諸塞州波士頓",
      language: "en-US",
      name_status: "researched",
      name_confidence: "medium",
      country: "美國",
      country_code: "US",
      country_endonym: "United States",
      address_local: "Boston, Massachusetts, United States",
      precision: "city",
      normalization_confidence: "medium",
    },
  });
  const candidate = {
    lat: "42.35877",
    lon: "-71.05781",
    name: "Old State House",
    display_name: "206, Washington Street, Downtown Boston, Boston, Massachusetts, 02109, United States",
    addresstype: "building",
    osm_type: "way",
    osm_id: 2468,
    namedetails: { name: "Old State House" },
    address: {
      house_number: "206",
      road: "Washington Street",
      neighbourhood: "Downtown Boston",
      city: "Boston",
      state: "Massachusetts",
      postcode: "02109",
      country: "United States",
      country_code: "us",
    },
  };
  const translated = {
    ...candidate,
    display_name: "美國麻薩諸塞州波士頓華盛頓街206號",
    address: {
      ...candidate.address,
      road: "華盛頓街",
      neighbourhood: "波士頓市中心",
      city: "波士頓",
      state: "麻薩諸塞州",
      country: "美國",
    },
  };
  const upgraded = await backfillPostcardLocation(boston, {
    searchCandidate: async () => candidate,
    searchTranslation: async () => translated,
    searchAddress: async () => null,
  });
  assert.equal(upgraded.location.address_local, "206 Washington Street, Downtown Boston, Boston, Massachusetts, 02109, United States");
  assert.equal(upgraded.location.zh_tw, "美國麻薩諸塞州波士頓波士頓市中心華盛頓街206號");
  assert.match(upgraded.location.display, /Old State House|206 Washington Street/);

  const noTranslation = await backfillPostcardLocation(boston, {
    searchCandidate: async () => candidate,
    searchTranslation: async () => null,
    searchAddress: async () => candidate,
  });
  assert.equal(noTranslation.addressUpgraded, false);
  assert.equal(noTranslation.location.address_local, "Boston, Massachusetts, United States");
});

test("batch backfill reports unresolved records without aborting the remaining archive", async () => {
  const records = [postcard(), postcard({ id: "pc-missing", poi_name: "找不到的地點" })];
  const report = await backfillPostcardLocations(records, {
    searchCandidate: async ({ postcard: current }) => current.id === "pc-test" ? church : null,
    searchAddress: async () => null,
  });
  assert.equal(report.processed, 2);
  assert.equal(report.resolved, 1);
  assert.equal(report.unresolved, 1);
  assert.equal(report.address_upgraded, 1);
  assert.equal(records[1].location.geocode.status, "unresolved");
});

test("candidate matching requires both a deeper address and a recognizable POI name", () => {
  assert.equal(isAddressUpgradeCandidate("北投教會", church, "locality"), true);
  assert.equal(isAddressUpgradeCandidate("北投公園", church, "locality"), false);
  assert.equal(isAddressUpgradeCandidate("北投教會", church, "full_address"), false);
});
