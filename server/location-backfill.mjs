import {
  locationNeedsZhTw,
  normalizeResearchedLocation,
  researchedLocationQuery,
} from "../lib/location-names.mjs";
import {
  addressPrecisionFromNominatim,
  canonicalAddressFromNominatim,
  locationComponentsFromNominatim,
  resolvedNominatimGeocode,
  unresolvedGeocode,
} from "./geocoding.mjs";

const precisionOrder = [
  "unknown", "country", "region", "city", "district", "locality", "road", "full_address", "coordinates",
];
const protectedCoordinateProviders = new Set(["research_source", "manual", "visible_coordinates", "legacy"]);

export async function backfillPostcardLocations(postcards, {
  searchCandidate,
  searchAddress,
  searchTranslation,
  now = () => new Date(),
  onProgress = () => {},
} = {}) {
  if (!Array.isArray(postcards)) throw new Error("location backfill 需要 postcards 陣列");
  if (typeof searchCandidate !== "function" || typeof searchAddress !== "function") {
    throw new Error("location backfill 缺少 geocoder search functions");
  }
  const report = {
    processed: 0,
    resolved: 0,
    unresolved: 0,
    address_upgraded: 0,
    normalized: 0,
    protected_coordinates: 0,
    records: [],
  };

  for (const postcard of postcards) {
    const before = structuredClone(postcard.location);
    let outcome;
    try {
      outcome = await backfillPostcardLocation(postcard, {
        searchCandidate,
        searchAddress,
        searchTranslation,
        now,
      });
      postcard.location = outcome.location;
    } catch (error) {
      const location = normalizeResearchedLocation(before);
      const unresolved = unresolvedGeocode(error instanceof Error ? error.message : String(error), researchedLocationQuery(location));
      postcard.location = { ...location, ...unresolved };
      outcome = {
        location: postcard.location,
        addressUpgraded: false,
        protectedCoordinates: false,
        error: postcard.location.geocode.error,
      };
    }

    report.processed += 1;
    if (outcome.location.geocode?.status === "resolved") report.resolved += 1;
    else report.unresolved += 1;
    if (outcome.addressUpgraded) report.address_upgraded += 1;
    if (outcome.protectedCoordinates) report.protected_coordinates += 1;
    if (canonicalJson(before) !== canonicalJson(outcome.location)) report.normalized += 1;
    const entry = {
      id: postcard.id,
      poi_name: postcard.poi_name,
      before: before.address_local ?? before.display ?? before.raw,
      after: outcome.location.address_local,
      precision: outcome.location.precision,
      latitude: outcome.location.latitude,
      longitude: outcome.location.longitude,
      provider: outcome.location.geocode?.provider ?? null,
      coordinate_precision: outcome.location.geocode?.precision ?? null,
      address_upgraded: outcome.addressUpgraded,
      error: outcome.error ?? outcome.location.geocode?.error ?? null,
    };
    report.records.push(entry);
    await onProgress(entry, report);
  }
  return report;
}

