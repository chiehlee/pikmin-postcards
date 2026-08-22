const missingDetailNote = "來源 bundle 記錄這張明信片曾有逐張研究，但匯出時原研究回合已不在可用的 compacted transcript 中，因此長版未能復原。此處保留缺漏狀態，避免用後來新寫的內容冒充原始研究。";

export function researchDetailFromSource({
  researchStatus,
  summary,
  detailBody = null,
  sourcePath,
}) {
  if (researchStatus === "prior_research_not_recovered_from_compacted_context") {
    return {
      status: "not_recovered",
      body: null,
      source_path: sourcePath,
      preservation_note: missingDetailNote,
    };
  }
  return {
    status: researchStatus === "raw-preserved" ? "raw_preserved" : "structured_preserved",
    body: detailBody?.trim() || summary,
    source_path: sourcePath,
    preservation_note: null,
  };
}

export function validateResearchDetail(record) {
  const detail = record.research?.detail;
  if (!detail) throw new Error(`${record.id} is missing research.detail`);
  if (!["raw_preserved", "structured_preserved", "not_recovered"].includes(detail.status)) {
    throw new Error(`${record.id} has an invalid research detail status`);
  }
  if (!detail.source_path) throw new Error(`${record.id} has no research detail source path`);
  if (detail.status === "not_recovered") {
    if (detail.body != null || !detail.preservation_note) {
      throw new Error(`${record.id} has inconsistent missing research detail`);
    }
  } else if (!detail.body?.trim() || detail.preservation_note != null) {
    throw new Error(`${record.id} has inconsistent preserved research detail`);
  }
  return detail;
}
