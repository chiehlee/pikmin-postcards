const noTranslationLanguages = ["zh", "ja"];
const homeCountryCodes = new Set(["TW", "JP"]);
const countryZhTwByCode = new Map([
  ["AU", "澳洲"], ["CA", "加拿大"], ["CN", "中國"], ["FR", "法國"],
  ["HK", "香港"], ["ID", "印尼"], ["JP", "日本"], ["KR", "韓國"],
  ["MN", "蒙古"], ["MO", "澳門"], ["MY", "馬來西亞"], ["NO", "挪威"],
  ["PH", "菲律賓"], ["SE", "瑞典"], ["TW", "臺灣"], ["US", "美國"],
]);
const countryAliasesByCode = new Map([
  ["TW", ["臺灣", "台灣", "Taiwan"]],
  ["HK", ["香港", "Hong Kong"]],
  ["KR", ["韓國", "南韓", "韩国", "南韩", "South Korea", "大韓民國"]],
  ["US", ["美國", "美国", "United States", "USA"]],
  ["AU", ["澳洲", "澳大利亞", "澳大利亚", "Australia"]],
]);
const locationPrecisions = new Set([
  "country",
  "region",
  "city",
  "district",
  "locality",
  "road",
  "full_address",
  "coordinates",
  "unknown",
]);

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function locationNeedsZhTw(language) {
  const normalized = clean(language)?.toLowerCase();
  if (!normalized || normalized === "und") return false;
  return Boolean(normalized && !noTranslationLanguages.some((code) => (
    normalized === code || normalized.startsWith(`${code}-`)
  )));
}

export function normalizeLocalAddress(address, countryCode, countryEndonym) {
  const value = clean(address);
  if (!value) return null;
  const code = clean(countryCode)?.toUpperCase() ?? null;
  const country = clean(countryEndonym);
  const normalized = normalizeSeparators(value, { compact: homeCountryCodes.has(code) });
  if (!code || homeCountryCodes.has(code) || !country) {
    return normalized;
  }
  if (normalized === country) return normalized;
  const parts = normalized.split(", ");
  if (parts.includes(country)) {
    return [...parts.filter((part) => part !== country), country].join(", ");
  }
  if (containsCountry(normalized, country)) return normalized;
  return `${normalized}, ${country}`;
}

export function normalizeZhTwAddress(address, countryCode, countryZhTw) {
  const value = clean(address);
  if (!value) return null;
  const code = clean(countryCode)?.toUpperCase() ?? null;
  const country = canonicalCountryZhTw(code, countryZhTw);
  const aliases = countryAliasesByCode.get(code) ?? [country].filter(Boolean);
  const normalized = stripCountryAliases(value
    .normalize("NFC")
    .replace(/，/g, ",")
    .split(",")
    .map((part) => stripCountryAliases(part.trim(), aliases))
    .filter(Boolean)
    .sort((left, right) => translatedAddressRank(left) - translatedAddressRank(right))
    .join("")
    .replace(/\s+/g, ""), aliases);
  if (!code || homeCountryCodes.has(code) || !country) {
    return normalized;
  }
  if (normalized.startsWith(country)) return normalized;
  return `${country}${normalized}`;
}

export function normalizeResearchedLocation(location) {
  const countryCode = clean(location?.country_code)?.toUpperCase() ?? null;
  const country = canonicalCountryZhTw(countryCode, location?.country);
  const addressLocal = normalizeLocalAddress(
    clean(location?.address_local) ?? clean(location?.endonym) ?? clean(location?.display) ?? clean(location?.raw),
    countryCode,
    location?.country_endonym,
  );
  const zhTw = locationNeedsZhTw(location?.language)
    ? normalizeZhTwAddress(location?.zh_tw, countryCode, country)
    : null;
  const normalized = {
    ...location,
    country_code: countryCode,
    country,
    address_local: addressLocal,
    zh_tw: zhTw,
  };
  normalized.display = researchedLocationDisplay(normalized);
  return normalized;
}

export function canonicalCountryZhTw(countryCode, fallback = null) {
  const code = clean(countryCode)?.toUpperCase() ?? null;
  return countryZhTwByCode.get(code) ?? clean(fallback);
}

