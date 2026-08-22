function normalizeText(value) {
  return value == null
    ? ""
    : String(value).normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-Hant");
}

export function metadataKey(record) {
  const poiName = record.poi_name ?? record.poi;
  const foundDate = record.found_date;
  const sender = record.sender;
  if (!poiName || !foundDate) return null;
  return [normalizeText(poiName), normalizeText(foundDate), normalizeText(sender)].join("|");
}

export function findDuplicate(candidate, existingRecords) {
  const candidateHash = candidate.sha256 ?? candidate.asset?.sha256 ?? null;
  if (candidateHash) {
    const exact = existingRecords.find(
      (record) => (record.sha256 ?? record.asset?.sha256) === candidateHash,
    );
    if (exact) {
      return {
        duplicate: true,
        match_type: "sha256",
        confidence: "exact",
        record: exact,
      };
    }
  }

  const candidateKey = metadataKey(candidate);
  if (candidateKey) {
    const probable = existingRecords.find(
      (record) => metadataKey(record) === candidateKey,
    );
    if (probable) {
      return {
        duplicate: true,
        match_type: "poi_found_date_sender",
        confidence: "probable",
        record: probable,
      };
    }
  }

  return {
    duplicate: false,
    match_type: null,
    confidence: null,
    record: null,
  };
}
