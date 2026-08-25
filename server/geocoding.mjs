import { setTimeout as delay } from "node:timers/promises";
import {
  normalizeLocalAddress,
  normalizeZhTwAddress,
  researchedLocationQuery,
} from "../lib/location-names.mjs";

const defaultEndpoint = "https://nominatim.openstreetmap.org/search";
const defaultUserAgent = "PikminPostcardArchive/0.1 (+https://github.com/chiehlee/pikmin-postcards)";
const attribution = "© OpenStreetMap contributors";
const validPrecisions = new Set([
  "country", "region", "city", "district", "locality", "road", "full_address", "coordinates", "unknown",
]);
let lastPublicRequestAt = 0;

export async function geocodeFinalLocation(location, {
  fetchImpl = globalThis.fetch,
  endpoint = process.env.PIKMIN_GEOCODER_URL?.trim() || defaultEndpoint,
  userAgent = process.env.PIKMIN_GEOCODER_USER_AGENT?.trim() || defaultUserAgent,
  respectRateLimit = endpoint === defaultEndpoint,
  now = () => new Date(),
} = {}) {
  const query = researchedLocationQuery(location);
  if (!query) return unresolvedGeocode("研究地址為空，無法解析座標");
  const result = await searchNominatim(query, {
    countryCode: location?.country_code,
    language: location?.language,
    fetchImpl,
    endpoint,
    userAgent,
    respectRateLimit,
  });
  if (!result) return unresolvedGeocode(`找不到「${query}」的座標`, query);
  return resolvedNominatimGeocode({ result, query, precision: location?.precision, now });
}

export async function searchAddressCandidate({ poiName, location }, options = {}) {
  const base = researchedLocationQuery(location);
  const query = [clean(poiName), base].filter(Boolean).join(", ");
  if (!query) return null;
  return searchNominatim(query, {
    countryCode: location?.country_code,
    language: location?.language,
    ...options,
  });
}

export async function searchNominatim(query, {
  countryCode = null,
  language = null,
  fetchImpl = globalThis.fetch,
  endpoint = process.env.PIKMIN_GEOCODER_URL?.trim() || defaultEndpoint,
  userAgent = process.env.PIKMIN_GEOCODER_USER_AGENT?.trim() || defaultUserAgent,
  respectRateLimit = endpoint === defaultEndpoint,
} = {}) {
  if (!clean(query)) return null;
  if (respectRateLimit) await waitForPublicRateLimit();
  const url = new URL(endpoint);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("namedetails", "1");
  const requestedCode = clean(countryCode)?.toUpperCase();
  const code = requestedCode ? ({ HK: "cn", MO: "cn" }[requestedCode] ?? requestedCode.toLowerCase()) : null;
  if (code) url.searchParams.set("countrycodes", code);
  url.searchParams.set("accept-language", languagePreference(language));
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": userAgent,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Geocoder HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("Geocoder 回應格式不正確");
  const result = payload[0] ?? null;
  if (!result) return null;
  numericCoordinate(result.lat, -90, 90);
  numericCoordinate(result.lon, -180, 180);
  return result;
}

export function addressPrecisionFromNominatim(result) {
  const address = result?.address ?? {};
  if (clean(address.house_number) && first(address, ["road", "pedestrian", "footway", "path"])) return "full_address";
  if (first(address, ["road", "pedestrian", "footway", "path"])) return "road";
  if (first(address, ["locality", "neighbourhood", "quarter", "suburb", "hamlet", "village"])) return "locality";
  if (first(address, ["city_district", "borough", "district", "municipality"])) return "district";
  if (first(address, ["city", "town"])) return "city";
  if (first(address, ["state", "province", "region"])) return "region";
  if (clean(address.country)) return "country";
  return "unknown";
}

