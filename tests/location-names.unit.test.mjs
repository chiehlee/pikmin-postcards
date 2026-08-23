import assert from "node:assert/strict";
import test from "node:test";
import {
  locationNeedsZhTw,
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
  }), "那須町湯本");
});

test("other local languages append the Taiwan Traditional Chinese name", () => {
  const location = {
    raw: "Seoul",
    display: "서울특별시（首爾特別市）",
    endonym: "서울특별시",
    zh_tw: "首爾特別市",
    language: "ko",
    name_status: "researched",
    name_confidence: "high",
  };
  assert.equal(researchedLocationDisplay(location), "서울특별시（首爾特別市）");
  assert.equal(researchedLocationQuery(location), "서울특별시");
  assert.deepEqual(validateLocationNaming(location), []);
});

test("validation rejects a translated language without zh-TW and a stale display cache", () => {
  assert.deepEqual(validateLocationNaming({
    raw: "Laramie",
    display: "Laramie",
    endonym: "Laramie, Wyoming",
    zh_tw: null,
    language: "en-US",
    name_status: "provisional",
    name_confidence: "low",
  }), [
    "zh_tw is required outside Chinese and Japanese",
    "display must equal the composed researched location label",
  ]);
});

test("legacy records still render safely while a migration is in progress", () => {
  assert.equal(researchedLocationDisplay({ raw: "Nasu, Yumoto", display: "Nasu, Yumoto" }), "Nasu, Yumoto");
  assert.equal(researchedLocationDisplay(null), "地點未確認");
  assert.equal(locationNeedsZhTw("und"), false);
});
