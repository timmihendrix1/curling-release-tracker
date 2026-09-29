// The bounded, in-memory observation log for the native iOS probe.
//
// It never touches WebView storage, the Keychain, iCloud, a Profile, a training
// record or a network. It lives for exactly as long as the app process, and leaves
// the device only through an explicit, user-triggered share.
//
// It carries no account or credential, because the probe has neither. It DOES carry
// the iOS-assigned peripheral identifier and whatever raw bytes the timer sent — which
// can include real athlete records. The exporting UI says so and the exported file
// repeats it.
import { formatHexBytes } from "./browerProtocol";

/**
 * Version 1 of the *native iOS probe* log format.
 *
 * This is a DIFFERENT schema from the desktop diagnostic's
 * `brower-tci-ble-diagnostic-log` (src/lib/brower/diagnosticLog.ts), and it says so in
 * its own `kind`. Reusing that kind for a file with different fields, a different
 * transport and a different provenance would make every archived desktop export
 * ambiguous after the fact.
 */
export const PROBE_LOG_SCHEMA_VERSION = 1;
export const PROBE_LOG_KIND = "brower-tci-ios-native-ble-probe-log";

/** Ceiling on retained entries. Oldest are dropped first and counted. */
export const PROBE_LOG_MAX_ENTRIES = 500;

/**
 * Ceiling on retained bytes per logged payload. Documented packets are 20 bytes, so
 * this is generous for real traffic while bounding an unexpected flood.
 */
export const PROBE_LOG_MAX_PAYLOAD_BYTES = 64;

export type ProbeLogDirection = "rx" | "none";

export type ProbeLogPayload = {
  /** Uppercase space-separated hex of the RETAINED bytes. */
  hex: string;
  /** The payload's ACTUAL length on the wire, even when the retained bytes were truncated. */
  byteLength: number;
  /** Present only when the retained hex is shorter than `byteLength`. */
  truncatedByteCount?: number;
};

export type ProbeLogEntry = {
  sequence: number;
  at: string;
  /**
   * Which connection this entry belongs to. Zero means "no connection was established
   * when this happened" (initialisation, platform checks, export). An entry can then
   * never be silently read as belonging to the connection that happens to be current
   * when the file is opened.
   */
  connectionEpoch: number;
  direction: ProbeLogDirection;
  kind: string;
  message: string;
  uuid?: string;
  serviceUuid?: string;
  payload?: ProbeLogPayload;
  /** Fixed-vocabulary details only: observed properties, categories, counts. */
  detail?: Record<string, string | number | boolean>;
};

export type ProbeLog = {
  entries: ProbeLogEntry[];
  droppedEntryCount: number;
  truncatedPayloadCount: number;
};

export function createEmptyProbeLog(): ProbeLog {
  return { entries: [], droppedEntryCount: 0, truncatedPayloadCount: 0 };
}

export function buildProbeLogPayload(bytes: Uint8Array): ProbeLogPayload {
  if (bytes.byteLength <= PROBE_LOG_MAX_PAYLOAD_BYTES) {
    return { hex: formatHexBytes(bytes), byteLength: bytes.byteLength };
  }
  const retained = bytes.slice(0, PROBE_LOG_MAX_PAYLOAD_BYTES);
  return {
    hex: formatHexBytes(retained),
    byteLength: bytes.byteLength,
    truncatedByteCount: bytes.byteLength - PROBE_LOG_MAX_PAYLOAD_BYTES,
  };
}

export type ProbeLogInput = Omit<ProbeLogEntry, "sequence" | "at">;

/**
 * Returns a NEW log with one entry appended, evicting the oldest once the retention
 * ceiling is reached. Immutable, so a snapshot already handed to the view is never
 * mutated underneath it.
 */
export function appendProbeLogEntry(
  log: ProbeLog,
  input: ProbeLogInput,
  sequence: number,
  at: string
): ProbeLog {
  const entry: ProbeLogEntry = { sequence, at, ...input };
  const entries = [...log.entries, entry];
  let droppedEntryCount = log.droppedEntryCount;
  while (entries.length > PROBE_LOG_MAX_ENTRIES) {
    entries.shift();
    droppedEntryCount += 1;
  }
  return {
    entries,
    droppedEntryCount,
    truncatedPayloadCount:
      log.truncatedPayloadCount + (input.payload?.truncatedByteCount === undefined ? 0 : 1),
  };
}

