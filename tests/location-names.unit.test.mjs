import assert from "node:assert/strict";
import test from "node:test";
import {
  locationNeedsZhTw,
  normalizeLocalAddress,
  normalizeResearchedLocation,
  normalizeZhTwAddress,
  researchedLocationDisplay,
  researchedLocationQuery,
  validateLocationNaming,
} from "../lib/location-names.mjs";

test("Chinese and Japanese researched names stay in their local script", () => {
  assert.equal(locationNeedsZhTw("ja"), false);
  assert.equal(locationNeedsZhTw("zh-Hant-TW"), false);
  assert.equal(researchedLocationDisplay({
    raw: "Nasu, Yumoto",
    display: "那須町湯本",
    endonym: "那須町湯本",
    zh_tw: null,
    language: "ja",
    country_code: "JP",
    country: "日本",
    country_endonym: "日本",
  }), "那須町湯本");
});

test("other local languages append the Taiwan Traditional Chinese name", () => {
  const location = {
    raw: "Seoul",
    display: "서울특별시, 대한민국（韓國首爾特別市）",
    endonym: "서울특별시",
    zh_tw: "韓國首爾特別市",
    language: "ko",
    country_code: "KR",
    country: "韓國",
    country_endonym: "대한민국",
    address_local: "서울특별시, 대한민국",
    precision: "city",
    name_status: "researched",
    name_confidence: "high",
  };
  assert.equal(researchedLocationDisplay(location), "서울특별시, 대한민국（韓國首爾特別市）");
  assert.equal(researchedLocationQuery(location), "서울특별시, 대한민국");
  assert.deepEqual(validateLocationNaming(location), []);
});

test("all geographic levels use a half-width comma separator", () => {
  const location = {
    raw: "Jordan",
    display: "佐敦, 香港",
    endonym: "佐敦",
    zh_tw: null,
    language: "zh-Hant-HK",
    country_code: "HK",
    country: "香港",
    country_endonym: "香港",
    address_local: "佐敦, 香港",
    precision: "locality",
    name_status: "researched",
    name_confidence: "medium",
  };
  assert.equal(researchedLocationDisplay(location), "佐敦, 香港");
  assert.equal(researchedLocationQuery(location), "佐敦, 香港");
  assert.deepEqual(validateLocationNaming(location), []);
  assert.equal(researchedLocationDisplay({
    ...location,
    display: "佐敦，香港",
    endonym: "佐敦，香港",
  }), "佐敦, 香港");
});

test("validation rejects a translated language without zh-TW and a stale display cache", () => {
  assert.deepEqual(validateLocationNaming({
    raw: "Laramie",
    display: "Laramie",
    endonym: "Laramie, Wyoming",
    zh_tw: null,
    language: "en-US",
    country_code: "US",
    country: "美國",
    country_endonym: "United States",
    address_local: "Laramie, Wyoming, United States",
    precision: "city",
    name_status: "provisional",
    name_confidence: "low",
  }), [
    "zh_tw is required outside Chinese and Japanese",
    "display must equal the composed researched location label",
  ]);
});

test("Taiwan displays the fullest researched address when evidence supports it", () => {
  const location = {
    raw: "Ankang, Xinyi District",
    display: "臺北市信義區松仁路89號",
    endonym: "臺北市信義區松仁路",
    zh_tw: null,
    language: "zh-Hant-TW",
    country_code: "TW",
    country: "臺灣",
    country_endonym: "臺灣",
    address_local: "臺北市信義區松仁路89號",
    precision: "full_address",
    name_status: "researched",
    name_confidence: "high",
  };
  assert.equal(researchedLocationDisplay(location), "臺北市信義區松仁路89號");
  assert.equal(researchedLocationQuery(location), "臺北市信義區松仁路89號");
  assert.deepEqual(validateLocationNaming(location), []);
});

test("Japan can display the complete chome-ban-go address", () => {
  const location = {
    raw: "Nasu, Yumoto",
    display: "栃木県那須郡那須町湯本203",
    endonym: "栃木県那須町湯本203",
    zh_tw: null,
    language: "ja",
    country_code: "JP",
    country: "日本",
    country_endonym: "日本",
    address_local: "栃木県那須郡那須町湯本203",
    precision: "full_address",
    name_status: "researched",
    name_confidence: "high",
  };
  assert.equal(researchedLocationDisplay(location), "栃木県那須郡那須町湯本203");
  assert.equal(researchedLocationQuery(location), "栃木県那須郡那須町湯本203");
  assert.deepEqual(validateLocationNaming(location), []);
});

test("country-aware normalization compacts Taiwan and Japan but keeps other local separators", () => {
  assert.equal(
    normalizeLocalAddress("臺北市, 大安區, 車層里, 延吉街160巷2號1樓", "TW", "臺灣"),
    "臺北市大安區車層里延吉街160巷2號1樓",
  );
  assert.equal(
    normalizeLocalAddress("東京都, 目黒区, 東が丘二丁目−１０−７", "JP", "日本"),
    "東京都目黒区東が丘二丁目−１０−７",
  );
  assert.equal(
    normalizeLocalAddress("Boston，Massachusetts", "US", "United States"),
    "Boston, Massachusetts, United States",
  );
  assert.equal(
    normalizeLocalAddress("香港, 中西區, 上環, 太平山街", "HK", "香港"),
    "中西區, 上環, 太平山街, 香港",
  );
  assert.equal(normalizeZhTwAddress("麻薩諸塞州, 波士頓, 美國", "US", "美國"), "美國麻薩諸塞州波士頓");
});

test("normalizing a researched record rebuilds its canonical display", () => {
  const normalized = normalizeResearchedLocation({
    raw: "Boston",
    display: "stale",
    endonym: "Boston",
    zh_tw: "麻薩諸塞州, 波士頓, 美國",
    language: "en-US",
    country_code: "us",
    country: "美國",
    country_endonym: "United States",
    address_local: "Boston, Massachusetts",
    precision: "city",
    name_status: "researched",
    name_confidence: "high",
  });
  assert.equal(normalized.address_local, "Boston, Massachusetts, United States");
  assert.equal(normalized.zh_tw, "美國麻薩諸塞州波士頓");
  assert.equal(normalized.display, "Boston, Massachusetts, United States（美國麻薩諸塞州波士頓）");
  assert.deepEqual(validateLocationNaming(normalized), []);
});

test("legacy records still render safely while a migration is in progress", () => {
  assert.equal(researchedLocationDisplay({ raw: "Nasu, Yumoto", display: "Nasu, Yumoto" }), "Nasu, Yumoto");
  assert.equal(researchedLocationDisplay(null), "地點未確認");
  assert.equal(locationNeedsZhTw("und"), false);
});
