// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWER_LOG_MAX_ENTRIES,
  BROWER_LOG_MAX_PAYLOAD_BYTES,
  BROWER_LOG_SCHEMA_VERSION,
  appendLogEntry,
  buildDiagnosticLogExport,
  buildLogPayload,
  createEmptyDiagnosticLog,
  downloadDiagnosticLog,
  serializeDiagnosticLog,
  type BrowerDiagnosticLog,
} from "../diagnosticLog";

afterEach(() => {
  vi.restoreAllMocks();
});

function logWith(entryCount: number): BrowerDiagnosticLog {
  let log = createEmptyDiagnosticLog();
  for (let index = 0; index < entryCount; index += 1) {
    log = appendLogEntry(
      log,
      { direction: "none", kind: "test_entry", message: `entry ${index}` },
      index + 1,
      "2026-09-25T10:00:00.000Z"
    );
  }
  return log;
}

describe("buildLogPayload", () => {
  it("retains short payloads in full", () => {
    const payload = buildLogPayload(new Uint8Array([0x55, 0x01, 0xaa]));
    expect(payload).toEqual({ hex: "55 01 AA", byteLength: 3 });
  });

  it("truncates an oversized payload and reports the real length", () => {
    const bytes = new Uint8Array(BROWER_LOG_MAX_PAYLOAD_BYTES + 5).fill(0xab);
    const payload = buildLogPayload(bytes);

    expect(payload.byteLength).toBe(BROWER_LOG_MAX_PAYLOAD_BYTES + 5);
    expect(payload.truncatedByteCount).toBe(5);
    expect(payload.hex.split(" ")).toHaveLength(BROWER_LOG_MAX_PAYLOAD_BYTES);
  });
});

describe("appendLogEntry", () => {
  it("appends without mutating the previous log value", () => {
    const first = logWith(1);
    const second = appendLogEntry(
      first,
      { direction: "rx", kind: "notification_received", message: "bytes" },
      2,
      "2026-09-25T10:00:01.000Z"
    );

    expect(first.entries).toHaveLength(1);
    expect(second.entries).toHaveLength(2);
    expect(second.entries[1]).toMatchObject({ sequence: 2, at: "2026-09-25T10:00:01.000Z" });
  });

  it("bounds retention and counts the entries it dropped", () => {
    const log = logWith(BROWER_LOG_MAX_ENTRIES + 7);

    expect(log.entries).toHaveLength(BROWER_LOG_MAX_ENTRIES);
    expect(log.droppedEntryCount).toBe(7);
    // The oldest entries were the ones evicted.
    expect(log.entries[0].sequence).toBe(8);
  });

  it("counts truncated payloads", () => {
    const bytes = new Uint8Array(BROWER_LOG_MAX_PAYLOAD_BYTES + 1).fill(1);
    const log = appendLogEntry(
      createEmptyDiagnosticLog(),
      {
        direction: "rx",
        kind: "notification_received",
        message: "bytes",
        payload: buildLogPayload(bytes),
      },
      1,
      "2026-09-25T10:00:00.000Z"
    );

    expect(log.truncatedPayloadCount).toBe(1);
  });
});

describe("buildDiagnosticLogExport", () => {
  it("produces a versioned structure carrying the observations and their limits", () => {
    const log = appendLogEntry(
      createEmptyDiagnosticLog(),
      {
        direction: "tx",
        kind: "command_write",
        message: "written",
        uuid: "bb8722a4-3810-4fd3-9321-f6cbdcc1ea4e",
        payload: buildLogPayload(new Uint8Array([0x55, 0x01, 0x01, 0x00, 0x03, 0x00, 0xaa])),
        detail: { byteOrderHypothesis: "little-endian", startAddress: 1, stopAddress: 3 },
      },
      1,
      "2026-09-25T10:00:00.000Z"
    );

    const exported = buildDiagnosticLogExport(log, "2026-09-25T10:05:00.000Z");

    expect(exported.schemaVersion).toBe(BROWER_LOG_SCHEMA_VERSION);
    expect(exported.kind).toBe("brower-tci-ble-diagnostic-log");
    expect(exported.exportedAt).toBe("2026-09-25T10:05:00.000Z");
    expect(exported.entryCount).toBe(1);
    expect(exported.retentionLimits).toEqual({
      maxEntries: BROWER_LOG_MAX_ENTRIES,
      maxPayloadBytes: BROWER_LOG_MAX_PAYLOAD_BYTES,
    });
    expect(exported.entries[0].payload?.hex).toBe("55 01 01 00 03 00 AA");
    expect(exported.entries[0].detail?.byteOrderHypothesis).toBe("little-endian");
  });

  it("restates that a byte order is a hypothesis and that the file can contain device data", () => {
    const exported = buildDiagnosticLogExport(logWith(1), "2026-09-25T10:05:00.000Z");
    const notes = exported.notes.join(" ");

    expect(notes).toContain("hypothesis");
    expect(notes).toContain("device identifier");
    expect(notes).toContain("No training or assessment record");
  });

  it("serializes to parseable JSON", () => {
    const serialized = serializeDiagnosticLog(logWith(2), "2026-09-25T10:05:00.000Z");
    const parsed: unknown = JSON.parse(serialized);

    expect(parsed).toMatchObject({ schemaVersion: 1, entryCount: 2 });
  });
});

describe("downloadDiagnosticLog", () => {
  it("downloads through an object URL and revokes it afterwards", () => {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadDiagnosticLog("{}", "log.json");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(document.querySelectorAll("a")).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it("still revokes the object URL when the click throws", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("synthetic download failure");
    });

    expect(() => downloadDiagnosticLog("{}", "log.json")).toThrow();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    vi.unstubAllGlobals();
  });
});
