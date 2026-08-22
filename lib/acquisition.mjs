export function acquisitionFromEvidence({
  sender = null,
  sendToFriendButtonVisible = null,
  senderPanelVisible = null,
  senderAreaBlank = null,
} = {}) {
  if (sender) {
    return {
      type: "received",
      sender_status: "confirmed",
      confidence: "high",
      evidence: ["sender-confirmed"],
    };
  }
  if (sendToFriendButtonVisible === true) {
    return {
      type: "self_found",
      sender_status: "not_applicable",
      confidence: "high",
      evidence: ["send-to-friend-button-visible"],
    };
  }
  if (
    sendToFriendButtonVisible === false
    || senderPanelVisible === true
    || senderAreaBlank === true
  ) {
    const evidence = [];
    if (sendToFriendButtonVisible === false) evidence.push("send-to-friend-button-absent");
    if (senderPanelVisible === true) evidence.push("sender-panel-visible");
    if (senderAreaBlank === true) evidence.push("sender-area-blank");
    return {
      type: "received",
      sender_status: "unknown",
      confidence: "high",
      evidence,
    };
  }
  return {
    type: "unknown",
    sender_status: "unknown",
    confidence: "low",
    evidence: ["insufficient-ui-evidence"],
  };
}

export function validateAcquisition(record) {
  const acquisition = record.acquisition;
  if (!acquisition) throw new Error(`${record.id} is missing acquisition evidence`);
  if (record.sender && (
    acquisition.type !== "received"
    || acquisition.sender_status !== "confirmed"
  )) {
    throw new Error(`${record.id} has a sender but inconsistent acquisition data`);
  }
  if (!record.sender && acquisition.sender_status === "confirmed") {
    throw new Error(`${record.id} confirms a sender without a sender name`);
  }
  if (acquisition.type === "self_found" && acquisition.sender_status !== "not_applicable") {
    throw new Error(`${record.id} is self-found but still expects a sender`);
  }
  if (!Array.isArray(acquisition.evidence) || acquisition.evidence.length === 0) {
    throw new Error(`${record.id} has no acquisition evidence`);
  }
  return acquisition;
}
