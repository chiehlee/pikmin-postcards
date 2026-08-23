import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function cssRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

test("postcard and long-form research dialogs retain independent scroll containers", async () => {
  const [css, page] = await Promise.all([
    readFile(path.join(projectRoot, "app/globals.css"), "utf8"),
    readFile(path.join(projectRoot, "app/page.tsx"), "utf8"),
  ]);

  const postcardScroll = cssRule(css, ".modal-copy");
  assert.match(postcardScroll, /min-height:\s*0/);
  assert.match(postcardScroll, /overflow-y:\s*auto/);
  assert.match(postcardScroll, /overscroll-behavior:\s*contain/);

  const researchScroll = cssRule(css, ".research-modal-scroll");
  assert.match(researchScroll, /min-height:\s*0/);
  assert.match(researchScroll, /overflow-y:\s*auto/);
  assert.match(researchScroll, /overscroll-behavior:\s*contain/);

  assert.match(page, /className="research-modal"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/);
  assert.match(page, /className="research-modal-scroll"/);
  assert.match(page, /onKeyDown=\{trapDialogFocus\}/);
  assert.match(page, /inert=\{researchOpen \|\| undefined\}/);
  assert.match(page, /researchTriggerRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(page, /<details className="detail-story">/);
});