export function canonicalAddressFromNominatim(result, {
  countryCode,
  countryEndonym,
  countryZhTw = null,
  translated = false,
} = {}) {
  const code = clean(countryCode)?.toUpperCase() ?? clean(result?.address?.country_code)?.toUpperCase() ?? null;
  const address = result?.address ?? {};
  if (["TW", "JP"].includes(code) && !translated) {
    const parts = code === "TW"
      ? taiwanAddressParts(address)
      : japanAddressParts(address);
    const compact = unique(parts).join("");
    if (compact) return normalizeLocalAddress(compact, code, countryEndonym);
  }
  if (translated) {
    const translatedParts = translatedAddressParts(address);
    const compact = unique(translatedParts).join("");
    return normalizeZhTwAddress(compact || result?.display_name, code, countryZhTw);
  }
  const localParts = generalAddressParts(address, code);
  const local = unique(localParts).join(", ") || clean(result?.display_name);
  return normalizeLocalAddress(local, code, countryEndonym ?? address.country);
}

export function locationComponentsFromNominatim(result) {
  const address = result?.address ?? {};
  const countryCode = clean(address.country_code)?.toUpperCase() ?? null;
  return {
    city: first(address, ["city", "town", "village", "municipality"]),
    district: countryCode === "TW"
      ? first(address, ["city_district", "suburb", "town", "township", "district", "municipality"])
      : first(address, ["city_district", "borough", "district"]),
    locality: countryCode === "TW"
      ? first(address, ["neighbourhood", "quarter"]) ?? taiwanVillage(address.village)
      : first(address, ["neighbourhood", "quarter", "suburb", "hamlet", "village"]),
    region: first(address, ["state", "province", "region"]),
    county: first(address, ["county", "state_district"]),
    country_code: countryCode,
  };
}

export function resolvedNominatimGeocode({
  result,
  query,
  precision = "unknown",
  confidence = null,
  now = () => new Date(),
} = {}) {
  if (!result) throw new Error("建立座標紀錄時缺少 geocoder result");
  const normalizedPrecision = validPrecisions.has(precision) ? precision : "unknown";
  return {
    latitude: numericCoordinate(result.lat, -90, 90),
    longitude: numericCoordinate(result.lon, -180, 180),
    geocode: {
      status: "resolved",
      provider: "nominatim",
      query: clean(query),
      matched_label: clean(result.display_name),
      matched_type: clean(result.addresstype) ?? clean(result.type),
      precision: normalizedPrecision,
      confidence: confidence ?? geocodeConfidence(normalizedPrecision, result),
      resolved_at: now().toISOString(),
      attribution,
      source_url: osmObjectUrl(result),
      osm_type: clean(result.osm_type),
      osm_id: result.osm_id == null ? null : String(result.osm_id),
      error: null,
    },
  };
}

export function suppliedCoordinateEvidence(input, location, { now = () => new Date() } = {}) {
  const latitude = input?.latitude;
  const longitude = input?.longitude;
  if (latitude == null && longitude == null) return null;
  numericCoordinate(latitude, -90, 90);
  numericCoordinate(longitude, -180, 180);
  const sourceUrl = validHttpUrl(input?.coordinate_source_url) ? input.coordinate_source_url.trim() : null;
  if (!sourceUrl) throw new Error("AI 回傳座標時必須提供可追溯的 coordinate_source_url");
  const sourceLabel = clean(input?.coordinate_source_label);
  if (!sourceLabel) throw new Error("AI 回傳座標時必須提供 coordinate_source_label");
  if (!["high", "medium", "low"].includes(input?.coordinate_confidence)) {
    throw new Error("AI 回傳座標時必須提供有效的 coordinate_confidence");
  }
  return {
    latitude,
    longitude,
    geocode: {
      status: "resolved",
      provider: "research_source",
      query: researchedLocationQuery(location),
      matched_label: sourceLabel,
      matched_type: "researched-coordinate",
      precision: validPrecisions.has(location?.precision) ? location.precision : "unknown",
      confidence: input.coordinate_confidence,
      resolved_at: now().toISOString(),
      attribution: sourceLabel,
      source_url: sourceUrl,
      osm_type: null,
      osm_id: null,
      error: null,
    },
  };
}

export function unresolvedGeocode(error, query = null) {
  return {
    latitude: null,
    longitude: null,
    geocode: {
      status: "unresolved",
      provider: null,
      query,
      matched_label: null,
      matched_type: null,
      precision: "unknown",
      confidence: "low",
      resolved_at: null,
      attribution: null,
      source_url: null,
      osm_type: null,
      osm_id: null,
      error,
    },
  };
}

