import { acquisitionFromEvidence } from "../lib/acquisition.mjs";

export const pendingResearchSummary = "目前只完成明信片畫面資訊的快速建檔，尚未進行地點、故事、地址、評分或關聯研究；可隨時使用「再研究」補完。";

export function metadataIntakeFields(result) {
  const visible = normalizeVisibleMetadata(result);
  const acquisition = acquisitionFromEvidence({
    sender: visible.sender,
    sendToFriendButtonVisible: visible.send_to_friend_visible,
    senderPanelVisible: visible.sender_panel_visible,
    senderAreaBlank: visible.sender_area_blank,
  });
  return {
    visible,
    acquisition,
    location: provisionalLocation(visible.game_location),
  };
}

export function pendingResearch(sourcePath) {
  return {
    status: "metadata_only_pending_research",
    confidence: "low",
    confidence_label: "低",
    summary: pendingResearchSummary,
    sources: [],
    confirmed_facts: [],
    inferences: [],
    unresolved_questions: ["尚未執行地點與故事研究。"],
    images: [],
    detail: {
      status: "structured_preserved",
      body: pendingResearchSummary,
      source_path: sourcePath,
      preservation_note: null,
    },
  };
}

function normalizeVisibleMetadata(result) {
  const visible = result?.visible;
  const poiName = typeof visible?.poi_name === "string" ? visible.poi_name.trim() : "";
  if (!poiName) throw new Error("快速建檔結果缺少可見的明信片名稱");
  const sender = typeof visible.sender === "string" && visible.sender.trim() ? visible.sender.trim() : null;
  if (sender && visible.send_to_friend_visible === true) {
    throw new Error("快速建檔結果同時辨識到寄件人與「フレンドに送る」，證據互相矛盾");
  }
  if (visible.found_date && !validCalendarDate(visible.found_date)) {
    throw new Error("快速建檔結果的見つけた日格式無效");
  }
  return {
    poi_name: poiName,
    game_location: typeof visible.game_location === "string" && visible.game_location.trim()
      ? visible.game_location.trim()
      : "地點未確認",
    found_date: visible.found_date ?? null,
    sender,
    send_to_friend_visible: nullableBoolean(visible.send_to_friend_visible),
    sender_panel_visible: nullableBoolean(visible.sender_panel_visible),
    sender_area_blank: nullableBoolean(visible.sender_area_blank),
    screenshot_notes: uniqueStrings(visible.screenshot_notes),
  };
}

function provisionalLocation(raw) {
  const value = raw?.trim() || "地點未確認";
  return {
    raw: value,
    display: value,
    city: null,
    district: null,
    locality: null,
    region: null,
    county: null,
    country: null,
    country_code: null,
    latitude: null,
    longitude: null,
    normalization_confidence: "low",
    endonym: value,
    zh_tw: null,
    language: "und",
    name_status: "provisional",
    name_confidence: "low",
    country_endonym: "",
    address_local: value,
    precision: "unknown",
  };
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nullableBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}
