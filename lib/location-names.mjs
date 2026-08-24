const noTranslationLanguages = ["zh", "ja"];
const homeCountryCodes = new Set(["TW", "JP"]);
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

export function researchedLocationDisplay(location) {
  const endonym = clean(location?.endonym) ?? clean(location?.display) ?? clean(location?.raw) ?? "地點未確認";
  const zhTw = clean(location?.zh_tw);
  const countryCode = clean(location?.country_code)?.toUpperCase();
  const displayEndonym = countryCode === "TW"
    ? clean(location?.address_local) ?? endonym
    : endonym;
  const countryEndonym = clean(location?.country_endonym);
  const countryZhTw = clean(location?.country);
  const localLabel = countryCode && !homeCountryCodes.has(countryCode) && countryEndonym
    ? appendCountry(displayEndonym, countryEndonym)
    : displayEndonym;
  if (!locationNeedsZhTw(location?.language) || !zhTw || zhTw === displayEndonym) return localLabel;
  const translatedLabel = countryCode && !homeCountryCodes.has(countryCode) && countryZhTw
    ? appendCountry(zhTw, countryZhTw)
    : zhTw;
  return `${localLabel}（${translatedLabel}）`;
}

export function researchedLocationQuery(location) {
  const address = clean(location?.address_local) ?? clean(location?.endonym)
    ?? clean(location?.display) ?? clean(location?.raw);
  const countryCode = clean(location?.country_code)?.toUpperCase();
  const countryEndonym = clean(location?.country_endonym);
  return address && countryCode && !homeCountryCodes.has(countryCode) && countryEndonym
    ? appendCountry(address, countryEndonym)
    : address;
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

function appendCountry(label, country) {
  if (label === country || label.endsWith(`, ${country}`)) return label;
  const fullWidthSuffix = `，${country}`;
  if (label.endsWith(fullWidthSuffix)) {
    return `${label.slice(0, -fullWidthSuffix.length)}, ${country}`;
  }
  return `${label}, ${country}`;
}
