function normalizeText(value) {
  return value == null
    ? ""
    : String(value).normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-Hant");
}

export function metadataKey(record) {
  const poiName = record.poi_name ?? record.poi;
  const foundDate = record.found_date;
  const sender = record.sender;
  const location = record.location?.raw
    ?? record.location_raw
    ?? record.location?.display
    ?? record.location_display;
  if (!poiName || !foundDate || !location) return null;
  const acquisitionType = record.acquisition?.type ?? record.acquisition_type ?? "unknown";
  const senderStatus = record.acquisition?.sender_status ?? record.sender_status ?? "unknown";
  const senderIdentity = sender
    ? `sender:${normalizeText(sender)}`
    : `origin:${normalizeText(acquisitionType)}:${normalizeText(senderStatus)}`;
  return [
    normalizeText(poiName),
    normalizeText(foundDate),
    senderIdentity,
    normalizeText(location),
  ].join("|");
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
        candidate: true,
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
        duplicate: false,
        candidate: true,
        match_type: "poi_found_date_sender_origin_location",
        confidence: "probable",
        record: probable,
      };
    }
  }

  return {
    duplicate: false,
    candidate: false,
    match_type: null,
    confidence: null,
    record: null,
  };
}
