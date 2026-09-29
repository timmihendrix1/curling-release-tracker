import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProbeController } from "../probe/probeController";
import type { ProbePlatform } from "../probe/transport";
import { PROBE_LOG_KIND } from "../probe/probeLog";
import {
  bothDocumentedServices,
  createFakeExportTarget,
  createFakeTransport,
  createStepClock,
} from "./fakes";

const IOS: ProbePlatform = { supported: true, platform: "ios" };

// ---------------------------------------------------------------------------
// Controller-side export behaviour
// ---------------------------------------------------------------------------

function buildWith(
  behaviour: Parameters<typeof createFakeExportTarget>[0]
) {
  const exportTarget = createFakeExportTarget(behaviour);
  const controller = createProbeController({
    platform: IOS,
    transport: createFakeTransport(),
    exportTarget,
    now: createStepClock(),
  });
  return { controller, exportTarget };
}

async function withObservations(
  behaviour?: Parameters<typeof createFakeExportTarget>[0]
) {
  const built = buildWith(behaviour);
  await built.controller.initializeBluetooth();
  await built.controller.connect("timing-service-filter");
  return built;
}

describe("exporting the observation log", () => {
  it("serialises the native iOS probe schema, with retention and connection metadata", async () => {
    const { controller, exportTarget } = await withObservations();

    const outcome = await controller.exportLog();

    expect(outcome.kind).toBe("shared");
    const call = exportTarget.calls.at(-1);
    expect(call?.fileName).toMatch(/^brower-ios-probe-.*\.json$/);
    const parsed = JSON.parse(call?.content ?? "{}") as Record<string, unknown>;
    expect(parsed["kind"]).toBe(PROBE_LOG_KIND);
    expect(parsed["exportedAt"]).toEqual(expect.any(String));
    expect(parsed["retention"]).toMatchObject({ maxEntries: 500, maxPayloadBytes: 64 });
    expect(Array.isArray(parsed["connections"])).toBe(true);
    expect((parsed["connections"] as unknown[]).length).toBe(1);
  });

  it("carries no account, credential or unrelated device information", async () => {
    const { controller, exportTarget } = await withObservations();
    await controller.exportLog();
    const parsed = JSON.parse(exportTarget.calls.at(-1)?.content ?? "{}") as Record<
      string,
      unknown
    >;

    // The fixed `notes` legitimately mention accounts and Profiles in order to state
    // that the probe has none, so the check is applied to the DATA the probe gathered.
    const gathered = JSON.stringify({
      entries: parsed["entries"],
      connections: parsed["connections"],
      probe: parsed["probe"],
    }).toLowerCase();

    for (const forbidden of [
      "token",
      "password",
      "credential",
      "profile",
      "supabase",
      "auth",
      "@",
    ]) {
      expect(gathered).not.toContain(forbidden);
    }
    // The one device identifier it does carry is the iOS peripheral id, and it is
    // named as such.
    expect(JSON.stringify(parsed["connections"])).toContain("peripheralId");
  });

  it("marks the log exported only after sharing actually completed", async () => {
    const { controller } = await withObservations();
    expect(controller.getSnapshot().hasUnexportedObservations).toBe(true);

    await controller.exportLog();

    expect(controller.getSnapshot().hasUnexportedObservations).toBe(false);
    expect(controller.getSnapshot().lastExport?.outcome).toBe("shared");
  });

  it("treats a cancelled share as cancellation, not as a saved file", async () => {
    const { controller } = await withObservations((fileName) => ({
      kind: "cancelled",
      fileName,
    }));

    const outcome = await controller.exportLog();

    expect(outcome.kind).toBe("cancelled");
    expect(controller.getSnapshot().hasUnexportedObservations).toBe(true);
    expect(controller.getSnapshot().lastExport?.outcome).toBe("cancelled");
    const entry = controller.getSnapshot().log.entries.at(-1);
    expect(entry?.kind).toBe("export_cancelled");
    expect(entry?.message).toContain("NOT saved");
  });

  it("treats a failed export as failure and keeps the observations unexported", async () => {
    const { controller } = await withObservations(() => ({
      kind: "failed",
      reason: "The log could not be written to this device's storage.",
    }));

    const outcome = await controller.exportLog();

    expect(outcome.kind).toBe("failed");
    expect(controller.getSnapshot().hasUnexportedObservations).toBe(true);
    expect(controller.getSnapshot().lastExport?.reason).toContain("could not be written");
  });

  it("survives an export target that throws rather than rejecting cleanly", async () => {
    const controller = createProbeController({
      platform: IOS,
      transport: createFakeTransport(),
      exportTarget: {
        exportJson: () => {
          throw new Error("unexpected");
        },
      },
      now: createStepClock(),
    });
    await controller.initializeBluetooth();

    const outcome = await controller.exportLog();

    expect(outcome.kind).toBe("failed");
    expect(controller.getSnapshot().hasUnexportedObservations).toBe(true);
  });

  it("still counts an observation that arrived while the share sheet was open", async () => {
    const transport = createFakeTransport();
    let release: () => void = () => undefined;
    const controller = createProbeController({
      platform: IOS,
      transport,
      exportTarget: {
        exportJson: (fileName) =>
          new Promise((resolve) => {
            release = () => {
              resolve({ kind: "shared", fileName });
            };
          }),
      },
      now: createStepClock(),
    });
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");
    await controller.startListening();

    const pending = controller.exportLog();
    // A packet arrives while the share sheet is still open: it is genuinely not in the
    // file that was serialised before the sheet opened.
    transport.emitNotification(new DataView(new Uint8Array([0x07]).buffer));
    release();
    await pending;

    expect(controller.getSnapshot().hasUnexportedObservations).toBe(true);
  });
});