export function researchedLocationDisplay(location) {
  const endonym = clean(location?.endonym) ?? clean(location?.display) ?? clean(location?.raw) ?? "地點未確認";
  const countryCode = clean(location?.country_code)?.toUpperCase();
  const localLabel = normalizeLocalAddress(
    clean(location?.address_local) ?? endonym,
    countryCode,
    location?.country_endonym,
  ) ?? "地點未確認";
  const translatedLabel = normalizeZhTwAddress(location?.zh_tw, countryCode, location?.country);
  if (!locationNeedsZhTw(location?.language) || !translatedLabel || translatedLabel === localLabel) return localLabel;
  return `${localLabel}（${translatedLabel}）`;
}

export function researchedLocationQuery(location) {
  return normalizeLocalAddress(
    clean(location?.address_local) ?? clean(location?.endonym)
      ?? clean(location?.display) ?? clean(location?.raw),
    location?.country_code,
    location?.country_endonym,
  );
}

export function validateLocationNaming(location) {
  const errors = [];
  const endonym = clean(location?.endonym);
  const language = clean(location?.language);
  const zhTw = clean(location?.zh_tw);

  if (!clean(location?.raw)) errors.push("raw is required");
  if (!endonym) errors.push("endonym is required");
  if (!language) errors.push("language is required");
  if (location?.name_status === "researched" && !clean(location?.country_code)) errors.push("country_code is required for researched names");
  if (location?.name_status === "researched" && !clean(location?.country)) errors.push("country is required for researched names");
  if (location?.name_status === "researched" && !clean(location?.country_endonym)) errors.push("country_endonym is required for researched names");
  if (!clean(location?.address_local)) errors.push("address_local is required");
  if (!locationPrecisions.has(location?.precision)) errors.push("precision is invalid");
  if (locationNeedsZhTw(language) && !zhTw) errors.push("zh_tw is required outside Chinese and Japanese");
  if (!locationNeedsZhTw(language) && zhTw) errors.push("zh_tw must be null for Chinese and Japanese endonyms");
  const normalizedAddress = normalizeLocalAddress(location?.address_local, location?.country_code, location?.country_endonym);
  if (clean(location?.address_local) && clean(location?.address_local) !== normalizedAddress) {
    errors.push("address_local must follow the country-aware canonical format");
  }
  const normalizedZhTw = normalizeZhTwAddress(location?.zh_tw, location?.country_code, location?.country);
  if (zhTw && zhTw !== normalizedZhTw) errors.push("zh_tw must follow Taiwan Traditional Chinese address order");
  if (clean(location?.display) !== researchedLocationDisplay(location)) {
    errors.push("display must equal the composed researched location label");
  }
  if (!["researched", "provisional"].includes(location?.name_status)) {
    errors.push("name_status must be researched or provisional");
  }
  if (!["high", "medium", "low"].includes(location?.name_confidence)) {
    errors.push("name_confidence must be high, medium, or low");
  }
  return errors;
}

function normalizeSeparators(value, { compact }) {
  const parts = value
    .normalize("NFC")
    .replace(/，/g, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (compact) return parts.join("").replace(/\s+/g, "");
  return parts.join(", ").replace(/\s+/g, " ");
}

function containsCountry(label, country) {
  if (label === country || label.startsWith(`${country}, `) || label.endsWith(`, ${country}`)) return true;
  if (label.startsWith(country) || label.endsWith(country)) return true;
  return label.split(", ").includes(country);
}

function stripCountryAliases(value, aliases) {
  let output = value;
  for (const alias of aliases.filter(Boolean).sort((left, right) => right.length - left.length)) {
    output = output.split(alias).join("");
  }
  return output;
}

function translatedAddressRank(value) {
  if (/[州省道都府]$/u.test(value) || /特別市$/u.test(value)) return 1;
  if (/市$/u.test(value)) return 2;
  if (/[區郡縣]$/u.test(value)) return 3;
  if (/[鄉鎮村里]$/u.test(value)) return 4;
  return 5;
}
