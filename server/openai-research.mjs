import { buildUserContributionPrompt } from "../lib/user-contribution.mjs";

const apiBase = "https://api.openai.com/v1";

export const defaultResearchModel = "gpt-5.6";
export const metadataReasoningEffort = "none";

export async function verifyOpenAIConnection({ apiKey, model, fetchImpl = globalThis.fetch }) {
  if (!apiKey) throw new Error("OPENAI_API_KEY 尚未設定");
  let response;
  try {
    response = await fetchImpl(`${apiBase}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const payload = await checkedJson(response);
    const models = Array.isArray(payload.data) ? payload.data : [];
    return {
      ok: true,
      checked_at: new Date().toISOString(),
      model,
      model_available: models.some((item) => item?.id === model),
      accessible_model_count: models.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI 連線測試失敗";
    throw new Error(message.split(apiKey).join("[REDACTED]"));
  }
}

export function buildResearchPrompt({ kind, postcard = null, intakeNote = "", userNote = null, relatedCandidates = [] }) {
  const operation = kind === "add"
    ? "分析這張尚未收錄的 Pikmin Bloom 明信片截圖，完成畫面判讀、地點與故事研究、收藏判斷。"
    : "重新研究這張既有 Pikmin Bloom 明信片。保留截圖可見 metadata，只有外部證據支持時才更新研究定位、研究稿、收藏判斷與關聯。";
  return [
    operation,
    "請使用 web search，實際開啟每個採用的來源。summary 是精簡版；detail_body 是可獨立閱讀的繁體中文長版研究，不得只是摘要換句話說。",
    "所有來源、事實、推論與未解問題要分開。找不到可靠證據時降低信心，不補造地址、座標、寄件人或故事。",
    "每次都要順便研究 POI／現物的實際地址，不限國家：先以官方或可靠來源嘗試 full_address；無法證實才依 full_address → road → locality → district → city → region → country → unknown 逐級退回。address_local 必須保存來源支持的最深層級，precision 必須與它一致；在 confirmed_facts 說明地址依據，若只能退回較粗層級則在 unresolved_questions 說明缺少什麼證據。不得從遊戲顯示地名或地圖搜尋結果猜門牌。",
    "若實際開啟的研究來源中有能直接說明該地點、現物或故事的圖片，可在 reference_images 提議 1–3 張；每張的 source_page_url 必須同時列在 research.sources，image_url 必須是可下載的直接 HTTP(S) 圖片網址，並提供繁體中文 caption、alt 與可確認的 credit。沒有可靠圖片就回傳空陣列，不用湊數、不得虛構或只放裝飾圖。",
    "related_postcards 只能從下列有限候選中選；只有能用一句具體理由連起來時才回傳，弱候選直接略過。",
    intakeNote ? `使用者備註：${intakeNote}` : null,
    buildUserContributionPrompt(userNote),
    postcard ? `既有 canonical record：\n${JSON.stringify(postcard, null, 2)}` : null,
    `有限關聯候選：\n${JSON.stringify(relatedCandidates, null, 2)}`,
  ].filter(Boolean).join("\n\n");
}

export function buildMetadataPrompt({ intakeNote = "" } = {}) {
  return [
    "這是快速建檔，不是地方研究。只讀取這張 Pikmin Bloom 截圖中直接可見的文字與介面證據，不使用 web search，也不推論地點故事、地址、座標、收藏評分或其他明信片關聯。",
    "辨識 POI 名稱、遊戲顯示地點、見つけた日、寄件人文字，以及フレンドに送る按鈕／寄件人區域是否可見。見つけた日是 found_date，不是寄送日期。",
    "保留畫面原文與原字體語言；看不清楚時使用 null、空字串或 screenshot_notes 說明，不要把檔名、常識或猜測補成正式 metadata。",
    intakeNote ? `使用者備註：${intakeNote}` : null,
  ].filter(Boolean).join("\n\n");
}

export async function createBackgroundResearch({ apiKey, model, reasoningEffort, skill, prompt, imageBytes, mediaType }) {
  const response = await fetch(`${apiBase}/responses`, {
    method: "POST",
    headers: authorizationHeaders(apiKey),
    body: JSON.stringify({
      model,
      reasoning: { effort: reasoningEffort },
      background: true,
      store: false,
      instructions: skill,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: `data:${mediaType};base64,${imageBytes.toString("base64")}`, detail: "high" },
        ],
      }],
      tools: [{ type: "web_search" }],
      text: {
        format: {
          type: "json_schema",
          name: "pikmin_postcard_research",
          strict: true,
          schema: researchSchema,
        },
      },
    }),
  });
  return checkedJson(response);
}

export async function createBackgroundMetadata({ apiKey, model, skill, prompt, imageBytes, mediaType }) {
  const response = await fetch(`${apiBase}/responses`, {
    method: "POST",
    headers: authorizationHeaders(apiKey),
    body: JSON.stringify({
      model,
      reasoning: { effort: metadataReasoningEffort },
      background: true,
      store: false,
      instructions: skill,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: `data:${mediaType};base64,${imageBytes.toString("base64")}`, detail: "high" },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "pikmin_postcard_visible_metadata",
          strict: true,
          schema: metadataSchema,
        },
      },
    }),
  });
  return checkedJson(response);
}

export async function retrieveBackgroundResearch({ apiKey, responseId }) {
  const response = await fetch(`${apiBase}/responses/${encodeURIComponent(responseId)}`, {
    headers: authorizationHeaders(apiKey),
  });
  return checkedJson(response);
}

export async function cancelBackgroundResearch({ apiKey, responseId, fetchImpl = globalThis.fetch }) {
  if (!responseId) throw new Error("OpenAI 背景工作缺少 response ID");
  const response = await fetchImpl(`${apiBase}/responses/${encodeURIComponent(responseId)}/cancel`, {
    method: "POST",
    headers: authorizationHeaders(apiKey),
  });
  return checkedJson(response);
}

export function extractResearchResult(response) {
  if (response.status !== "completed") throw new Error(`AI response 尚未完成（${response.status}）`);
  if (!(response.output ?? []).some((item) => item.type === "web_search_call")) {
    throw new Error("AI response 未留下 web search 工具紀錄，不能寫入研究來源");
  }
  const text = (response.output ?? [])
    .flatMap((item) => item.type === "message" ? item.content ?? [] : [])
    .find((content) => content.type === "output_text")?.text;
  if (!text) throw new Error("AI response 沒有結構化研究結果");
  return JSON.parse(text);
}

export function extractMetadataResult(response) {
  if (response.status !== "completed") throw new Error(`AI response 尚未完成（${response.status}）`);
  const text = (response.output ?? [])
    .flatMap((item) => item.type === "message" ? item.content ?? [] : [])
    .find((content) => content.type === "output_text")?.text;
  if (!text) throw new Error("AI response 沒有結構化畫面判讀結果");
  return JSON.parse(text);
}

function authorizationHeaders(apiKey) {
  if (!apiKey) throw new Error("OPENAI_API_KEY 尚未設定");
  return { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
}

async function checkedJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message ?? `OpenAI API HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };
const requiredObject = (properties) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});

