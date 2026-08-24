import { createHash } from "node:crypto";

const analysisVersion = 1;
const minimumAutomaticDates = 3;
const minimumAutomaticSpanDays = 14;
const minimumAutomaticShare = 0.6;

export function rebuildFriends(postcards, previousArchive = { profiles: [] }, {
  affectedNames = null,
} = {}) {
  const previousByName = new Map((previousArchive.profiles ?? []).map((profile) => [profile.name, profile]));
  const groups = new Map();
  for (const postcard of postcards) {
    if (!confirmedSender(postcard)) continue;
    if (!groups.has(postcard.sender)) groups.set(postcard.sender, []);
    groups.get(postcard.sender).push(postcard);
  }
  const affected = affectedNames == null ? null : new Set(affectedNames.filter(Boolean));

  const profiles = [...groups.entries()]
    .map(([name, cards]) => {
      const previous = previousByName.get(name);
      const evidenceIds = evidencePostcardIds(cards);
      const previousIds = [...(previous?.evidence_postcard_ids ?? [])].sort();
      const fingerprint = friendEvidenceFingerprint(cards);
      const sameIds = previous && arraysEqual(evidenceIds, previousIds);
      const sameFingerprint = previous?.base_analysis?.evidence_fingerprint === fingerprint;
      const explicitlyAffected = affected?.has(name) ?? false;

      if (previous && !explicitlyAffected && (sameFingerprint || (!previous.base_analysis && sameIds))) {
        return previous;
      }
      if (previous && affected && !explicitlyAffected) return previous;
      return analyzeFriendProfile(name, cards, previous, fingerprint);
    })
    .sort((left, right) =>
      right.evidence_postcard_ids.length - left.evidence_postcard_ids.length
      || left.name.localeCompare(right.name, "zh-Hant"),
    );

  return {
    schema_version: Math.max(previousArchive.schema_version ?? 1, 1),
    generated_from: "data/postcards.json",
    profiles,
  };
}

