// The bounded, in-memory diagnostic log.
//
// This is NOT a second sporting-data pipeline. It never touches localStorage,
// IndexedDB, the Profile-scoped sporting repositories, or the cloud; it lives for
// exactly as long as the diagnostic view is open, and leaves the process only through
// an explicit user-triggered download.
//
// It deliberately carries no account, Profile, session, credential or environment
// value — the controller that writes it has no access to any of those. What it *does*
// carry is the browser's device identifier and whatever raw bytes the timer sent,
// which can include real athlete records. The exporting UI says so.
import { formatHexBytes } from "./protocol";

export const BROWER_LOG_SCHEMA_VERSION = 1;

/** Ceiling on retained entries. Oldest entries are dropped first and counted. */
export const BROWER_LOG_MAX_ENTRIES = 500;

/**
 * Ceiling on the bytes retained per logged payload. The documented packets are 20
 * bytes and commands are 7, so this is generous for real traffic while still bounding
 * an unexpected flood of large values.
 */
export const BROWER_LOG_MAX_PAYLOAD_BYTES = 64;

export type BrowerLogDirection = "rx" | "tx" | "none";

export type BrowerLogPayload = {
  /** Uppercase space-separated hex of the retained bytes. */
  hex: string;
  /** The payload's ACTUAL length on the wire, even when the retained bytes were truncated. */
  byteLength: number;
  /** Present only when the retained hex is shorter than `byteLength`. */
  truncatedByteCount?: number;
};

export type BrowerLogEntry = {
  sequence: number;
  at: string;
  direction: BrowerLogDirection;
  kind: string;
  message: string;
  /** Characteristic or service UUID this entry concerns, when it concerns one. */
  uuid?: string;
  payload?: BrowerLogPayload;
  /** Free-form, protocol-neutral details (properties observed, chosen hypothesis, ...). */
  detail?: Record<string, string | number | boolean>;
};

export type BrowerDiagnosticLog = {
  entries: BrowerLogEntry[];
  /** Entries evicted because the retention ceiling was reached. */
  droppedEntryCount: number;
  /** Entries whose payload bytes were truncated for retention. */
  truncatedPayloadCount: number;
};

export function createEmptyDiagnosticLog(): BrowerDiagnosticLog {
  return { entries: [], droppedEntryCount: 0, truncatedPayloadCount: 0 };
}

export function buildLogPayload(bytes: Uint8Array): BrowerLogPayload {
  if (bytes.byteLength <= BROWER_LOG_MAX_PAYLOAD_BYTES) {
    return { hex: formatHexBytes(bytes), byteLength: bytes.byteLength };
  }
  const retained = bytes.slice(0, BROWER_LOG_MAX_PAYLOAD_BYTES);
  return {
    hex: formatHexBytes(retained),
    byteLength: bytes.byteLength,
    truncatedByteCount: bytes.byteLength - BROWER_LOG_MAX_PAYLOAD_BYTES,
  };
}

export type BrowerLogInput = Omit<BrowerLogEntry, "sequence" | "at">;

/**
 * Returns a NEW log with one entry appended, evicting the oldest entries once the
 * retention ceiling is reached. Immutable so React state updates stay plain value
 * replacements rather than in-place mutation of an object the view already rendered.
 */
export function appendLogEntry(
  log: BrowerDiagnosticLog,
  input: BrowerLogInput,
  sequence: number,
  at: string
): BrowerDiagnosticLog {
  const entry: BrowerLogEntry = { sequence, at, ...input };
  const entries = [...log.entries, entry];
  let droppedEntryCount = log.droppedEntryCount;
  while (entries.length > BROWER_LOG_MAX_ENTRIES) {
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

export type BrowerDiagnosticLogExport = {
  schemaVersion: number;
  kind: "brower-tci-ble-diagnostic-log";
  exportedAt: string;
  entryCount: number;
  droppedEntryCount: number;
  truncatedPayloadCount: number;
  retentionLimits: { maxEntries: number; maxPayloadBytes: number };
  /**
   * Restated inside the exported file so a log that has been emailed or attached to a
   * ticket still says what it is and is not.
   */
  notes: string[];
  entries: BrowerLogEntry[];
};

export function buildDiagnosticLogExport(
  log: BrowerDiagnosticLog,
  exportedAt: string
): BrowerDiagnosticLogExport {
  return {
    schemaVersion: BROWER_LOG_SCHEMA_VERSION,
    kind: "brower-tci-ble-diagnostic-log",
    exportedAt,
    entryCount: log.entries.length,
    droppedEntryCount: log.droppedEntryCount,
    truncatedPayloadCount: log.truncatedPayloadCount,
    retentionLimits: {
      maxEntries: BROWER_LOG_MAX_ENTRIES,
      maxPayloadBytes: BROWER_LOG_MAX_PAYLOAD_BYTES,
    },
    notes: [
      "Development-only Brower TCi BLE diagnostic. No training or assessment record was created or changed.",
      "Raw bytes are recorded exactly as received. No packet field has been decoded, because the manufacturer document does not state the byte or nibble ordering.",
      "A byte-order selection recorded here is an experimental hypothesis, not a confirmed encoding.",
      "This file can contain the browser's device identifier and raw athlete records read from the timer.",
    ],
    entries: log.entries,
  };
}

export function serializeDiagnosticLog(
  log: BrowerDiagnosticLog,
  exportedAt: string
): string {
  return JSON.stringify(buildDiagnosticLogExport(log, exportedAt), null, 2);
}

/**
 * Hands the serialized log to the browser as a download and releases the object URL
 * afterwards. Mirrors `src/lib/export.ts`'s `downloadCsv` mechanics rather than
 * inventing a second download convention.
 */
export function downloadDiagnosticLog(content: string, fileName: string) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    // Released even if the click/DOM steps throw, so a failed export cannot leak the
    // blob for the lifetime of the document.
    URL.revokeObjectURL(url);
  }
}