export async function backfillPostcardLocation(postcard, {
  searchCandidate,
  searchAddress,
  searchTranslation,
  now = () => new Date(),
} = {}) {
  let current = normalizeResearchedLocation(postcard.location);
  if (!current.geocode && Number.isFinite(current.latitude) && Number.isFinite(current.longitude)) {
    current = {
      ...current,
      geocode: legacyCoordinateEvidence(current, now),
    };
  }
  const protectedCoordinates = current.geocode?.status === "resolved"
    && protectedCoordinateProviders.has(current.geocode.provider)
    && Number.isFinite(current.latitude)
    && Number.isFinite(current.longitude);
  if (protectedCoordinates) {
    return { location: current, addressUpgraded: false, protectedCoordinates: true };
  }

  const currentQuery = researchedLocationQuery(current);
  let finalLocation = current;
  let result = null;
  let query = currentQuery;
  let coordinatePrecision = current.precision;
  let coordinateConfidence = null;
  let addressUpgraded = false;

  if (current.precision === "full_address") {
    const exact = await searchAddress({ postcard, location: current, query: currentQuery, precision: current.precision });
    if (isAddressSearchCompatible(current, exact, current.precision)) result = exact;
  }

  if (!result && shouldSearchPoiCandidate(postcard)) {
    const candidateQuery = [postcard.poi_name, currentQuery].filter(Boolean).join(", ");
    const candidate = await searchCandidate({ postcard, location: current, query: candidateQuery });
    const candidatePrecision = addressPrecisionFromNominatim(candidate);
    if (candidate && isAddressUpgradeCandidate(postcard.poi_name, candidate, current.precision)) {
      const localAddress = canonicalAddressFromNominatim(candidate, {
        countryCode: current.country_code,
        countryEndonym: current.country_endonym,
      });
      let translatedAddress = current.zh_tw;
      if (locationNeedsZhTw(current.language)) {
        const translatedResult = typeof searchTranslation === "function"
          ? await searchTranslation({ postcard, location: current, query: candidateQuery, candidate })
          : null;
        translatedAddress = sameGeocoderFeature(candidate, translatedResult)
          ? canonicalAddressFromNominatim(translatedResult, {
          countryCode: current.country_code,
          countryZhTw: current.country,
          translated: true,
          })
          : null;
      }
      if (localAddress && (!locationNeedsZhTw(current.language) || translatedAddress)) {
        finalLocation = normalizeResearchedLocation({
          ...current,
          ...locationComponentsFromNominatim(candidate),
          country_code: current.country_code,
          address_local: localAddress,
          zh_tw: translatedAddress,
          precision: candidatePrecision,
          normalization_confidence: geocodeConfidence(candidatePrecision),
        });
        result = candidate;
        query = candidateQuery;
        coordinatePrecision = "coordinates";
        coordinateConfidence = "high";
        addressUpgraded = true;
      }
    }
    if (!result && candidate && isPoiMatch(postcard.poi_name, candidate)) {
      result = candidate;
      query = candidateQuery;
      coordinatePrecision = "coordinates";
      coordinateConfidence = "medium";
    }
  }

  if (!result) {
    const plans = locationSearchPlan(finalLocation)
      .filter((plan) => !(current.precision === "full_address" && plan.query === currentQuery));
    for (const plan of plans) {
      const candidate = await searchAddress({ postcard, location: finalLocation, ...plan });
      if (!isAddressSearchCompatible(finalLocation, candidate, plan.precision)) continue;
      result = candidate;
      query = plan.query;
      coordinatePrecision = addressPrecisionFromNominatim(candidate);
      coordinateConfidence = plan.precision === finalLocation.precision ? null : "low";
      break;
    }
  }
  if (!result) {
    return {
      location: {
        ...finalLocation,
        ...unresolvedGeocode(`找不到「${query}」的座標`, query),
      },
      addressUpgraded,
      protectedCoordinates: false,
    };
  }
  const resolved = resolvedNominatimGeocode({
    result,
    query,
    precision: coordinatePrecision,
    confidence: coordinateConfidence,
    now,
  });
  return {
    location: { ...finalLocation, ...resolved },
    addressUpgraded,
    protectedCoordinates: false,
  };
}

export function isAddressUpgradeCandidate(poiName, result, currentPrecision = "unknown") {
  if (!result || precisionRank(addressPrecisionFromNominatim(result)) <= precisionRank(currentPrecision)) return false;
  return isPoiMatch(poiName, result);
}

export function isPoiMatch(poiName, result) {
  const wanted = normalizedName(poiName);
  if (wanted.length < 3) return false;
  const names = new Set([
    result.name,
    result.display_name?.split(",")[0],
    ...Object.values(result.namedetails ?? {}),
  ].map(normalizedName).filter(Boolean));
  return [...names].some((candidate) => (
    candidate === wanted
    || (Math.min(candidate.length, wanted.length) >= 6 && (candidate.includes(wanted) || wanted.includes(candidate)))
  ));
}

export function isAddressSearchCompatible(location, result, precision) {
  if (!result) return false;
  const matchedPrecision = addressPrecisionFromNominatim(result);
  if (matchedPrecision === "unknown") return false;
  if (precision !== "full_address") return true;
  const expectedHouse = houseNumberFromAddress(location?.address_local);
  const actualHouse = normalizedHouseNumber(result?.address?.house_number);
  return !expectedHouse || expectedHouse === actualHouse;
}