export const metadataSchema = requiredObject({
  visible: requiredObject({
    poi_name: { type: "string" },
    game_location: { type: "string" },
    found_date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    sender: nullableString,
    send_to_friend_visible: { type: ["boolean", "null"] },
    sender_panel_visible: { type: ["boolean", "null"] },
    sender_area_blank: { type: ["boolean", "null"] },
    screenshot_notes: { type: "array", items: { type: "string" } },
  }),
});

export const researchSchema = requiredObject({
  visible: requiredObject({
    poi_name: { type: "string" },
    game_location: { type: "string" },
    found_date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    sender: nullableString,
    send_to_friend_visible: { type: ["boolean", "null"] },
    screenshot_notes: { type: "array", items: { type: "string" } },
  }),
  acquisition: requiredObject({
    type: { type: "string", enum: ["self_found", "received", "unknown"] },
    sender_status: { type: "string", enum: ["not_applicable", "confirmed", "unknown"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    evidence: { type: "array", items: { type: "string" } },
  }),
  location: requiredObject({
    raw: { type: "string" },
    endonym: { type: "string" },
    zh_tw: nullableString,
    language: { type: "string" },
    name_status: { type: "string", enum: ["researched", "provisional"] },
    name_confidence: { type: "string", enum: ["high", "medium", "low"] },
    country: nullableString,
    country_code: nullableString,
    country_endonym: { type: "string" },
    address_local: { type: "string", description: "可靠來源能支持的最完整當地地址；所有國家都先嘗試實際完整地址，無法證實才逐級退回。" },
    precision: { type: "string", enum: ["country", "region", "city", "district", "locality", "road", "full_address", "coordinates", "unknown"], description: "address_local 的實際證據解析度，不得高於來源能支持的層級。" },
    city: nullableString,
    district: nullableString,
    locality: nullableString,
    region: nullableString,
    county: nullableString,
    latitude: nullableNumber,
    longitude: nullableNumber,
    normalization_confidence: { type: "string", enum: ["high", "medium", "low"] },
  }),
  research: requiredObject({
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    confidence_label: { type: "string", enum: ["高", "中", "低"] },
    summary: { type: "string" },
    detail_body: { type: "string" },
    confirmed_facts: { type: "array", items: { type: "string" } },
    inferences: { type: "array", items: { type: "string" } },
    unresolved_questions: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: { type: "string" } },
  }),
  reference_images: {
    type: "array",
    maxItems: 3,
    items: requiredObject({
      source_page_url: { type: "string" },
      image_url: { type: "string" },
      caption: { type: "string" },
      alt: { type: "string" },
      credit: nullableString,
    }),
  },
  curation: requiredObject({
    rating: nullableNumber,
    recommendation: nullableString,
    status: { type: "string", enum: ["keep", "representative", "candidate", "delete", "unreviewed"] },
    personal_relevance: nullableString,
    tags: { type: "array", items: { type: "string" } },
  }),
  related_postcards: {
    type: "array",
    items: requiredObject({
      id: { type: "string" },
      relationship: { type: "string", enum: ["same-metadata-different-image", "same-poi-name-variant", "same-place", "same-subject", "same-series", "historical-connection"] },
      note: { type: "string" },
    }),
  },
});