export function friendEvidenceFingerprint(cards) {
  const evidence = cards
    .filter(confirmedSender)
    .map(friendEvidenceForPostcard)
    .sort((left, right) => left.id.localeCompare(right.id));
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

export function friendEvidenceForPostcard(postcard) {
  const location = postcard.location ?? {};
  return {
    id: postcard.id,
    sender: postcard.sender,
    found_date: postcard.found_date ?? null,
    location: {
      country_code: location.country_code ?? null,
      country: location.country ?? null,
      country_endonym: location.country_endonym ?? null,
      region: location.region ?? null,
      city: location.city ?? null,
      district: location.district ?? null,
      locality: location.locality ?? null,
      endonym: location.endonym ?? null,
      address_local: location.address_local ?? null,
      latitude: location.latitude ?? null,
      longitude: location.longitude ?? null,
    },
  };
}

export function analyzeFriendProfile(name, cards, previous = null, fingerprint = friendEvidenceFingerprint(cards)) {
  const evidenceIds = evidencePostcardIds(cards);
  const datedCards = cards.filter((card) => validDate(card.found_date));
  const allDates = new Set(datedCards.map((card) => card.found_date));
  const candidates = collectAreaCandidates(datedCards);
  const automatic = automaticBaseCandidate(candidates, allDates.size);
  const preservedManual = automatic ? null : preservedManualCandidate(previous, candidates, allDates.size);
  const selected = automatic ?? preservedManual;
  const dateCount = allDates.size;

  let likelyBase;
  if (selected) {
    const percentage = Math.round((selected.date_count / Math.max(dateCount, 1)) * 100);
    const prefix = selected.origin === "preserved_manual"
      ? "保留既有人工判斷："
      : "自動早期訊號：";
    likelyBase = {
      area: selected.label,
      status: "early-signal",
      confidence: "medium",
      confidence_label: "中",
      reason: `${prefix}${selected.label} 出現在 ${selected.date_count} 個不同見つけた日，占全部 ${dateCount} 個有效日期的 ${percentage}%（跨 ${selected.span_days} 天）；仍只視為可能據點。`,
    };
  } else {
    likelyBase = {
      area: null,
      status: dateCount < 2 ? "insufficient-evidence" : "needs-review",
      confidence: "low",
      confidence_label: "低",
      reason: dateCount < 2
        ? `目前只有 ${dateCount} 個有效見つけた日；同一天多張仍只算一次，無法區分生活據點與單次旅行。`
        : `目前有 ${cards.length} 張、分布於 ${dateCount} 個有效見つけた日；尚無區域同時達到 3 個不同日期、跨 14 天且占至少 60% 的保守門檻。`,
    };
  }

  const nextProfile = {
    name,
    evidence_postcard_ids: evidenceIds,
    likely_base: likelyBase,
    frequent_areas: frequentAreas(candidates, dateCount),
    trip_clusters: shortTripClusters(candidates),
    avoid_send: {
      areas: [],
      reason: "暫不由早期據點訊號自動產生避免寄送區域；需要更高信心或人工確認。",
    },
    base_analysis: {
      version: analysisVersion,
      mode: "evidence-change",
      origin: selected?.origin ?? "none",
      evidence_fingerprint: fingerprint,
      evidence_count: cards.length,
      dated_observation_count: dateCount,
      thresholds: {
        minimum_dates: minimumAutomaticDates,
        minimum_span_days: minimumAutomaticSpanDays,
        minimum_share: minimumAutomaticShare,
      },
    },
  };
  if (previous?.avatar) nextProfile.avatar = previous.avatar;
  return nextProfile;
}

function confirmedSender(postcard) {
  if (!postcard?.sender) return false;
  return !postcard.acquisition || postcard.acquisition.sender_status === "confirmed";
}

function evidencePostcardIds(cards) {
  return cards.filter(confirmedSender).map((card) => card.id).sort();
}

function collectAreaCandidates(cards) {
  const byKey = new Map();
  for (const card of cards) {
    for (const areaValue of areaHierarchy(card.location ?? {})) {
      const key = `${areaValue.level}\0${areaValue.label}`;
      const entry = byKey.get(key) ?? { ...areaValue, dates: new Set() };
      entry.dates.add(card.found_date);
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()].map((entry) => {
    const dates = [...entry.dates].sort();
    return {
      level: entry.level,
      label: entry.label,
      date_count: dates.length,
      first_date: dates[0] ?? null,
      last_date: dates.at(-1) ?? null,
      span_days: dateSpanDays(dates),
    };
  });
}

function automaticBaseCandidate(candidates, totalDates) {
  for (const level of ["local", "metro", "region"]) {
    const atLevel = candidates
      .filter((candidate) => candidate.level === level)
      .sort(candidateSort);
    const best = atLevel[0];
    const runnerUp = atLevel[1];
    if (
      best
      && best.date_count >= minimumAutomaticDates
      && best.span_days >= minimumAutomaticSpanDays
      && best.date_count / Math.max(totalDates, 1) >= minimumAutomaticShare
      && (!runnerUp || best.date_count > runnerUp.date_count)
    ) {
      return { ...best, origin: "automatic" };
    }
  }
  return null;
}

function preservedManualCandidate(previous, candidates, totalDates) {
  const areaValue = previous?.likely_base?.area;
  const origin = previous?.base_analysis?.origin;
  if (!areaValue || origin === "automatic") return null;
  const match = candidates.find((candidate) => candidate.label === areaValue);
  if (!match || match.date_count < 2 || match.date_count / Math.max(totalDates, 1) < 0.5) return null;
  return { ...match, origin: "preserved_manual" };
}

function frequentAreas(candidates, totalDates) {
  return candidates
    .filter((candidate) => candidate.level === "local" && candidate.date_count >= 2)
    .sort(candidateSort)
    .slice(0, 3)
    .map((candidate) => ({
      area: candidate.label,
      date_count: candidate.date_count,
      share: Number((candidate.date_count / Math.max(totalDates, 1)).toFixed(2)),
    }));
}

function shortTripClusters(candidates) {
  return candidates
    .filter((candidate) => candidate.level === "local" && candidate.date_count >= 2 && candidate.span_days < minimumAutomaticSpanDays)
    .sort(candidateSort)
    .slice(0, 3)
    .map((candidate) => ({
      area: candidate.label,
      date_count: candidate.date_count,
      first_date: candidate.first_date,
      last_date: candidate.last_date,
      status: "possible-trip-cluster",
    }));
}

function areaHierarchy(location) {
  const code = String(location.country_code ?? "").toUpperCase();
  const country = clean(location.country_endonym ?? location.country);
  const source = clean(location.address_local ?? location.endonym ?? location.raw) ?? "";
  if (code === "TW" || country === "臺灣" || country === "台灣") return taiwanAreas(location, source);
  if (code === "JP" || country === "日本") return japanAreas(location, source);
  if (["HK", "MO"].includes(code) || ["香港", "澳門"].includes(country)) {
    return uniqueAreas([
      area("local", clean(location.district ?? location.locality ?? location.endonym)),
      area("metro", country),
    ]);
  }

  const city = clean(location.city);
  const district = clean(location.district ?? location.locality);
  const local = district || city || clean(location.endonym);
  const metro = city || clean(location.region);
  return uniqueAreas([
    area("local", withCountry(local, country)),
    area("metro", withCountry(metro, country)),
  ]);
}

function taiwanAreas(location, source) {
  const structuredCity = clean(location.city);
  const structuredDistrict = clean(location.district);
  const match = source.match(/^(.+?(?:縣|市))(.+?(?:區|鄉|鎮|市))/u);
  const city = normalizeTaiwanName(structuredCity || match?.[1]);
  const district = normalizeTaiwanName(structuredDistrict || match?.[2]);
  return uniqueAreas([
    area("local", city && district ? `${city}${district}` : null),
    area("metro", city),
  ]);
}

function japanAreas(location, source) {
  const match = source.match(/^(.+?[都道府県])(.+?(?:市|区|町|村))/u);
  const region = clean(location.region) || match?.[1] || null;
  const municipality = match?.[2] || clean(location.city ?? location.district);
  return uniqueAreas([
    area("local", region && municipality ? `${region}${municipality}` : municipality),
    area("region", region),
  ]);
}

function area(level, label) {
  return label ? { level, label } : null;
}

function uniqueAreas(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value || seen.has(value.label)) return false;
    seen.add(value.label);
    return true;
  });
}

function withCountry(value, country) {
  if (!value) return null;
  if (!country || value.includes(country)) return value;
  return `${value}, ${country}`;
}

function normalizeTaiwanName(value) {
  return clean(value)?.replace(/^台北/u, "臺北") ?? null;
}

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function candidateSort(left, right) {
  return right.date_count - left.date_count
    || right.span_days - left.span_days
    || left.label.localeCompare(right.label, "zh-Hant");
}

function dateSpanDays(dates) {
  if (dates.length < 2) return 0;
  return Math.round((Date.parse(`${dates.at(-1)}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86_400_000);
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