export function locationSearchPlan(location) {
  const countryCode = location?.country_code?.toUpperCase() ?? null;
  const country = countryCode && !["TW", "JP"].includes(countryCode)
    ? location.country_endonym
    : null;
  const separator = ["TW", "JP"].includes(countryCode) ? "" : ", ";
  const homeOrder = ["TW", "JP"].includes(countryCode);
  const appendCountry = (parts) => {
    const values = [...parts.filter(Boolean)];
    if (country && !values.includes(country)) values.push(country);
    return values.join(separator);
  };
  const exact = researchedLocationQuery(location);
  const withoutHouse = stripHouseNumber(exact, countryCode);
  const rawQueries = rawLocationQueries(location?.raw, location?.country_endonym, countryCode);
  const plans = [
    { query: exact, precision: location?.precision ?? "unknown" },
    withoutHouse && withoutHouse !== exact ? { query: withoutHouse, precision: "road" } : null,
    ...rawQueries.map((query) => ({ query, precision: location?.precision ?? "unknown" })),
    { query: appendCountry(homeOrder
      ? [location?.region, location?.city, location?.district, location?.locality]
      : [location?.locality, location?.district, location?.city, location?.region]), precision: "locality" },
    { query: appendCountry(homeOrder
      ? [location?.region, location?.city, location?.district]
      : [location?.district, location?.city, location?.region]), precision: "district" },
    { query: appendCountry(homeOrder
      ? [location?.region, location?.city]
      : [location?.city, location?.region]), precision: "city" },
    { query: appendCountry([location?.region]), precision: "region" },
    { query: location?.country_endonym, precision: "country" },
  ].filter((plan) => plan?.query);
  const seen = new Set();
  return plans.filter((plan) => {
    if (seen.has(plan.query)) return false;
    seen.add(plan.query);
    return true;
  });
}

function shouldSearchPoiCandidate(postcard) {
  return Boolean(postcard?.poi_name?.trim());
}

function precisionRank(precision) {
  const index = precisionOrder.indexOf(precision);
  return index === -1 ? 0 : index;
}

function geocodeConfidence(precision) {
  return precisionRank(precision) >= precisionRank("road") ? "high" : "medium";
}

function normalizedName(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, "")
    : "";
}

function sameGeocoderFeature(left, right) {
  return Boolean(left && right)
    && String(left.osm_type ?? "").toLowerCase() === String(right.osm_type ?? "").toLowerCase()
    && String(left.osm_id ?? "") === String(right.osm_id ?? "");
}

function legacyCoordinateEvidence(location, now) {
  const visible = visibleCoordinatePair(location.raw);
  return {
    status: "resolved",
    provider: visible ? "visible_coordinates" : "legacy",
    query: visible ? location.raw : researchedLocationQuery(location),
    matched_label: visible ? "明信片畫面顯示座標" : "既有資料中的座標",
    matched_type: visible ? "visible-coordinate" : "legacy-coordinate",
    precision: "coordinates",
    confidence: visible ? "high" : "low",
    resolved_at: visible ? now().toISOString() : null,
    attribution: visible ? "Pikmin Bloom 明信片截圖" : null,
    source_url: null,
    osm_type: null,
    osm_id: null,
    error: visible ? null : "此座標早於結構化來源紀錄；保留原值，待個別再研究確認",
  };
}

function visibleCoordinatePair(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^\s*\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)\s*$/);
  return match ? { latitude: Number(match[1]), longitude: Number(match[2]) } : null;
}

function rawLocationQueries(raw, countryEndonym, countryCode) {
  if (typeof raw !== "string" || !raw.trim() || visibleCoordinatePair(raw)) return [];
  const parts = raw.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
  return parts.map((_, index) => {
    const value = parts.slice(index).join(", ");
    if (["TW", "JP"].includes(countryCode) || !countryEndonym || value.includes(countryEndonym)) return value;
    return `${value}, ${countryEndonym}`;
  });
}

function houseNumberFromAddress(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/([0-9０-９]+(?:之[0-9０-９]+)?)(?:號|号)/u)
    ?? value.match(/^\s*([0-9０-９]+(?:[-–−][0-9０-９]+)*)\b/u)
    ?? value.match(/([0-9０-９]+(?:[-–−][0-9０-９]+)*)\s*$/u);
  return normalizedHouseNumber(match?.[1]);
}

function normalizedHouseNumber(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[號号\s]/gu, "").replace(/[–−]/g, "-")
    : null;
}

function stripHouseNumber(value, countryCode) {
  if (typeof value !== "string") return null;
  if (countryCode === "TW") return value.replace(/[0-9０-９]+(?:之[0-9０-９]+)?號.*$/u, "").trim();
  if (countryCode === "JP") {
    return value.replace(/[0-9０-９一二三四五六七八九十百千]+(?:[-–−ー][0-9０-９一二三四五六七八九十百千]+)*\s*$/u, "").trim();
  }
  return value.replace(/^\s*[0-9０-９]+(?:[-–−][0-9０-９]+)*\s+/u, "").trim();
}

function canonicalJson(value) {
  return JSON.stringify(value, Object.keys(value ?? {}).sort());
}
