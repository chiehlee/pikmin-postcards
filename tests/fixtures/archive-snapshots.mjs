import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function createEmptySnapshots() {
  return {
    postcards: {
      schema_version: 6,
      archive_name: "Pikmin Postcard Archive",
      source_principles: {
        found_date_is_sent_date: false,
        preserve_originals: true,
        unknown_sender_must_remain_null: true,
        null_sender_does_not_imply_unknown: true,
        send_to_friend_button_confirms_self_found: true,
      },
      postcards: [],
    },
    friends: { schema_version: 1, generated_from: "data/postcards.json", profiles: [] },
    imports: { schema_version: 1, imports: [] },
    context: { schema_version: 1, records: [] },
  };
}

export function createSyntheticSnapshots() {
  const snapshots = createEmptySnapshots();
  snapshots.postcards.postcards = [
    syntheticPostcard({ id: "pc-9001", poiName: "測試地標", address: "臺北市測試區範例路1號", latitude: 25.04, longitude: 121.52, assetSha: "1".repeat(64), relatedId: "pc-9002" }),
    syntheticPostcard({ id: "pc-9002", poiName: "測試地標", address: "臺北市測試區範例路2號", latitude: 25.041, longitude: 121.521, assetSha: "2".repeat(64), relatedId: "pc-9001" }),
  ];
  return snapshots;
}

export async function writeSnapshots(directory, snapshots = createSyntheticSnapshots()) {
  await mkdir(directory, { recursive: true });
  for (const [name, value] of Object.entries(snapshots)) {
    await writeFile(path.join(directory, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  }
}

function syntheticPostcard({ id, poiName, address, latitude, longitude, assetSha, relatedId }) {
  return {
    id,
    poi_name: poiName,
    found_date: "2026-01-02",
    received_at: null,
    archived_on: "2026-01-03",
    archived_at: "2026-01-03T04:05:06.000Z",
    sender: null,
    location: {
      raw: "Test District",
      display: address,
      city: "臺北市",
      district: "測試區",
      locality: null,
      region: null,
      county: null,
      country: "臺灣",
      country_code: "TW",
      latitude,
      longitude,
      normalization_confidence: "high",
      endonym: address,
      zh_tw: null,
      language: "zh-Hant-TW",
      name_status: "researched",
      name_confidence: "high",
      country_endonym: "臺灣",
      address_local: address,
      precision: "full_address",
      geocode: {
        status: "resolved",
        provider: "manual",
        query: address,
        matched_label: address,
        matched_type: "house",
        precision: "full_address",
        confidence: "high",
        resolved_at: "2026-01-03T04:05:06.000Z",
        attribution: "Synthetic test fixture",
        source_url: "https://example.com/test-location",
        osm_type: null,
        osm_id: null,
        error: null,
      },
    },
    asset: { path: `/images/fixtures/${id}.png`, sha256: assetSha, bytes: 16, media_type: "image/png", original_filename: `${id}.png` },
    curation: { rating: 4, recommendation: "保留", status: "keep", tags: ["synthetic-test"], personal_relevance: null },
    research: {
      status: "synthetic_fixture",
      confidence: "high",
      confidence_label: "高",
      summary: `${poiName} 的合成測試摘要。`,
      sources: ["https://example.com/test-source"],
      images: [],
      detail: { status: "structured_preserved", body: `${poiName} 的合成長版研究內容，只用於自動化測試。`, source_path: `research/raw/fixtures/${id}.md`, preservation_note: null },
    },
    provenance: [{ source_session: "synthetic-test", source_sequence: Number(id.slice(-1)), source_screenshot: `fixtures/${id}.png` }],
    related_postcards: [{ id: relatedId, relationship: "same-test-series", note: "兩張合成卡片用來驗證雙向關聯。" }],
    acquisition: { type: "self_found", sender_status: "not_applicable", confidence: "high", evidence: ["send-to-friend-button-visible"] },
  };
}
