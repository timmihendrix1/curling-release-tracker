import { describe, expect, it } from "vitest";
import {
  PROBE_LOG_KIND,
  PROBE_LOG_MAX_ENTRIES,
  PROBE_LOG_MAX_PAYLOAD_BYTES,
  appendProbeLogEntry,
  buildProbeExportFileName,
  buildProbeLogExport,
  buildProbeLogPayload,
  createEmptyProbeLog,
} from "../probe/probeLog";
import type { ProbeLog } from "../probe/probeLog";

function fill(count: number): ProbeLog {
  let log = createEmptyProbeLog();
  for (let index = 0; index < count; index += 1) {
    log = appendProbeLogEntry(
      log,
      { connectionEpoch: 1, direction: "none", kind: "test", message: `entry ${String(index)}` },
      index + 1,
      "2026-09-27T09:00:00.000Z"
    );
  }
  return log;
}

describe("probe log bounds", () => {
  it("keeps at most the retention ceiling and counts what it dropped", () => {
    const log = fill(PROBE_LOG_MAX_ENTRIES + 7);
    expect(log.entries).toHaveLength(PROBE_LOG_MAX_ENTRIES);
    expect(log.droppedEntryCount).toBe(7);
    // The OLDEST are the ones dropped, so the newest entry must survive.
    expect(log.entries.at(-1)?.message).toBe(`entry ${String(PROBE_LOG_MAX_ENTRIES + 6)}`);
  });

  it("truncates an oversized payload, keeps the real length, and counts the truncation", () => {
    const bytes = new Uint8Array(PROBE_LOG_MAX_PAYLOAD_BYTES + 10).fill(0xab);
    const payload = buildProbeLogPayload(bytes);
    expect(payload.byteLength).toBe(PROBE_LOG_MAX_PAYLOAD_BYTES + 10);
    expect(payload.truncatedByteCount).toBe(10);
    expect(payload.hex.split(" ")).toHaveLength(PROBE_LOG_MAX_PAYLOAD_BYTES);

    const log = appendProbeLogEntry(
      createEmptyProbeLog(),
      { connectionEpoch: 1, direction: "rx", kind: "notification", message: "x", payload },
      1,
      "2026-09-27T09:00:00.000Z"
    );
    expect(log.truncatedPayloadCount).toBe(1);
  });

  it("does not truncate a payload at exactly the ceiling", () => {
    const payload = buildProbeLogPayload(new Uint8Array(PROBE_LOG_MAX_PAYLOAD_BYTES));
    expect(payload.truncatedByteCount).toBeUndefined();
  });

  it("appends immutably, so a snapshot already handed to the view is never mutated", () => {
    const first = fill(2);
    const second = appendProbeLogEntry(
      first,
      { connectionEpoch: 1, direction: "none", kind: "test", message: "third" },
      3,
      "2026-09-27T09:00:03.000Z"
    );
    expect(first.entries).toHaveLength(2);
    expect(second.entries).toHaveLength(3);
  });
});

describe("probe log export metadata", () => {
  it("declares the native iOS probe format, not the desktop diagnostic format", () => {
    const exported = buildProbeLogExport(fill(3), {
      exportedAt: "2026-09-27T09:10:00.000Z",
      platform: "ios",
      connections: [],
    });
    expect(exported.kind).toBe(PROBE_LOG_KIND);
    expect(exported.kind).not.toBe("brower-tci-ble-diagnostic-log");
    expect(exported.probe.transport).toContain("CoreBluetooth");
    expect(exported.probe.foregroundOnly).toBe(true);
    expect(exported.schemaVersion).toBe(1);
  });

  it("carries retention, counts, export time and connection epochs", () => {
    const log = fill(PROBE_LOG_MAX_ENTRIES + 3);
    const exported = buildProbeLogExport(log, {
      exportedAt: "2026-09-27T09:10:00.000Z",
      platform: "ios",
      connections: [
        {
          epoch: 1,
          peripheralId: "peripheral-1",
          deviceName: "BROWER TCi CH 0",
          selectionMode: "timing-service-filter",
          connectedAt: "2026-09-27T09:00:00.000Z",
          endedAt: "2026-09-27T09:05:00.000Z",
          endedBy: "user_disconnect",
        },
      ],
    });
    expect(exported.exportedAt).toBe("2026-09-27T09:10:00.000Z");
    expect(exported.entryCount).toBe(PROBE_LOG_MAX_ENTRIES);
    expect(exported.droppedEntryCount).toBe(3);
    expect(exported.retention.maxEntries).toBe(PROBE_LOG_MAX_ENTRIES);
    expect(exported.retention.storage).toContain("in-memory");
    expect(exported.connections).toHaveLength(1);
    expect(exported.connections[0]?.endedBy).toBe("user_disconnect");
  });

  it("states in the file itself that nothing was decoded and nothing was written", () => {
    const exported = buildProbeLogExport(fill(1), {
      exportedAt: "2026-09-27T09:10:00.000Z",
      platform: "ios",
      connections: [],
    });
    const notes = exported.notes.join(" ");
    expect(notes).toContain("never writes to the timer");
    expect(notes).toContain("No packet field has been decoded");
    expect(notes).toContain("no Profile");
  });

  it("produces a file name that carries no character illegal in a share destination", () => {
    const name = buildProbeExportFileName("2026-09-27T09:10:00.123Z");
    expect(name).toBe("brower-ios-probe-2026-09-27T09-10-00-123Z.json");
    expect(name).not.toContain(":");
  });
});
