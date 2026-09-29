import { describe, expect, it } from "vitest";
import {
  BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
  BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
  BROWER_SERIAL_NUMBER_SERVICE_UUID,
  BROWER_TIME_BASE_CHARACTERISTIC_UUID,
  BROWER_TIMING_SERVICE_UUID,
} from "../probe/browerProtocol";
import { createProbeController } from "../probe/probeController";
import type { ProbeController, ProbeControllerOptions } from "../probe/probeController";
import type { ProbePlatform } from "../probe/transport";
import {
  bothDocumentedServices,
  createFakeExportTarget,
  createFakeLifecycle,
  createFakeTransport,
  createStepClock,
  deferred,
  timingServiceOnly,
} from "./fakes";
import type { FakeTransport, FakeTransportScript } from "./fakes";

const IOS: ProbePlatform = { supported: true, platform: "ios" };

function build(
  script: FakeTransportScript = {},
  overrides: Partial<ProbeControllerOptions> = {}
): {
  controller: ProbeController;
  transport: FakeTransport;
} {
  const transport = createFakeTransport(script);
  const controller = createProbeController({
    platform: IOS,
    transport,
    exportTarget: createFakeExportTarget(),
    now: createStepClock(),
    ...overrides,
  });
  return { controller, transport };
}

async function connected(
  script: FakeTransportScript = {},
  overrides: Partial<ProbeControllerOptions> = {}
) {
  const { controller, transport } = build(script, overrides);
  await controller.initializeBluetooth();
  await controller.connect("timing-service-filter");
  return { controller, transport };
}

describe("platform support", () => {
  it("offers nothing off native iOS and never falls back to another Bluetooth source", async () => {
    const controller = createProbeController({
      platform: { supported: false, platform: "web", reason: "not_native" },
      transport: null,
      exportTarget: createFakeExportTarget(),
      now: createStepClock(),
    });

    const initialize = await controller.initializeBluetooth();
    expect(initialize.accepted).toBe(false);
    const connect = await controller.connect("timing-service-filter");
    expect(connect.accepted).toBe(false);

    const snapshot = controller.getSnapshot();
    expect(snapshot.failure?.category).toBe("unsupported_platform");
    expect(snapshot.device).toBeNull();
    expect(
      snapshot.log.entries.some((entry) => entry.kind === "unsupported_platform")
    ).toBe(true);
  });
});

describe("initialisation failures", () => {
  it("reports a refused Bluetooth permission as permission denial, not as a generic failure", async () => {
    const { controller } = build({
      initialize: () => Promise.reject(new Error("Bluetooth permission was denied")),
    });

    const result = await controller.initializeBluetooth();

    expect(result.accepted).toBe(false);
    const snapshot = controller.getSnapshot();
    expect(snapshot.bluetooth).toBe("permission_denied");
    expect(snapshot.failure?.category).toBe("permission_denied");
    expect(snapshot.failure?.message).toContain("iOS Settings");
  });

  it("reports Bluetooth being off separately from a permission problem", async () => {
    const { controller } = build({ isEnabled: () => Promise.resolve(false) });

    await controller.initializeBluetooth();

    const snapshot = controller.getSnapshot();
    expect(snapshot.bluetooth).toBe("unavailable");
    expect(snapshot.failure?.category).toBe("bluetooth_unavailable");
  });

  it("refuses to connect before Bluetooth has been initialised", async () => {
    const { controller, transport } = build();
    const result = await controller.connect("timing-service-filter");
    expect(result.accepted).toBe(false);
    expect(transport.calls.some((call) => call.name === "requestDevice")).toBe(false);
  });
});

