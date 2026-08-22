import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquisitionFromEvidence } from "../lib/acquisition.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceManifestPath = path.join(
  root,
  "imports/current-session/postcards_manifest.json",
);
const imageDir = path.join(root, "public/images/postcards/2026/05");
const outputPath = path.join(root, "data/postcards.json");
const sourceBundlePath = path.join(
  root,
  "imports/source-bundles/current-session-2026-08-23.zip",
);

const locations = {
  1: area("臺北市中正區", "臺北市", "中正區", "林興里", "臺灣", "TW"),
  2: area("臺北市中正區", "臺北市", "中正區", "梅花里", "臺灣", "TW"),
  3: area("Kajang, Selangor", "Kajang", null, null, "馬來西亞", "MY", "Selangor"),
  4: area("茨城縣ひたちなか市", "ひたちなか市", null, "湊本町", "日本", "JP", "茨城縣"),
  5: area("峇里島 Ubud", "Ubud", null, null, "印尼", "ID", "Bali", "Gianyar"),
  6: area("茨城縣ひたちなか市", "ひたちなか市", null, "阿字ヶ浦町", "日本", "JP", "茨城縣"),
  7: area("臺北市北投區", "臺北市", "北投區", "清江里", "臺灣", "TW"),
  8: area("臺北市北投區", "臺北市", "北投區", "大同里", "臺灣", "TW"),
  9: area("臺北市北投區", "臺北市", "北投區", "八仙里", "臺灣", "TW"),
  10: area("臺北市北投區", "臺北市", "北投區", "長安里", "臺灣", "TW"),
  11: area("臺北市北投區", "臺北市", "北投區", "清江里", "臺灣", "TW"),
  12: area("臺北市北投區", "臺北市", "北投區", "文化里", "臺灣", "TW"),
  13: area("臺北市北投區", "臺北市", "北投區", "長安里", "臺灣", "TW"),
  14: area("桃園市大園區", "桃園市", "大園區", "埔心里", "臺灣", "TW"),
  15: area("臺北市北投區", "臺北市", "北投區", "中心里", "臺灣", "TW"),
  16: area("臺北市北投區", "臺北市", "北投區", "開明里", "臺灣", "TW"),
  17: area("臺北市北投區", "臺北市", "北投區", "一德里", "臺灣", "TW"),
  18: area("臺北市信義區", "臺北市", "信義區", "新仁里", "臺灣", "TW"),
  19: area("臺北市大安區", "臺北市", "大安區", "華聲里", "臺灣", "TW"),
  20: area("臺北市信義區", "臺北市", "信義區", "安康里", "臺灣", "TW"),
};

const curationStatus = {
  1: "keep",
  2: "delete",
  3: "candidate",
  4: "keep",
  5: "keep",
  6: "keep",
  7: "keep",
  8: "representative",
  9: "keep",
  10: "keep",
  11: "representative",
  12: "keep",
  13: "delete",
  14: "keep",
  15: "keep",
  16: "keep",
  17: "candidate",
  18: "keep",
  19: "keep",
  20: "delete",
};

const tags = {
  1: ["Niantic 地標考古", "錯名 POI", "客家文化"],
  2: ["Niantic 地標考古", "怪趣味"],
  3: ["校園", "舊名", "時間膠囊"],
  4: ["漁港", "市場", "地方物產"],
  5: ["雕塑", "地方工藝"],
  6: ["壁畫", "現地創作", "海岸"],
  7: ["文化資產", "宗教", "北投地方史"],
  8: ["臺灣街景", "電信交接箱", "代表性收藏"],
  9: ["法鼓八式動禪", "系列收藏", "宗教"],
  10: ["河川", "都市變遷", "地方史"],
  11: ["臺灣街景", "電信交接箱", "北投市場"],
  12: ["政治雕塑", "藝術家工作室", "時代遺址"],
  13: ["公園導覽圖", "可替代"],
  14: ["壁畫", "機場", "視覺型收藏"],
  15: ["鐵道史", "郵筒", "新北投"],
  16: ["政治雕塑", "城市遺物", "定位待確認"],
  17: ["河川", "環境教育", "候補收藏"],
  18: ["漆作壁畫", "現地創作", "松山菸廠"],
  19: ["展演空間", "商業空間變遷", "華視"],
  20: ["商辦景觀", "可替代"],
};

const confidenceKeys = {
  高: "high",
  中高: "medium-high",
  中: "medium",
  低: "low",
};

function area(display, city, district, locality, country, countryCode, region = null, county = null) {
  return {
    display,
    city,
    district,
    locality,
    region,
    county,
    country,
    country_code: countryCode,
    latitude: null,
    longitude: null,
    normalization_confidence: "medium",
  };
}

async function sha256(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

const sourceRecords = JSON.parse(await readFile(sourceManifestPath, "utf8"));
const imageFiles = await readdir(imageDir);
const sourceBundleSha256 = await sha256(sourceBundlePath);

const postcards = await Promise.all(
  sourceRecords.map(async (source) => {
    const padded = String(source.seq).padStart(3, "0");
    const fileName = imageFiles.find((name) => name.startsWith(`pc-${padded}.`));
    if (!fileName) throw new Error(`Missing canonical image for sequence ${source.seq}`);

    const filePath = path.join(imageDir, fileName);
    const fileStats = await stat(filePath);
    const extension = path.extname(fileName).toLowerCase();

    return {
      id: `pc-${String(source.seq).padStart(4, "0")}`,
      poi_name: source.poi_name,
      found_date: source.found_date,
      received_at: null,
      archived_on: "2026-08-23",
      sender: source.sender,
      acquisition: acquisitionFromEvidence({
        sender: source.sender,
        sendToFriendButtonVisible: source.sender == null ? true : null,
      }),
      location: {
        raw: source.location_raw,
        ...locations[source.seq],
      },
      asset: {
        path: `/images/postcards/2026/05/${fileName}`,
        sha256: await sha256(filePath),
        bytes: fileStats.size,
        media_type: extension === ".png" ? "image/png" : "image/jpeg",
        original_filename: path.basename(source.screenshot),
      },
      curation: {
        rating: source.rating,
        recommendation: source.recommendation,
        status: curationStatus[source.seq],
        tags: tags[source.seq],
        personal_relevance: null,
      },
      research: {
        status: "raw-preserved",
        confidence: confidenceKeys[source.research_confidence],
        confidence_label: source.research_confidence,
        summary: source.research_summary,
        sources: source.sources,
      },
      provenance: [
        {
          source_session: "current-session",
          source_sequence: source.seq,
          source_bundle: "imports/source-bundles/current-session-2026-08-23.zip",
          source_bundle_sha256: sourceBundleSha256,
          source_screenshot: source.screenshot,
        },
      ],
    };
  }),
);

const output = {
  schema_version: 2,
  archive_name: "Pikmin Postcard Archive",
  source_principles: {
    found_date_is_sent_date: false,
    preserve_originals: true,
    unknown_sender_must_remain_null: true,
    null_sender_does_not_imply_unknown: true,
    send_to_friend_button_confirms_self_found: true,
  },
  postcards,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${postcards.length} canonical postcard records to ${outputPath}`);
