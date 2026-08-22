import assert from "node:assert/strict";
import test from "node:test";
import { acquisitionFromEvidence, validateAcquisition } from "../lib/acquisition.mjs";

test("visible sender is classified as confirmed received evidence", () => {
  assert.deepEqual(acquisitionFromEvidence({ sender: "柳柳" }), {
    type: "received",
    sender_status: "confirmed",
    confidence: "high",
    evidence: ["sender-confirmed"],
  });
});

test("send-to-friend button classifies a postcard as self-found", () => {
  assert.deepEqual(acquisitionFromEvidence({ sendToFriendButtonVisible: true }), {
    type: "self_found",
    sender_status: "not_applicable",
    confidence: "high",
    evidence: ["send-to-friend-button-visible"],
  });
});

test("received postcard with a blank sender keeps every visible evidence signal", () => {
  assert.deepEqual(acquisitionFromEvidence({
    sendToFriendButtonVisible: false,
    senderPanelVisible: true,
    senderAreaBlank: true,
  }), {
    type: "received",
    sender_status: "unknown",
    confidence: "high",
    evidence: [
      "send-to-friend-button-absent",
      "sender-panel-visible",
      "sender-area-blank",
    ],
  });
});

test("missing UI evidence remains unknown instead of guessing a sender state", () => {
  assert.deepEqual(acquisitionFromEvidence(), {
    type: "unknown",
    sender_status: "unknown",
    confidence: "low",
    evidence: ["insufficient-ui-evidence"],
  });
});

test("acquisition validation accepts consistent evidence and rejects contradictory records", () => {
  const valid = {
    id: "pc-valid",
    sender: null,
    acquisition: acquisitionFromEvidence({ sendToFriendButtonVisible: true }),
  };
  assert.equal(validateAcquisition(valid), valid.acquisition);

  const invalidRecords = [
    { id: "missing", sender: null },
    {
      id: "sender-conflict",
      sender: "柳柳",
      acquisition: { type: "self_found", sender_status: "not_applicable", evidence: ["x"] },
    },
    {
      id: "confirmed-without-name",
      sender: null,
      acquisition: { type: "received", sender_status: "confirmed", evidence: ["x"] },
    },
    {
      id: "self-found-expects-sender",
      sender: null,
      acquisition: { type: "self_found", sender_status: "unknown", evidence: ["x"] },
    },
    {
      id: "no-evidence",
      sender: null,
      acquisition: { type: "unknown", sender_status: "unknown", evidence: [] },
    },
  ];
  for (const record of invalidRecords) assert.throws(() => validateAcquisition(record));
});