describe("device selection", () => {
  it("treats cancellation as cancellation, leaving the probe idle and unfailed", async () => {
    const { controller } = build({
      requestDevice: () => Promise.reject(new Error("requestDevice cancelled")),
    });
    await controller.initializeBluetooth();

    const result = await controller.connect("timing-service-filter");

    expect(result.accepted).toBe(false);
    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("idle");
    expect(snapshot.failure?.category).toBe("user_cancelled");
    expect(snapshot.device).toBeNull();
    expect(
      snapshot.log.entries.some((entry) => entry.kind === "device_selection_cancelled")
    ).toBe(true);
  });

  it("passes the timing-service filter, and an empty filter for the all-nearby fallback", async () => {
    const { controller, transport } = build();
    await controller.initializeBluetooth();

    await controller.connect("timing-service-filter");
    await controller.disconnect();
    await controller.connect("all-nearby");

    const requests = transport.calls.filter((call) => call.name === "requestDevice");
    expect(requests[0]?.args[0]).toBe(BROWER_TIMING_SERVICE_UUID);
    expect(requests[1]?.args[0]).toBe("");
  });

  it("ignores a second connect while the picker is still open", async () => {
    const gate = deferred<{ deviceId: string; name: string | null }>();
    const { controller, transport } = build({ requestDevice: () => gate.promise });
    await controller.initializeBluetooth();

    const first = controller.connect("timing-service-filter");
    const second = await controller.connect("timing-service-filter");

    expect(second.accepted).toBe(false);
    gate.resolve({ deviceId: "peripheral-1", name: "BROWER TCi CH 0" });
    await first;

    expect(transport.calls.filter((call) => call.name === "requestDevice")).toHaveLength(1);
    expect(transport.calls.filter((call) => call.name === "connect")).toHaveLength(1);
  });

  it("refuses a second connection while one is established", async () => {
    const { controller, transport } = await connected();
    const result = await controller.connect("all-nearby");
    expect(result.accepted).toBe(false);
    expect(transport.calls.filter((call) => call.name === "connect")).toHaveLength(1);
  });
});