/** One connection attempt that actually reached the device, and how it ended. */
export type ProbeConnectionEpoch = {
  epoch: number;
  /** iOS-assigned peripheral identifier. App- and device-scoped; NOT a manufacturer serial. */
  peripheralId: string;
  deviceName: string | null;
  /** How the device picker was opened for this connection. */
  selectionMode: "timing-service-filter" | "all-nearby";
  connectedAt: string;
  endedAt: string | null;
  /** Fixed vocabulary, never free text read off an error. */
  endedBy: "user_disconnect" | "unexpected_disconnect" | "backgrounded" | "released" | null;
};

export type ProbeLogExport = {
  schemaVersion: number;
  kind: typeof PROBE_LOG_KIND;
  probe: {
    name: "brower-ios-probe";
    /** What actually moved the bytes. Stated so a file can never be mistaken for a desktop export. */
    transport: "capacitor-community/bluetooth-le over iOS CoreBluetooth";
    /** The platform the probe believed it was running on when it exported. */
    platform: string;
    /** Foreground-only by declaration: no iOS background Bluetooth mode is enabled. */
    foregroundOnly: true;
  };
  exportedAt: string;
  entryCount: number;
  droppedEntryCount: number;
  truncatedPayloadCount: number;
  retention: {
    maxEntries: number;
    maxPayloadBytes: number;
    /** Restated in the file because it is the single most misread property of this log. */
    storage: "in-memory only; lost when the app process ends";
  };
  connections: ProbeConnectionEpoch[];
  notes: string[];
  entries: ProbeLogEntry[];
};

export type ProbeExportContext = {
  exportedAt: string;
  platform: string;
  connections: readonly ProbeConnectionEpoch[];
};

export function buildProbeLogExport(
  log: ProbeLog,
  context: ProbeExportContext
): ProbeLogExport {
  return {
    schemaVersion: PROBE_LOG_SCHEMA_VERSION,
    kind: PROBE_LOG_KIND,
    probe: {
      name: "brower-ios-probe",
      transport: "capacitor-community/bluetooth-le over iOS CoreBluetooth",
      platform: context.platform,
      foregroundOnly: true,
    },
    exportedAt: context.exportedAt,
    entryCount: log.entries.length,
    droppedEntryCount: log.droppedEntryCount,
    truncatedPayloadCount: log.truncatedPayloadCount,
    retention: {
      maxEntries: PROBE_LOG_MAX_ENTRIES,
      maxPayloadBytes: PROBE_LOG_MAX_PAYLOAD_BYTES,
      storage: "in-memory only; lost when the app process ends",
    },
    connections: [...context.connections],
    notes: [
      "Development-only native iOS BLE transport probe for the Brower TCi Timer. Not the Curling Performance Platform application.",
      "No training, assessment or exercise record was created, read or changed. This probe has no account, no Profile and no cloud connection.",
      "This probe never writes to the timer. No memory request, New Athlete, clear, channel or test command can be sent from it.",
      "Raw bytes are recorded exactly as received. No packet field has been decoded: the manufacturer document does not state the byte and nibble ordering, and Gate C is not passed.",
      "A notification carrying a zero first split is not established as a start event, and a notification carrying a non-zero first split is not established as a final result.",
      "This file can contain the iOS-assigned peripheral identifier and raw athlete records read from the timer.",
      "This is the native iOS probe format. It is NOT the desktop diagnostic format (brower-tci-ble-diagnostic-log).",
    ],
    entries: log.entries,
  };
}

export function serializeProbeLog(log: ProbeLog, context: ProbeExportContext): string {
  return JSON.stringify(buildProbeLogExport(log, context), null, 2);
}

/**
 * File name for one export. Colons are illegal in a file name on several of the
 * destinations a share sheet offers, so the ISO timestamp is flattened rather than
 * embedded as-is.
 */
export function buildProbeExportFileName(exportedAt: string): string {
  const stamp = exportedAt.replace(/[:.]/g, "-");
  return `brower-ios-probe-${stamp}.json`;
}
