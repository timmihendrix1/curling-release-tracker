// Failure classification for the native BLE probe.
//
// The whole point of this module is that different failures are DIFFERENT EVIDENCE.
// A discovery instrument that collapses "the user cancelled the picker", "Bluetooth is
// off", "permission was refused", "the query errored" and "the device genuinely does
// not have it" into one "failed" state manufactures conclusions: an operator would
// read "Serial Number: absent" and report that the unit lacks the service, when in
// fact the enumeration itself threw.
//
// Nothing here reads a message string off a thrown value into the log. The exported
// category is always one of this module's own literals, so an exported file can never
// carry text of unknown provenance.

export type ProbeFailureCategory =
  | "unsupported_platform"
  | "bluetooth_unavailable"
  | "permission_denied"
  | "user_cancelled"
  | "device_not_found"
  | "not_connected"
  | "unexpected_disconnect"
  | "operation_failed"
  | "timeout"
  | "unknown_error";

export type ProbeFailure = {
  category: ProbeFailureCategory;
  /** Operator-facing sentence. Fixed text chosen from the category, never the raw error. */
  message: string;
};

const FAILURE_MESSAGES: Record<ProbeFailureCategory, string> = {
  unsupported_platform:
    "This probe needs native iOS Bluetooth. It does nothing in a browser or the iOS Simulator.",
  bluetooth_unavailable:
    "Bluetooth is off or unavailable on this iPhone. Turn Bluetooth on, then initialise again.",
  permission_denied:
    "Bluetooth permission was refused for this app. Grant it in iOS Settings, then initialise again.",
  user_cancelled: "Device selection was cancelled. Nothing was connected.",
  device_not_found:
    "No device was selected. Either none was in range, or the picker found nothing matching.",
  not_connected: "No device is connected, so that operation was not attempted.",
  unexpected_disconnect:
    "The device disconnected on its own. Select it again to reconnect — this probe never reconnects by itself.",
  operation_failed: "The device did not complete that operation.",
  timeout: "The device did not answer in time.",
  unknown_error: "The operation failed for a reason this probe could not classify.",
};

/**
 * The substrings this probe is willing to recognise in a native error, and what each
 * one means.
 *
 * Matching on text is unpleasant, and it is used here because the Capacitor BLE bridge
 * surfaces failures as plain `Error`s with no stable machine-readable code. The
 * consequence is stated rather than hidden: an unrecognised failure becomes
 * `unknown_error`, which is an honest "not classified" — it is never upgraded into a
 * confident category, and in particular never into `device_not_found`, because "the
 * device does not have this" is a claim about hardware that a failed query cannot
 * support.
 *
 * Order matters: the first match wins, so more specific phrases are listed first.
 */
const NATIVE_ERROR_SIGNATURES: readonly {
  pattern: RegExp;
  category: ProbeFailureCategory;
}[] = [
  { pattern: /request.*cancell?ed|cancell?ed.*request/i, category: "user_cancelled" },
  { pattern: /user cancell?ed|dismissed/i, category: "user_cancelled" },
  { pattern: /unauthorized|unauthorised|not authorized|denied/i, category: "permission_denied" },
  { pattern: /bluetooth.*(off|disabled|unavailable|not available|poweredOff)/i, category: "bluetooth_unavailable" },
  { pattern: /powered\s*off|unsupported/i, category: "bluetooth_unavailable" },
  { pattern: /no device found|device not found|not found/i, category: "device_not_found" },
  { pattern: /not connected|disconnected/i, category: "not_connected" },
  { pattern: /timeout|timed out/i, category: "timeout" },
];

function readErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

export function classifyProbeError(error: unknown): ProbeFailureCategory {
  const text = readErrorText(error);
  if (text.length === 0) return "unknown_error";
  for (const signature of NATIVE_ERROR_SIGNATURES) {
    if (signature.pattern.test(text)) return signature.category;
  }
  return "unknown_error";
}

export function describeFailure(category: ProbeFailureCategory): ProbeFailure {
  return { category, message: FAILURE_MESSAGES[category] };
}

export function failureFromError(error: unknown): ProbeFailure {
  return describeFailure(classifyProbeError(error));
}
