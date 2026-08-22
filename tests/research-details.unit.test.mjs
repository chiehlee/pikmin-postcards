import assert from "node:assert/strict";
import test from "node:test";
import { researchDetailFromSource, validateResearchDetail } from "../lib/research-details.mjs";

test("unrecovered research stays explicitly missing", () => {
  const detail = researchDetailFromSource({
    researchStatus: "prior_research_not_recovered_from_compacted_context",
    summary: "condensed",
    detailBody: "must not impersonate the missing original",
    sourcePath: "research/raw/session.md",
  });
  assert.equal(detail.status, "not_recovered");
  assert.equal(detail.body, null);
  assert.match(detail.preservation_note, /長版未能復原/);
});

test("preserved research keeps a long body and falls back to the summary when needed", () => {
  assert.deepEqual(researchDetailFromSource({
    researchStatus: "raw-preserved",
    summary: "condensed",
    detailBody: "  long preserved note  ",
    sourcePath: "research/raw/current.md",
  }), {
    status: "raw_preserved",
    body: "long preserved note",
    source_path: "research/raw/current.md",
    preservation_note: null,
  });
  assert.equal(researchDetailFromSource({
    researchStatus: "researched",
    summary: "summary fallback",
    sourcePath: "research/raw/new.md",
  }).body, "summary fallback");
});

test("research detail validation rejects missing, invented, or contradictory preservation states", () => {
  const valid = {
    id: "pc-valid",
    research: {
      detail: {
        status: "structured_preserved",
        body: "Preserved detail",
        source_path: "research/raw/new.md",
        preservation_note: null,
      },
    },
  };
  assert.equal(validateResearchDetail(valid), valid.research.detail);

  const invalidDetails = [
    null,
    { status: "invented", body: "x", source_path: "x", preservation_note: null },
    { status: "raw_preserved", body: "x", source_path: "", preservation_note: null },
    { status: "not_recovered", body: "invented", source_path: "x", preservation_note: "missing" },
    { status: "not_recovered", body: null, source_path: "x", preservation_note: null },
    { status: "structured_preserved", body: "", source_path: "x", preservation_note: null },
    { status: "structured_preserved", body: "x", source_path: "x", preservation_note: "unexpected" },
  ];
  for (const detail of invalidDetails) {
    assert.throws(() => validateResearchDetail({ id: "invalid", research: { detail } }));
  }
});
