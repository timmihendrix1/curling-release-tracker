// Centralised English copy for the migration recovery interface — Stage M3b4c
// (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §6; UX Writing Guidelines §§15, 31–32).
//
// UG-3: the interface is English. G1–G3 translate the labels the user approved
// in German, and the halt sentence translates the approved halt example; G4 was
// added by UG-1/UG-2. No localisation infrastructure and no language selector.
//
// Rules every string here follows:
//   - never "all data is safe", "nothing changed", "no data was lost" or an
//     equivalent the evidence does not establish (§6.2);
//   - an unknown write outcome is never described as a rollback or as no effect;
//   - no repair, reset, reinstall, "continue anyway", "choose a copy" or contact
//     advice (§6.5, §6.7);
//   - no key name, value, identifier, store name or platform text.
import type { MigrationExplanation, MigrationGroup } from "../../lib/persistence/nativeMigrationPresentation";

/** §6.2 — group labels. G1–G3 translate the approved German labels (UG-3). */
export const MIGRATION_GROUP_TITLE: Readonly<Record<MigrationGroup, string>> = {
  // „Vorbereitung läuft"
  G1: "Preparation in progress",
  // „Übertragung angehalten – erneute Prüfung möglich"
  G2: "Transfer paused — it can be checked again",
  // „Widersprüchliche Daten – Wiederherstellung erforderlich"
  G3: "Conflicting data — recovery required",
  // UG-1/UG-2: the neutral group.
  G4: "The transfer cannot continue in this version",
};

/** The approved halt example (UG-3 translation). */
export const MIGRATION_HALT_SENTENCE =
  "The data transfer has paused. Before it can continue, the app must check the stored state again.";

export const MIGRATION_RUNNING_TEXT = "The app is preparing this device's storage for your training data.";

/**
 * The owner disposed the session (the screen is closing). Terminal; mirrors the
 * existing gate's wording for a closed composition.
 */
export const MIGRATION_ENDED_TITLE = "Storage check closed";
export const MIGRATION_ENDED_TEXT =
  "This screen's connection to the device's storage was closed. Reopen the app to continue.";

/** §6.4 — shown only after a presentation-only delay while a run has not answered. */
export const MIGRATION_WAITING_TEXT =
  "Still waiting for the device's storage to respond. The app keeps waiting and does not start another attempt.";

/** One explanation per observed cause. */
export const MIGRATION_EXPLANATION_TEXT: Readonly<Record<MigrationExplanation, readonly string[]>> = {
  // G2
  read_unavailable: ["The app could not read the stored state of the transfer. A new check may succeed."],
  active_target_unavailable: ["The training data stored on this device cannot be read right now."],
  warm_check_unreadable: [
    "The app could not yet check the step it was completing when the transfer stopped.",
  ],
  halt_unknown_outcome: [MIGRATION_HALT_SENTENCE, "The app could not confirm whether the last step was saved."],
  halt_step_not_completed: [MIGRATION_HALT_SENTENCE, "A step could not be completed. That step did not write anything."],
  reopen_failed: ["The app could not reconnect to the device's storage. It reads nothing until the connection is re-established."],
  storage_busy_elsewhere: [
    "The device's storage is in use by another operation. The transfer waits for that operation to finish and does not take over.",
  ],
  reopen_required: ["The app must reconnect to the device's storage before it can check the stored state again."],
  bound_reached: ["Preparation is not finished yet. Check again to continue."],
  // G3
  fault_detected: ["The stored state contradicts what the app just wrote, so the transfer has stopped."],
  latch_present: ["An earlier check found contradictory data, so the transfer stays stopped."],
  halt_contradiction: ["The transfer stopped because the stored data does not match what the transfer recorded."],
  record_inconsistent: ["The record that tracks the transfer is inconsistent."],
  rows_without_record: ["The device's new storage already holds data, but there is no record of a transfer."],
  marker_without_record: ["The previous storage refers to a transfer record that is missing."],
  marker_foreign: ["The previous storage belongs to a different transfer attempt."],
  marker_invalid: ["The link between the previous storage and the transfer is invalid."],
  staging_inconsistent: ["Data prepared for the transfer does not match the transfer record."],
  entry_key_vanished: ["Data that was present when the transfer began is now missing from the previous storage."],
  source_diverged: ["The previous storage changed after the transfer began."],
  // G4
  version_newer: [
    "The stored transfer record was written by a newer version of the app.",
    "A compatible version of the app is needed to continue.",
  ],
  version_older: [
    "The stored transfer record uses an older format.",
    "There is no approved way to continue from this format.",
  ],
  internal_check: ["An internal check could not be completed."],
  handover_failed: ["The prepared storage could not be released for use, so the app cannot continue in this session."],
};

/** Progressive disclosure: what the group means and what the user can do now. */
export const MIGRATION_HELP_TEXT: Readonly<Record<"G2" | "G3" | "G4", readonly string[]>> = {
  G2: [
    "The app could not finish checking the stored state. This can happen when the device's storage does not answer or a step could not be confirmed.",
    "Choose Check again. The app continues on its own only when every check passes.",
  ],
  G3: [
    "The app found stored data that contradicts itself or the transfer record. Continuing automatically could replace or lose data, so the transfer stays stopped.",
    "This version of the app has no way to repair this. The app does not delete, replace or choose between the stored data.",
  ],
  G4: [
    "This version of the app cannot continue from the stored state, so it does not offer to check again.",
    "The app does not delete, replace or convert the stored data.",
  ],
};

export const MIGRATION_COPY = {
  recheck: "Check again",
  recheckRunning: "Checking…",
  detailsSummary: "Technical details",
  helpSummary: "What does this mean?",
  codeLabel: "Error code",
  createReport: "Create diagnostic report",
  copyReport: "Copy report",
  reportLabel: "Diagnostic report",
  reportNote:
    "The report contains codes only — no training data, account details or identifiers. It is not sent anywhere and is not a backup.",
  copied: "Report copied.",
  copyFailed: "The report could not be copied. You can select the text above and copy it.",
  copyUnavailable: "Copying is not available here. You can select the text above and copy it.",
  retirementStalled:
    "Note: the previous storage could not be checked, so it was not cleaned up. This does not affect the data in use.",
  retirementDeclined:
    "Note: some data in the previous storage was kept rather than cleaned up, because it differs from the transferred copy or could not be checked. This does not affect the data in use.",
} as const;
