const apiBase = "https://api.openai.com/v1";

export const defaultResearchModel = "gpt-5.6";

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

export function buildResearchPrompt({ kind, postcard = null, intakeNote = "", relatedCandidates = [] }) {
  const operation = kind === "add"
    ? "分析這張尚未收錄的 Pikmin Bloom 明信片截圖，完成畫面判讀、地點與故事研究、收藏判斷。"
    : "重新研究這張既有 Pikmin Bloom 明信片。保留截圖可見 metadata，只有外部證據支持時才更新研究定位、研究稿、收藏判斷與關聯。";
  return [
    operation,
    "請使用 web search，實際開啟每個採用的來源。summary 是精簡版；detail_body 是可獨立閱讀的繁體中文長版研究，不得只是摘要換句話說。",
    "所有來源、事實、推論與未解問題要分開。找不到可靠證據時降低信心，不補造地址、座標、寄件人或故事。",
    "related_postcards 只能從下列有限候選中選；只有能用一句具體理由連起來時才回傳，弱候選直接略過。",
    intakeNote ? `使用者備註：${intakeNote}` : null,
    postcard ? `既有 canonical record：\n${JSON.stringify(postcard, null, 2)}` : null,
    `有限關聯候選：\n${JSON.stringify(relatedCandidates, null, 2)}`,
  ].filter(Boolean).join("\n\n");
}

export async function createBackgroundResearch({ apiKey, model, skill, prompt, imageBytes, mediaType }) {
  const response = await fetch(`${apiBase}/responses`, {
    method: "POST",
    headers: authorizationHeaders(apiKey),
    body: JSON.stringify({
      model,
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

export async function retrieveBackgroundResearch({ apiKey, responseId }) {
  const response = await fetch(`${apiBase}/responses/${encodeURIComponent(responseId)}`, {
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

const researchSchema = requiredObject({
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
    address_local: { type: "string" },
    precision: { type: "string", enum: ["country", "region", "city", "district", "locality", "road", "full_address", "coordinates", "unknown"] },
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