describe("discovery", () => {
  it("records the properties the device actually advertised", async () => {
    const { controller } = await connected();

    const snapshot = controller.getSnapshot();
    const timing = snapshot.services.find((s) => s.uuid === BROWER_TIMING_SERVICE_UUID);
    const athleteData = timing?.characteristics.find(
      (c) => c.uuid === BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID
    );
    expect(timing?.discovery).toBe("found");
    expect(athleteData?.properties).toEqual({
      read: false,
      write: true,
      writeWithoutResponse: false,
      notify: true,
      indicate: false,
    });
    expect(snapshot.athleteDataDiscovery).toBe("found");
    expect(snapshot.discoveryIncomplete).toBe(false);
  });

  it("keeps a working timing connection when the optional Serial Number service is absent", async () => {
    const { controller } = await connected({
      getServices: () => Promise.resolve(timingServiceOnly()),
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("connected");
    expect(snapshot.discoveryIncomplete).toBe(false);
    expect(snapshot.athleteDataDiscovery).toBe("found");

    const serial = snapshot.services.find((s) => s.uuid === BROWER_SERIAL_NUMBER_SERVICE_UUID);
    expect(serial?.discovery).toBe("absent");
    expect(serial?.required).toBe(false);

    // The optional read is unavailable, and says why — but listening is unaffected.
    const serialRead = snapshot.readableCharacteristics.find(
      (entry) => entry.uuid === BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID
    );
    expect(serialRead?.available).toBe(false);
    expect(serialRead?.unavailableReason).toContain("timing connection is unaffected");
    expect(await controller.startListening()).toEqual({ accepted: true });
  });

  it("never reports a failed enumeration as confirmed absence", async () => {
    const { controller } = await connected({
      getServices: () => Promise.reject(new Error("GATT operation failed")),
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot.discoveryIncomplete).toBe(true);
    expect(snapshot.athleteDataDiscovery).toBe("failed");
    for (const service of snapshot.services) {
      expect(service.discovery).toBe("failed");
      expect(service.discovery).not.toBe("absent");
    }
    const entry = snapshot.log.entries.find((e) => e.kind === "service_discovery_failed");
    expect(entry?.message).toContain("not evidence that any service is missing");
  });

  it("refuses to listen when discovery failed, rather than offering a control that does nothing", async () => {
    const { controller } = await connected({
      getServices: () => Promise.reject(new Error("GATT operation failed")),
    });

    const result = await controller.startListening();

    expect(result).toEqual({
      accepted: false,
      reason:
        "Discovery did not complete, so the Athlete Data characteristic's presence is unknown.",
    });
  });

  it("surfaces an undocumented service the device reports rather than hiding it", async () => {
    const { controller } = await connected({
      getServices: () =>
        Promise.resolve([
          ...bothDocumentedServices(),
          {
            uuid: "0000180a-0000-1000-8000-00805f9b34fb",
            characteristics: [],
          },
        ]),
    });

    const extra = controller
      .getSnapshot()
      .services.find((s) => s.uuid === "0000180a-0000-1000-8000-00805f9b34fb");
    expect(extra?.documented).toBe(false);
    expect(extra?.discovery).toBe("found");
  });
});

describe("reads", () => {
  it("records raw bytes without decoding them", async () => {
    const { controller } = await connected();

    await controller.readCharacteristic(BROWER_TIME_BASE_CHARACTERISTIC_UUID);

    const read = controller.getSnapshot().reads.at(-1);
    expect(read?.hex).toBe("00 2B 0D A2");
    expect(read?.byteLength).toBe(4);
    expect(read?.label).toBe("Time Base");
  });

  it("refuses a read of a characteristic the device does not advertise as readable", async () => {
    const { controller, transport } = await connected();
    const before = transport.calls.filter((call) => call.name === "read").length;

    const result = await controller.readCharacteristic(
      BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID
    );

    expect(result.accepted).toBe(false);
    expect(transport.calls.filter((call) => call.name === "read")).toHaveLength(before);
  });

  it("copies the bytes at receipt, so a reused native buffer cannot rewrite an observation", async () => {
    const buffer = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const { controller } = await connected({
      read: () => Promise.resolve(new DataView(buffer.buffer)),
    });

    await controller.readCharacteristic(BROWER_TIME_BASE_CHARACTERISTIC_UUID);
    const recorded = controller.getSnapshot().reads.at(-1)?.hex;

    // The native side reuses its buffer for the next value.
    buffer.set([0xff, 0xff, 0xff, 0xff]);

    expect(recorded).toBe("01 02 03 04");
    expect(controller.getSnapshot().reads.at(-1)?.hex).toBe("01 02 03 04");
    expect(controller.getSnapshot().log.entries.at(-1)?.payload?.hex).toBe("01 02 03 04");
  });

  it("discards a read that completes after the connection ended", async () => {
    const gate = deferred<DataView>();
    const { controller } = await connected({ read: () => gate.promise });

    const pending = controller.readCharacteristic(BROWER_TIME_BASE_CHARACTERISTIC_UUID);
    await controller.disconnect();
    gate.resolve(new DataView(new Uint8Array([0xaa, 0xbb]).buffer));
    const result = await pending;

    expect(result.accepted).toBe(false);
    expect(controller.getSnapshot().reads).toHaveLength(0);
    expect(
      controller.getSnapshot().log.entries.some((e) => e.kind === "stale_read_discarded")
    ).toBe(true);
  });
});

describe("notifications", () => {
  it("counts, timestamps and copies raw notification payloads", async () => {
    const { controller, transport } = await connected();
    await controller.startListening();

    const bytes = new Uint8Array(20);
    bytes.set([0x00, 0x10, 0x00, 0xff]);
    transport.emitNotification(new DataView(bytes.buffer));

    const snapshot = controller.getSnapshot();
    expect(snapshot.notificationCount).toBe(1);
    const observation = snapshot.notifications.at(-1);
    expect(observation?.byteLength).toBe(20);
    expect(observation?.hex.startsWith("00 10 00 FF")).toBe(true);
    expect(observation?.at).toMatch(/^2026-09-27T/);

    // A reused native buffer must not rewrite what was already observed.
    bytes.fill(0x00);
    expect(controller.getSnapshot().notifications.at(-1)?.hex.startsWith("00 10 00 FF")).toBe(
      true
    );
  });

  it("registers exactly one subscription however often Start is pressed", async () => {
    const { controller, transport } = await connected();

    const first = await controller.startListening();
    const second = await controller.startListening();

    expect(first).toEqual({ accepted: true });
    expect(second.accepted).toBe(false);
    expect(transport.subscriptionCount()).toBe(1);
    expect(transport.notificationCallbackCount()).toBe(1);
  });

  it("does not register a second subscription when Start is pressed twice concurrently", async () => {
    const gate = deferred<void>();
    const { controller, transport } = await connected({
      startNotifications: () => gate.promise,
    });

    const first = controller.startListening();
    const second = await controller.startListening();
    gate.resolve();
    await first;

    expect(second.accepted).toBe(false);
    expect(
      transport.calls.filter((call) => call.name === "startNotifications")
    ).toHaveLength(1);
  });

  it("stops listening and delivers nothing afterwards", async () => {
    const { controller, transport } = await connected();
    await controller.startListening();
    await controller.stopListening();

    transport.emitNotification(new DataView(new Uint8Array([0x01]).buffer));

    const snapshot = controller.getSnapshot();
    expect(snapshot.notificationsActive).toBe(false);
    expect(snapshot.notificationCount).toBe(0);
    expect(transport.subscriptionCount()).toBe(0);
  });

  it("discards a notification that arrives for a connection that has already ended", async () => {
    const { controller, transport } = await connected();
    await controller.startListening();
    await controller.disconnect();

    // A value the native bridge had already dispatched when the unsubscribe landed.
    transport.emitLateNotification(new DataView(new Uint8Array([0x09, 0x09]).buffer));

    const snapshot = controller.getSnapshot();
    expect(snapshot.notificationCount).toBe(0);
    expect(snapshot.notifications).toHaveLength(0);
    const stale = snapshot.log.entries.find((e) => e.kind === "stale_notification_discarded");
    // It is still recorded — with its own epoch — so the evidence is not lost.
    expect(stale?.payload?.hex).toBe("09 09");
    expect(stale?.connectionEpoch).toBe(1);
  });

  it("does not attribute a previous connection's notification to a new one", async () => {
    const { controller, transport } = await connected();
    await controller.startListening();

    await controller.disconnect();
    await controller.connect("timing-service-filter");
    // The previous connection's callback fires late, after a new connection exists.
    transport.emitLateNotification(new DataView(new Uint8Array([0x11]).buffer));

    const snapshot = controller.getSnapshot();
    expect(snapshot.connectionEpoch).toBe(3);
    expect(snapshot.notificationCount).toBe(0);
  });

  it("does not treat a subscription that completed after teardown as active", async () => {
    const gate = deferred<void>();
    const { controller } = await connected({ startNotifications: () => gate.promise });

    const pending = controller.startListening();
    // Teardown is initiated WHILE the native start is still outstanding.
    const teardown = controller.disconnect();
    // The native start then settles. Cleanup for this characteristic is queued behind
    // it — the plugin's own queue behaves the same way — so teardown completes after.
    gate.resolve();
    await teardown;
    const result = await pending;

    expect(result.accepted).toBe(false);
    expect(controller.getSnapshot().notificationsActive).toBe(false);
    expect(
      controller
        .getSnapshot()
        .log.entries.some((e) => e.kind === "stale_subscription_discarded")
    ).toBe(true);
  });
});

describe("disconnect and reconnect", () => {
  it("releases subscriptions before disconnecting, and does so once", async () => {
    const { controller, transport } = await connected();
    await controller.startListening();

    await controller.disconnect();

    const names = transport.calls.map((call) => call.name);
    expect(names.indexOf("stopNotifications")).toBeLessThan(names.indexOf("disconnect"));
    expect(transport.calls.filter((call) => call.name === "disconnect")).toHaveLength(1);
    expect(transport.subscriptionCount()).toBe(0);
  });

  it("records an unexpected disconnect and requires an explicit reconnect", async () => {
    const { controller, transport } = await connected();
    await controller.startListening();

    transport.dropConnection();

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("disconnected");
    expect(snapshot.device).toBeNull();
    expect(snapshot.notificationsActive).toBe(false);
    expect(snapshot.failure?.category).toBe("unexpected_disconnect");
    expect(snapshot.failure?.message).toContain("never reconnects by itself");
    // No automatic reconnection attempt.
    expect(transport.calls.filter((call) => call.name === "requestDevice")).toHaveLength(1);
  });

  it("gives a fresh, user-triggered reconnect a new epoch and a clean observation set", async () => {
    const { controller, transport } = await connected();
    await controller.startListening();
    transport.emitNotification(new DataView(new Uint8Array([0x01]).buffer));
    expect(controller.getSnapshot().notificationCount).toBe(1);

    await controller.disconnect();
    await controller.connect("timing-service-filter");

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("connected");
    expect(snapshot.connectionEpoch).toBe(3);
    expect(snapshot.notificationCount).toBe(0);
    expect(snapshot.notifications).toHaveLength(0);
    expect(snapshot.connections).toHaveLength(2);
    expect(snapshot.connections[0]?.endedBy).toBe("user_disconnect");
    expect(snapshot.connections[1]?.endedAt).toBeNull();
  });

  it("tolerates a disconnect that throws and still clears the connection", async () => {
    const { controller } = await connected({
      disconnect: () => Promise.reject(new Error("already disconnected")),
    });

    const result = await controller.disconnect();

    expect(result).toEqual({ accepted: true });
    expect(controller.getSnapshot().device).toBeNull();
    expect(controller.getSnapshot().status).toBe("disconnected");
  });
});

describe("app lifecycle", () => {
  it("stops treating a backgrounded session as observed and tears the connection down", async () => {
    const lifecycle = createFakeLifecycle();
    const { controller, transport } = await connected({}, { lifecycle });
    await controller.startListening();

    lifecycle.setActive(false);
    for (let index = 0; index < 8; index += 1) await Promise.resolve();

    const snapshot = controller.getSnapshot();
    expect(snapshot.appActive).toBe(false);
    expect(snapshot.notificationsActive).toBe(false);
    expect(snapshot.status).toBe("disconnected");
    expect(transport.calls.some((call) => call.name === "disconnect")).toBe(true);
    const entry = snapshot.log.entries.find((e) => e.kind === "app_backgrounded");
    expect(entry?.message).toContain("no iOS background Bluetooth mode");
  });

  it("requires an explicit reconnect after returning to the foreground", async () => {
    const lifecycle = createFakeLifecycle();
    const { controller, transport } = await connected({}, { lifecycle });

    lifecycle.setActive(false);
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    lifecycle.setActive(true);

    expect(controller.getSnapshot().device).toBeNull();
    expect(transport.calls.filter((call) => call.name === "connect")).toHaveLength(1);
    expect(
      controller.getSnapshot().log.entries.some((e) => e.kind === "app_foregrounded")
    ).toBe(true);
  });

  it("releases its lifecycle listener and connection once, idempotently", async () => {
    const lifecycle = createFakeLifecycle();
    const { controller, transport } = await connected({}, { lifecycle });
    await controller.startListening();

    await controller.release();
    await controller.release();

    expect(lifecycle.listenerCount()).toBe(0);
    expect(transport.calls.filter((call) => call.name === "disconnect")).toHaveLength(1);
    expect(transport.subscriptionCount()).toBe(0);
  });
});
