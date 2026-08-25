import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResearchPrompt,
  buildMetadataPrompt,
  cancelBackgroundResearch,
  createBackgroundMetadata,
  createBackgroundResearch,
  extractMetadataResult,
  metadataSchema,
  extractResearchResult,
  researchSchema,
  verifyOpenAIConnection,
} from "../server/openai-research.mjs";

test("background response cancellation uses the server key and the response cancel endpoint", async () => {
  let captured;
  const result = await cancelBackgroundResearch({
    apiKey: "secret-cancel-key",
    responseId: "resp/cancel me",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return Response.json({ id: "resp/cancel me", status: "cancelled" });
    },
  });

  assert.equal(result.status, "cancelled");
  assert.equal(captured.url, "https://api.openai.com/v1/responses/resp%2Fcancel%20me/cancel");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.authorization, "Bearer secret-cancel-key");
  assert.equal(captured.options.body, undefined);
});

test("quick metadata request uses GPT-5.6's lowest supported reasoning and no web-search tool", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, body: JSON.parse(options.body) };
    return Response.json({ id: "resp-metadata", status: "queued" });
  };
  try {
    const prompt = buildMetadataPrompt({ intakeNote: "批次旅行" });
    const response = await createBackgroundMetadata({
      apiKey: "secret-test-key",
      model: "test-model",
      skill: "skill instructions",
      prompt,
      imageBytes: Buffer.from("test-image"),
      mediaType: "image/png",
    });
    assert.equal(response.id, "resp-metadata");
    assert.equal(captured.url, "https://api.openai.com/v1/responses");
    assert.deepEqual(captured.body.reasoning, { effort: "none" });
    assert.equal("tools" in captured.body, false);
    assert.equal(captured.body.text.format.name, "pikmin_postcard_visible_metadata");
    assert.match(prompt, /不是地方研究/);
    assert.match(prompt, /不使用 web search/);
    assert.match(prompt, /批次旅行/);
    assert.match(prompt, /sender_avatar_crop/);
    assert.deepEqual(metadataSchema.required, ["visible"]);
    assert.ok(metadataSchema.properties.visible.required.includes("sender_area_blank"));
    assert.ok(metadataSchema.properties.visible.required.includes("sender_avatar_crop"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("research request uses server authorization, background mode, web search, image input, and strict JSON", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return Response.json({ id: "resp-test", status: "queued" });
  };

  try {
    const prompt = buildResearchPrompt({
      kind: "reresearch",
      postcard: { id: "pc-test", poi_name: "測試" },
      userNote: "北投教會就在我經營的 Subway（大興街65號）隔壁。",
      relatedCandidates: [{ id: "pc-related", research_summary: "短候選" }],
    });
    const response = await createBackgroundResearch({
      apiKey: "secret-test-key",
      model: "test-model",
      reasoningEffort: "high",
      skill: "skill instructions",
      prompt,
      imageBytes: Buffer.from("test-image"),
      mediaType: "image/png",
    });

    assert.equal(response.id, "resp-test");
    assert.equal(captured.url, "https://api.openai.com/v1/responses");
    assert.equal(captured.options.headers.authorization, "Bearer secret-test-key");
    assert.ok(!captured.options.body.includes("secret-test-key"));
    assert.equal(captured.body.background, true);
    assert.equal(captured.body.store, false);
    assert.deepEqual(captured.body.reasoning, { effort: "high" });
    assert.deepEqual(captured.body.tools, [{ type: "web_search" }]);
    assert.equal(captured.body.text.format.type, "json_schema");
    assert.equal(captured.body.text.format.strict, true);
    assert.match(captured.body.input[0].content[1].image_url, /^data:image\/png;base64,/);
    assert.match(prompt, /有限關聯候選/);
    assert.match(prompt, /pc-related/);
    assert.match(prompt, /reference_images/);
    assert.match(prompt, /沒有可靠圖片就回傳空陣列/);
    assert.match(prompt, /full_address → road → locality → district → city → region → country → unknown/);
    assert.match(prompt, /不得從遊戲顯示地名或地圖搜尋結果猜門牌/);
    assert.match(prompt, /北投教會就在我經營的 Subway/);
    assert.match(prompt, /第一手／使用者提供內容/);
    assert.match(prompt, /不得冒充外部已證實事實/);
    assert.match(prompt, /不得生成或重畫人物/);
    assert.ok(researchSchema.required.includes("reference_images"));
    assert.ok(researchSchema.properties.visible.required.includes("sender_avatar_crop"));
    assert.match(researchSchema.properties.location.properties.address_local.description, /所有國家都先嘗試實際完整地址/);
    assert.deepEqual(researchSchema.properties.location.properties.coordinate_confidence.anyOf[1], { type: "null" });
    assert.equal(researchSchema.properties.reference_images.maxItems, 3);
    assert.deepEqual(
      researchSchema.properties.reference_images.items.required,
      ["source_page_url", "image_url", "caption", "alt", "credit"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("completed research must contain a web-search trace and structured output", () => {
  const result = { research: { summary: "研究摘要" } };
  assert.deepEqual(extractResearchResult({
    status: "completed",
    output: [
      { type: "web_search_call", id: "search-1", status: "completed" },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] },
    ],
  }), result);
  assert.throws(() => extractResearchResult({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
  }), /未留下 web search/);
});

test("completed quick metadata does not require a web-search trace", () => {
  const result = { visible: { poi_name: "快速建檔" } };
  assert.deepEqual(extractMetadataResult({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }],
  }), result);
  assert.throws(() => extractMetadataResult({ status: "completed", output: [] }), /沒有結構化畫面判讀結果/);
});

test("connection verification reports model visibility and redacts a key from errors", async () => {
  const verified = await verifyOpenAIConnection({
    apiKey: "sk-project-functional_123456789",
    model: "test-model",
    fetchImpl: async () => Response.json({ data: [{ id: "test-model" }, { id: "other-model" }] }),
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.model_available, true);
  assert.equal(verified.accessible_model_count, 2);

  await assert.rejects(
    verifyOpenAIConnection({
      apiKey: "sk-project-never_echo_123456789",
      model: "test-model",
      fetchImpl: async () => Response.json({
        error: { message: "bad sk-project-never_echo_123456789" },
      }, { status: 401 }),
    }),
    (error) => {
      assert.match(error.message, /\[REDACTED\]/);
      assert.doesNotMatch(error.message, /never_echo/);
      return true;
    },
  );
});
