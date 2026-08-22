import { acquisitionFromEvidence, validateAcquisition } from "../lib/acquisition.mjs";
import { rebuildFriends } from "../lib/friends.mjs";
import { backupDatabase, defaultDatabasePath, openDatabase, projectRoot } from "../db/database.mjs";
import {
  loadSnapshots,
  replaceDatabaseFromSnapshots,
  writeSnapshots,
} from "../db/snapshots.mjs";

const recoveredSenders = new Map([
  ["pc-0084", "유니"],
  ["pc-0126", "柳柳"],
  ["pc-0133", "柳柳"],
]);

const receivedWithoutConfirmedSender = new Map([
  ["pc-0045", { sendToFriendButtonVisible: false, senderAreaBlank: true }],
  ["pc-0056", { sendToFriendButtonVisible: false, senderAreaBlank: true }],
  ["pc-0083", { sendToFriendButtonVisible: false, senderPanelVisible: true }],
]);

const snapshots = await loadSnapshots();
const postcards = snapshots.postcards.postcards.map((source) => {
  const record = structuredClone(source);
  if (recoveredSenders.has(record.id)) record.sender = recoveredSenders.get(record.id);

  if (record.sender) {
    record.acquisition = acquisitionFromEvidence({ sender: record.sender });
    if (recoveredSenders.has(record.id)) {
      record.acquisition.evidence = ["sender-label-visible"];
    }
  } else if (receivedWithoutConfirmedSender.has(record.id)) {
    record.acquisition = acquisitionFromEvidence(receivedWithoutConfirmedSender.get(record.id));
    if (record.id === "pc-0083") record.acquisition.evidence.push("sender-name-unresolved");
  } else {
    record.acquisition = acquisitionFromEvidence({ sendToFriendButtonVisible: true });
  }
  validateAcquisition(record);
  return record;
});

const updatedSnapshots = {
  ...snapshots,
  postcards: {
    ...snapshots.postcards,
    schema_version: 2,
    source_principles: {
      ...snapshots.postcards.source_principles,
      null_sender_does_not_imply_unknown: true,
      send_to_friend_button_confirms_self_found: true,
    },
    postcards,
  },
  friends: rebuildFriends(postcards, snapshots.friends),
};

const counts = postcards.reduce((output, record) => {
  output.acquisition[record.acquisition.type] = (output.acquisition[record.acquisition.type] ?? 0) + 1;
  output.senderStatus[record.acquisition.sender_status] = (output.senderStatus[record.acquisition.sender_status] ?? 0) + 1;
  return output;
}, { acquisition: {}, senderStatus: {} });
const report = {
  postcards: postcards.length,
  acquisition: {
    self_found: counts.acquisition.self_found ?? 0,
    received: counts.acquisition.received ?? 0,
    unknown: counts.acquisition.unknown ?? 0,
  },
  sender_status: {
    confirmed: counts.senderStatus.confirmed ?? 0,
    unknown: counts.senderStatus.unknown ?? 0,
    not_applicable: counts.senderStatus.not_applicable ?? 0,
  },
  recovered_senders: Object.fromEntries(recoveredSenders),
  commit: process.argv.includes("--commit"),
};

if (!report.commit) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const backupPath = await backupDatabase(defaultDatabasePath);
const database = await openDatabase(defaultDatabasePath);
try {
  replaceDatabaseFromSnapshots(database, updatedSnapshots);
  await writeSnapshots(updatedSnapshots);
} finally {
  database.close();
}

console.log(JSON.stringify({
  ...report,
  database_backup: backupPath?.replace(`${projectRoot}/`, "") ?? null,
}, null, 2));