function taiwanAddressParts(address) {
  const administrative = first(address, ["city", "county", "state"]);
  const district = first(address, ["city_district", "suburb", "town", "township", "district", "municipality"]);
  const locality = first(address, ["neighbourhood", "quarter"])
    ?? taiwanVillage(address.village);
  const road = first(address, ["road", "pedestrian", "footway", "path"]);
  const house = formatCjkHouseNumber(address.house_number, "號");
  return [administrative, district, locality, road, house];
}

function taiwanVillage(value) {
  const name = clean(value);
  return name && /[里村]$/u.test(name) ? name : null;
}

function japanAddressParts(address) {
  const prefecture = first(address, ["province", "state", "region"]);
  const city = first(address, ["city", "town", "village", "municipality"]);
  const district = first(address, ["city_district", "borough", "district"]);
  const locality = first(address, ["quarter", "suburb", "neighbourhood", "hamlet"]);
  const road = first(address, ["road", "pedestrian"]);
  const house = clean(address.house_number);
  return [prefecture, city, district, locality, road, house];
}

function generalAddressParts(address, countryCode) {
  const road = first(address, ["road", "pedestrian", "footway", "path"]);
  const house = clean(address.house_number);
  const eastAsianOrder = ["CN", "HK", "MO", "KR"].includes(countryCode);
  const street = road && house
    ? eastAsianOrder ? `${road}${formatCjkHouseNumber(house, "號")}` : `${house} ${road}`
    : road ?? house;
  const locality = first(address, ["neighbourhood", "quarter", "suburb", "hamlet"]);
  const district = first(address, ["city_district", "borough", "district", "county"]);
  const city = first(address, ["city", "town", "village", "municipality"]);
  const region = first(address, ["state", "province", "region"]);
  const postcode = clean(address.postcode);
  if (eastAsianOrder) return [region, city, district, locality, street, postcode];
  if (["FR", "BE", "LU", "MC"].includes(countryCode)) {
    return [street, locality, district, [postcode, city].filter(Boolean).join(" "), region];
  }
  return [street, locality, district, city, region, postcode];
}

function translatedAddressParts(address) {
  const region = first(address, ["state", "province", "region"]);
  const city = first(address, ["city", "town", "village", "municipality"]);
  const district = first(address, ["city_district", "borough", "district", "county"]);
  const locality = first(address, ["neighbourhood", "quarter", "suburb", "hamlet"]);
  const road = first(address, ["road", "pedestrian", "footway", "path"]);
  const house = formatCjkHouseNumber(address.house_number, "號");
  return [region, city, district, locality, road, house];
}

function formatCjkHouseNumber(value, suffix) {
  const number = clean(value);
  if (!number) return null;
  return number.endsWith(suffix) ? number : `${number}${suffix}`;
}

function geocodeConfidence(precision, result) {
  const matched = addressPrecisionFromNominatim(result);
  const ranks = ["unknown", "country", "region", "city", "district", "locality", "road", "full_address", "coordinates"];
  const expectedIndex = ranks.indexOf(precision);
  const matchedIndex = ranks.indexOf(matched);
  if (matchedIndex >= expectedIndex && expectedIndex >= ranks.indexOf("road")) return "high";
  if (matchedIndex >= expectedIndex - 1) return "medium";
  return "low";
}

function languagePreference(language) {
  const preferred = [clean(language), "zh-TW", "en"].filter(Boolean);
  return [...new Set(preferred)].join(",");
}

async function waitForPublicRateLimit() {
  const remaining = Math.max(0, 1_100 - (Date.now() - lastPublicRequestAt));
  if (remaining) await delay(remaining);
  lastPublicRequestAt = Date.now();
}

function numericCoordinate(value, minimum, maximum) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) {
    throw new Error("Geocoder 回傳無效座標");
  }
  return numeric;
}

function first(object, keys) {
  for (const key of keys) {
    const value = clean(object?.[key]);
    if (value) return value;
  }
  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function osmObjectUrl(result) {
  const type = clean(result?.osm_type)?.toLowerCase();
  const id = result?.osm_id == null ? null : String(result.osm_id);
  const paths = { node: "node", way: "way", relation: "relation" };
  return type && id && paths[type] ? `https://www.openstreetmap.org/${paths[type]}/${id}` : null;
}
