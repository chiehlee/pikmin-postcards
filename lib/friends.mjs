export function rebuildFriends(postcards, previousArchive) {
  const previousByName = new Map(previousArchive.profiles.map((profile) => [profile.name, profile]));
  const groups = new Map();
  for (const postcard of postcards) {
    if (!postcard.sender) continue;
    if (!groups.has(postcard.sender)) groups.set(postcard.sender, []);
    groups.get(postcard.sender).push(postcard);
  }

  const profiles = [...groups.entries()]
    .map(([name, cards]) => {
      const evidenceIds = cards.map((card) => card.id).sort();
      const previous = previousByName.get(name);
      const previousIds = [...(previous?.evidence_postcard_ids ?? [])].sort();
      const evidenceUnchanged = previous && JSON.stringify(evidenceIds) === JSON.stringify(previousIds);
      if (evidenceUnchanged) return previous;

      const dateCount = new Set(cards.map((card) => card.found_date).filter(Boolean)).size;
      const reason = cards.length === 1
        ? "目前只有一張觀察，無法區分生活據點與單次旅行。"
        : `目前有 ${cards.length} 張、分布於 ${dateCount} 個見つけた日；新增資料尚未完成地點正規化與跨日群集審查，暫不推定據點。`;
      const nextProfile = {
        name,
        evidence_postcard_ids: evidenceIds,
        likely_base: {
          area: null,
          status: cards.length === 1 ? "insufficient-evidence" : "needs-review",
          confidence: "low",
          confidence_label: "低",
          reason,
        },
        frequent_areas: [],
        trip_clusters: [],
        avoid_send: {
          areas: [],
          reason: "無；尚未完成足以產生避免寄送建議的保守推論。",
        },
      };
      if (previous?.avatar) nextProfile.avatar = previous.avatar;
      return nextProfile;
    })
    .sort((left, right) =>
      right.evidence_postcard_ids.length - left.evidence_postcard_ids.length
      || left.name.localeCompare(right.name, "zh-Hant"),
    );

  return {
    schema_version: 1,
    generated_from: "data/postcards.json",
    profiles,
  };
}
