import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUserContributionPrompt,
  maxUserContributionLength,
  normalizeUserContribution,
} from "../lib/user-contribution.mjs";

test("user contributions preserve meaningful text and discard empty drafts", () => {
  assert.equal(normalizeUserContribution(null), null);
  assert.equal(normalizeUserContribution("   \n"), null);
  assert.equal(
    normalizeUserContribution("  北投教會就在我經營的 Subway（大興街65號）隔壁。  "),
    "北投教會就在我經營的 Subway（大興街65號）隔壁。",
  );
});

test("user contribution limits reject invalid or oversized input", () => {
  assert.throws(() => normalizeUserContribution({ note: "not text" }), /必須是文字/);
  assert.throws(() => normalizeUserContribution("長".repeat(maxUserContributionLength + 1)), /最多 12,000 個字元/);
});

test("prompt labels user knowledge as preserved first-hand evidence, not external proof", () => {
  assert.equal(buildUserContributionPrompt("  "), null);
  const prompt = buildUserContributionPrompt("北投教會就在 Subway 隔壁。\n請查地址關係。");
  assert.match(prompt, /第一手／使用者提供內容/);
  assert.match(prompt, /不是外部來源/);
  assert.match(prompt, /不得冒充外部已證實事實/);
  assert.match(prompt, /北投教會就在 Subway 隔壁/);
  assert.match(prompt, /\\n請查地址關係/);
});