describe("clearing the observation log", () => {
  it("warns before discarding observations no completed export has carried off-device", async () => {
    const { controller } = await withObservations();

    const first = controller.clearLog();

    expect(first).toMatchObject({ cleared: false, requiresConfirmation: true });
    expect(controller.getSnapshot().log.entries.length).toBeGreaterThan(0);
    if (!first.cleared) {
      expect(first.reason).toContain("no completed export has carried off this iPhone");
    }
  });

  it("clears once the operator confirms, and reports itself as exported afterwards", async () => {
    const { controller } = await withObservations();

    const result = controller.clearLog({ confirmed: true });

    expect(result).toEqual({ cleared: true });
    const snapshot = controller.getSnapshot();
    // Exactly one entry: the record that the clear happened.
    expect(snapshot.log.entries).toHaveLength(1);
    expect(snapshot.log.entries[0]?.kind).toBe("log_cleared");
    expect(snapshot.hasUnexportedObservations).toBe(false);
    expect(snapshot.reads).toHaveLength(0);
    expect(snapshot.notifications).toHaveLength(0);
  });

  it("does not warn when everything has already been exported", async () => {
    const { controller } = await withObservations();
    await controller.exportLog();

    expect(controller.clearLog()).toEqual({ cleared: true });
  });

  it("warns again after a cancelled export", async () => {
    const { controller } = await withObservations((fileName) => ({
      kind: "cancelled",
      fileName,
    }));
    await controller.exportLog();

    expect(controller.clearLog()).toMatchObject({ cleared: false });
  });
});

// ---------------------------------------------------------------------------
// The real Capacitor export target
// ---------------------------------------------------------------------------

const order: string[] = [];
const filesystem = {
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  readdir: vi.fn(),
};
const share = { share: vi.fn() };

/**
 * Re-establishes the order-recording implementations. `mockResolvedValue` REPLACES an
 * implementation rather than layering on it, so each test that wants a different
 * result has to keep recording the call itself — hence `mockImplementationOnce` below
 * rather than `mockRejectedValueOnce`.
 */
function resetNativeMocks(): void {
  order.length = 0;
  filesystem.mkdir.mockReset().mockImplementation(() => {
    order.push("mkdir");
    return Promise.resolve();
  });
  filesystem.writeFile.mockReset().mockImplementation(() => {
    order.push("writeFile");
    return Promise.resolve({ uri: "file:///cache/brower-ios-probe-exports/log.json" });
  });
  filesystem.deleteFile.mockReset().mockImplementation(() => {
    order.push("deleteFile");
    return Promise.resolve();
  });
  filesystem.readdir.mockReset().mockImplementation(() => {
    order.push("readdir");
    return Promise.resolve({ files: [] as { name: string }[] });
  });
  share.share.mockReset().mockImplementation(() => {
    order.push("share");
    return Promise.resolve({ activityType: "com.apple.UIKit.activity.Mail" });
  });
}

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: {
    mkdir: (options: unknown): unknown => filesystem.mkdir(options),
    writeFile: (options: unknown): unknown => filesystem.writeFile(options),
    deleteFile: (options: unknown): unknown => filesystem.deleteFile(options),
    readdir: (options: unknown): unknown => filesystem.readdir(options),
  },
  Directory: { Cache: "CACHE" },
  Encoding: { UTF8: "utf8" },
}));

vi.mock("@capacitor/share", () => ({
  Share: {
    share: (options: unknown): unknown => share.share(options),
  },
}));

