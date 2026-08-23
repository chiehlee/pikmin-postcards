const noTranslationLanguages = ["zh", "ja"];

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
  if (!locationNeedsZhTw(location?.language) || !zhTw || zhTw === endonym) return endonym;
  return `${endonym}（${zhTw}）`;
}

export function researchedLocationQuery(location) {
  return clean(location?.endonym) ?? clean(location?.display) ?? clean(location?.raw);
}

export function validateLocationNaming(location) {
  const errors = [];
  const endonym = clean(location?.endonym);
  const language = clean(location?.language);
  const zhTw = clean(location?.zh_tw);

  if (!clean(location?.raw)) errors.push("raw is required");
  if (!endonym) errors.push("endonym is required");
  if (!language) errors.push("language is required");
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
