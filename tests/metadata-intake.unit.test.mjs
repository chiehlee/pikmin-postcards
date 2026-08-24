import assert from "node:assert/strict";
import test from "node:test";
import {
  metadataIntakeFields,
  pendingResearch,
  pendingResearchSummary,
} from "../server/metadata-intake.mjs";

function result(overrides = {}) {
  return {
    visible: {
      poi_name: " 金字塔2 ",
      game_location: " Ankang, Xinyi District ",
      found_date: "2026-05-17",
      sender: null,
      send_to_friend_visible: true,
      sender_panel_visible: null,
      sender_area_blank: null,
      screenshot_notes: ["按鈕清楚", "按鈕清楚", ""],
      ...overrides,
    },
  };
}

test("quick intake keeps visible metadata provisional and derives self-found acquisition locally", () => {
  const fields = metadataIntakeFields(result());
  assert.equal(fields.visible.poi_name, "金字塔2");
  assert.equal(fields.visible.game_location, "Ankang, Xinyi District");
  assert.deepEqual(fields.visible.screenshot_notes, ["按鈕清楚"]);
  assert.deepEqual(fields.acquisition, {
    type: "self_found",
    sender_status: "not_applicable",
    confidence: "high",
    evidence: ["send-to-friend-button-visible"],
  });
  assert.equal(fields.location.raw, "Ankang, Xinyi District");
  assert.equal(fields.location.display, fields.location.raw);
  assert.equal(fields.location.language, "und");
  assert.equal(fields.location.name_status, "provisional");
  assert.equal(fields.location.precision, "unknown");
  assert.equal(fields.location.country, null);
});

test("quick intake preserves confirmed sender text without inventing research", () => {
  const fields = metadataIntakeFields(result({
    sender: " V ",
    send_to_friend_visible: false,
    sender_panel_visible: true,
  }));
  assert.equal(fields.visible.sender, "V");
  assert.equal(fields.acquisition.type, "received");
  assert.equal(fields.acquisition.sender_status, "confirmed");
  const research = pendingResearch("research/raw/pc-test-fast.md");
  assert.equal(research.status, "metadata_only_pending_research");
  assert.equal(research.summary, pendingResearchSummary);
  assert.equal(research.sources.length, 0);
  assert.equal(research.detail.body, pendingResearchSummary);
  assert.equal(research.detail.source_path, "research/raw/pc-test-fast.md");
});

test("quick intake keeps unreadable fields explicit and rejects contradictory or invalid output", () => {
  const fields = metadataIntakeFields(result({
    game_location: "",
    found_date: null,
    send_to_friend_visible: null,
  }));
  assert.equal(fields.visible.game_location, "地點未確認");
  assert.equal(fields.acquisition.type, "unknown");
  assert.throws(() => metadataIntakeFields(result({ poi_name: "" })), /缺少可見的明信片名稱/);
  assert.throws(() => metadataIntakeFields(result({ found_date: "2026-02-30" })), /見つけた日格式無效/);
  assert.throws(() => metadataIntakeFields(result({ sender: "V", send_to_friend_visible: true })), /證據互相矛盾/);
});