describe("the native export target", () => {
  beforeEach(() => {
    resetNativeMocks();
  });

  it("writes the file, shares it, and only then deletes it", async () => {
    const { createCapacitorExportTarget } = await import("../probe/capacitorExportTarget");

    const outcome = await createCapacitorExportTarget().exportJson("log.json", "{}");

    expect(outcome).toEqual({ kind: "shared", fileName: "log.json" });
    expect(order.indexOf("writeFile")).toBeLessThan(order.indexOf("share"));
    expect(order.indexOf("share")).toBeLessThan(order.indexOf("deleteFile"));
    // Shared as a FILE, not as a link or as text.
    expect(share.share).toHaveBeenCalledWith(
      expect.objectContaining({
        files: ["file:///cache/brower-ios-probe-exports/log.json"],
      })
    );
  });

  it("classifies a dismissed share sheet as cancellation", async () => {
    share.share.mockImplementationOnce(() => {
      order.push("share");
      return Promise.reject(new Error("Share canceled"));
    });
    const { createCapacitorExportTarget } = await import("../probe/capacitorExportTarget");

    const outcome = await createCapacitorExportTarget().exportJson("log.json", "{}");

    expect(outcome).toEqual({ kind: "cancelled", fileName: "log.json" });
    // The temporary file is still cleaned up, but only after the sheet closed.
    expect(order.indexOf("share")).toBeLessThan(order.indexOf("deleteFile"));
  });

  it("reports a write failure without opening a share sheet", async () => {
    filesystem.writeFile.mockImplementationOnce(() =>
      Promise.reject(new Error("No space left on device"))
    );
    const { createCapacitorExportTarget } = await import("../probe/capacitorExportTarget");

    const outcome = await createCapacitorExportTarget().exportJson("log.json", "{}");

    expect(outcome.kind).toBe("failed");
    expect(share.share).not.toHaveBeenCalled();
    expect(filesystem.deleteFile).not.toHaveBeenCalled();
  });

  it("reports a share failure that is not a cancellation as a failure", async () => {
    share.share.mockImplementationOnce(() =>
      Promise.reject(new Error("Share is not supported"))
    );
    const { createCapacitorExportTarget } = await import("../probe/capacitorExportTarget");

    const outcome = await createCapacitorExportTarget().exportJson("log.json", "{}");

    expect(outcome.kind).toBe("failed");
  });

  it("does not let a cleanup failure turn a successful export into a failed one", async () => {
    filesystem.deleteFile.mockImplementation(() => Promise.reject(new Error("Busy")));
    const { createCapacitorExportTarget } = await import("../probe/capacitorExportTarget");

    const outcome = await createCapacitorExportTarget().exportJson("log.json", "{}");

    expect(outcome.kind).toBe("shared");
  });

  it("sweeps only the probe's own older export files", async () => {
    filesystem.readdir.mockImplementation(() =>
      Promise.resolve({
      files: [
        { name: "a-1.json" },
        { name: "a-2.json" },
        { name: "a-3.json" },
        { name: "a-4.json" },
        { name: "a-5.json" },
        { name: "a-6.json" },
        { name: "a-7.json" },
        { name: "unrelated.txt" },
      ],
      })
    );
    const { createCapacitorExportTarget } = await import("../probe/capacitorExportTarget");

    await createCapacitorExportTarget().exportJson("log.json", "{}");

    const deleted = filesystem.deleteFile.mock.calls.map(
      (call) => (call[0] as { path: string }).path
    );
    expect(deleted.every((path) => path.startsWith("brower-ios-probe-exports/"))).toBe(true);
    expect(deleted.some((path) => path.endsWith("unrelated.txt"))).toBe(false);
    // The current file plus the five most recent are kept; the rest go.
    expect(deleted).toContain("brower-ios-probe-exports/a-2.json");
    expect(deleted).toContain("brower-ios-probe-exports/a-1.json");
    expect(deleted).not.toContain("brower-ios-probe-exports/a-7.json");
  });
});

// ---------------------------------------------------------------------------
// Discovery evidence must survive into the exported file
// ---------------------------------------------------------------------------

