import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResearchPrompt,
  createBackgroundResearch,
  extractResearchResult,
} from "../server/openai-research.mjs";

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
      relatedCandidates: [{ id: "pc-related", research_summary: "短候選" }],
    });
    const response = await createBackgroundResearch({
      apiKey: "secret-test-key",
      model: "test-model",
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
    assert.deepEqual(captured.body.tools, [{ type: "web_search" }]);
    assert.equal(captured.body.text.format.type, "json_schema");
    assert.equal(captured.body.text.format.strict, true);
    assert.match(captured.body.input[0].content[1].image_url, /^data:image\/png;base64,/);
    assert.match(prompt, /有限關聯候選/);
    assert.match(prompt, /pc-related/);
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