describe("the exported file is a complete record of what the device reported", () => {
  const UNKNOWN_SERVICE = "0000180a-0000-1000-8000-00805f9b34fb";
  const UNKNOWN_CHARACTERISTIC = "00002a29-0000-1000-8000-00805f9b34fb";

  async function exportWithUnknownService() {
    const exportTarget = createFakeExportTarget();
    const controller = createProbeController({
      platform: IOS,
      transport: createFakeTransport({
        getServices: () =>
          Promise.resolve([
            ...bothDocumentedServices(),
            {
              uuid: UNKNOWN_SERVICE,
              characteristics: [
                {
                  uuid: UNKNOWN_CHARACTERISTIC,
                  properties: {
                    read: true,
                    write: false,
                    writeWithoutResponse: false,
                    notify: false,
                    indicate: true,
                  },
                },
              ],
            },
          ]),
      }),
      exportTarget,
      now: createStepClock(),
    });
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");
    await controller.exportLog();
    return {
      controller,
      parsed: JSON.parse(exportTarget.calls.at(-1)?.content ?? "{}") as {
        entries: {
          kind: string;
          uuid?: string;
          serviceUuid?: string;
          connectionEpoch: number;
          detail?: Record<string, string | number | boolean>;
        }[];
      },
    };
  }

  it("exports an undocumented service the device reported, not only the expected ones", async () => {
    const { parsed } = await exportWithUnknownService();

    const serviceEntry = parsed.entries.find(
      (entry) => entry.kind === "service_discovery" && entry.uuid === UNKNOWN_SERVICE
    );
    expect(serviceEntry).toBeDefined();
    expect(serviceEntry?.detail?.["documented"]).toBe(false);
    expect(serviceEntry?.detail?.["discovery"]).toBe("found");
    expect(serviceEntry?.connectionEpoch).toBe(1);
  });

  it("exports an undocumented characteristic's UUID and its ACTUAL properties", async () => {
    const { parsed } = await exportWithUnknownService();

    const characteristicEntry = parsed.entries.find(
      (entry) =>
        entry.kind === "characteristic_discovery" && entry.uuid === UNKNOWN_CHARACTERISTIC
    );
    expect(characteristicEntry).toBeDefined();
    expect(characteristicEntry?.serviceUuid).toBe(UNKNOWN_SERVICE);
    expect(characteristicEntry?.detail?.["documented"]).toBe(false);
    expect(characteristicEntry?.detail?.["properties"]).toBe("read,indicate");
    expect(characteristicEntry?.detail?.["read"]).toBe(true);
    expect(characteristicEntry?.detail?.["indicate"]).toBe(true);
    expect(characteristicEntry?.detail?.["notify"]).toBe(false);
  });

  it("still exports every documented service, classified as documented", async () => {
    const { parsed } = await exportWithUnknownService();

    const documented = parsed.entries.filter(
      (entry) => entry.kind === "service_discovery" && entry.detail?.["documented"] === true
    );
    expect(documented).toHaveLength(2);
  });

  it("keeps confirmed absence distinct from failed enumeration in the file", async () => {
    const exportTarget = createFakeExportTarget();
    const controller = createProbeController({
      platform: IOS,
      transport: createFakeTransport({
        getServices: () => Promise.reject(new Error("GATT operation failed")),
      }),
      exportTarget,
      now: createStepClock(),
    });
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");
    await controller.exportLog();

    const parsed = JSON.parse(exportTarget.calls.at(-1)?.content ?? "{}") as {
      entries: { kind: string; message: string }[];
    };
    const failure = parsed.entries.find(
      (entry) => entry.kind === "service_discovery_failed"
    );
    expect(failure?.message).toContain("not evidence that any service is missing");
    // A failed enumeration produces no "absent" claim at all.
    expect(
      parsed.entries.some((entry) => entry.kind === "optional_service_absent")
    ).toBe(false);
  });
});

describe("export bookkeeping counts entries, not sequence numbers", () => {
  it("records the actual entry count after a clear, and the high-water mark separately", async () => {
    const exportTarget = createFakeExportTarget();
    const controller = createProbeController({
      platform: IOS,
      transport: createFakeTransport(),
      exportTarget,
      now: createStepClock(),
    });
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");
    const sequenceBeforeClear = controller.getSnapshot().log.entries.length;
    expect(sequenceBeforeClear).toBeGreaterThan(1);

    // Clearing leaves exactly one entry, while the sequence counter keeps running.
    controller.clearLog({ confirmed: true });
    expect(controller.getSnapshot().log.entries).toHaveLength(1);

    await controller.exportLog();

    const detail = controller
      .getSnapshot()
      .log.entries.find((entry) => entry.kind === "export_shared")?.detail;
    // The file contained one entry — not the sequence high-water mark.
    expect(detail?.["entriesInFile"]).toBe(1);
    expect(detail?.["highestSequenceInFile"]).toBeGreaterThan(1);
    expect(detail?.["entriesInFile"]).not.toBe(detail?.["highestSequenceInFile"]);
  });

  it("reports an entry count matching the serialized file", async () => {
    const exportTarget = createFakeExportTarget();
    const controller = createProbeController({
      platform: IOS,
      transport: createFakeTransport(),
      exportTarget,
      now: createStepClock(),
    });
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");
    await controller.exportLog();

    const parsed = JSON.parse(exportTarget.calls.at(-1)?.content ?? "{}") as {
      entryCount: number;
      entries: unknown[];
    };
    const detail = controller
      .getSnapshot()
      .log.entries.find((entry) => entry.kind === "export_shared")?.detail;

    expect(parsed.entryCount).toBe(parsed.entries.length);
    expect(detail?.["entriesInFile"]).toBe(parsed.entries.length);
  });
});
