// Regressions for connection-attempt ownership.
//
// Every test here interrupts an attempt at a specific await boundary — during
// selection, during the native connect, or during discovery — and asserts that the
// interrupted attempt changes nothing afterwards. Deferred promises are used rather
// than timers so each boundary is hit deterministically.
//
// These prove THIS CONTROLLER's handling of the interleavings exercised below. They
// are not a proof that every possible lifecycle ordering is covered, and they say
// nothing about iOS CoreBluetooth or Brower firmware.
import { describe, expect, it } from "vitest";
import { createProbeController } from "../probe/probeController";
import type { ProbeController } from "../probe/probeController";
import type { NativeService, ProbePlatform } from "../probe/transport";
import {
  createFakeExportTarget,
  createFakeLifecycle,
  createFakeTransport,
  createStepClock,
  deferred,
} from "./fakes";
import type { FakeTransport, FakeTransportScript } from "./fakes";

const IOS: ProbePlatform = { supported: true, platform: "ios" };

function build(script: FakeTransportScript = {}): {
  controller: ProbeController;
  transport: FakeTransport;
  lifecycle: ReturnType<typeof createFakeLifecycle>;
} {
  const transport = createFakeTransport(script);
  const lifecycle = createFakeLifecycle();
  const controller = createProbeController({
    platform: IOS,
    transport,
    exportTarget: createFakeExportTarget(),
    lifecycle,
    now: createStepClock(),
  });
  return { controller, transport, lifecycle };
}

/** Lets queued microtasks drain, including the ones a void-ed teardown chain uses. */
async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("interruption during device selection", () => {
  it("backgrounding before a device is chosen abandons the attempt entirely", async () => {
    const picker = deferred<{ deviceId: string; name: string | null }>();
    const { controller, transport, lifecycle } = build({
      requestDevice: () => picker.promise,
    });
    await controller.initializeBluetooth();

    const pending = controller.connect("timing-service-filter");
    lifecycle.setActive(false);
    await settle();

    // The picker only now returns a device — after the app left the foreground.
    picker.resolve({ deviceId: "peripheral-1", name: "BROWER TCi CH 0" });
    const result = await pending;

    expect(result.accepted).toBe(false);
    // No connection was ever started from the late selection.
    expect(transport.calls.filter((call) => call.name === "connect")).toHaveLength(0);
    const snapshot = controller.getSnapshot();
    expect(snapshot.device).toBeNull();
    expect(snapshot.status).toBe("disconnected");
    expect(
      snapshot.log.entries.some((entry) => entry.kind === "stale_selection_discarded")
    ).toBe(true);
  });

  it("release before a device is chosen is terminal and starts nothing", async () => {
    const picker = deferred<{ deviceId: string; name: string | null }>();
    const { controller, transport } = build({ requestDevice: () => picker.promise });
    await controller.initializeBluetooth();

    const pending = controller.connect("timing-service-filter");
    await controller.release();
    picker.resolve({ deviceId: "peripheral-1", name: "BROWER TCi CH 0" });
    const result = await pending;

    expect(result.accepted).toBe(false);
    expect(transport.calls.filter((call) => call.name === "connect")).toHaveLength(0);
    expect(controller.getSnapshot().released).toBe(true);
    // Terminal: nothing is accepted afterwards.
    expect((await controller.connect("all-nearby")).accepted).toBe(false);
    expect((await controller.initializeBluetooth()).accepted).toBe(false);
  });

  it("a picker that rejects after backgrounding does not reset state it no longer owns", async () => {
    const picker = deferred<{ deviceId: string; name: string | null }>();
    const { controller, lifecycle } = build({ requestDevice: () => picker.promise });
    await controller.initializeBluetooth();

    const pending = controller.connect("timing-service-filter");
    lifecycle.setActive(false);
    await settle();
    const backgroundedStatus = controller.getSnapshot().status;

    picker.reject(new Error("requestDevice cancelled"));
    await pending;

    // The rejection path re-checks ownership too: the backgrounded status stands.
    expect(controller.getSnapshot().status).toBe(backgroundedStatus);
    expect(controller.getSnapshot().status).toBe("disconnected");
  });
});

describe("interruption during the native connection", () => {
  it("backgrounding while connect is pending releases the connection that later completes", async () => {
    const nativeConnect = deferred<void>();
    const { controller, transport, lifecycle } = build({
      connect: () => nativeConnect.promise,
    });
    await controller.initializeBluetooth();

    const pending = controller.connect("timing-service-filter");
    await settle();
    lifecycle.setActive(false);
    await settle();

    nativeConnect.resolve();
    const result = await pending;
    await settle();

    expect(result.accepted).toBe(false);
    const snapshot = controller.getSnapshot();
    expect(snapshot.device).toBeNull();
    expect(snapshot.status).toBe("disconnected");
    expect(
      snapshot.log.entries.some((entry) => entry.kind === "stale_connection_discarded")
    ).toBe(true);
    // The real GATT connection was let go of rather than left open.
    expect(transport.connectedPeripheralIds()).toHaveLength(0);
    expect(
      snapshot.log.entries.some(
        (entry) => entry.kind === "superseded_connection_released"
      )
    ).toBe(true);
  });

  it("release while connect is pending also releases the late connection", async () => {
    const nativeConnect = deferred<void>();
    const { controller, transport } = build({ connect: () => nativeConnect.promise });
    await controller.initializeBluetooth();

    const pending = controller.connect("timing-service-filter");
    await settle();
    await controller.release();

    nativeConnect.resolve();
    await pending;
    await settle();

    expect(transport.connectedPeripheralIds()).toHaveLength(0);
    expect(controller.getSnapshot().device).toBeNull();
  });

  it("a connect that fails after backgrounding does not overwrite the background state", async () => {
    const nativeConnect = deferred<void>();
    const { controller, lifecycle } = build({ connect: () => nativeConnect.promise });
    await controller.initializeBluetooth();

    const pending = controller.connect("timing-service-filter");
    await settle();
    lifecycle.setActive(false);
    await settle();

    nativeConnect.reject(new Error("GATT connection failed"));
    await pending;

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("disconnected");
    expect(snapshot.status).not.toBe("failed");
    expect(snapshot.device).toBeNull();
  });

  it("does not disconnect a later connection that reuses the same peripheral", async () => {
    const firstConnect = deferred<void>();
    let connectCalls = 0;
    const { controller, transport, lifecycle } = build({
      connect: () => {
        connectCalls += 1;
        return connectCalls === 1 ? firstConnect.promise : Promise.resolve();
      },
    });
    await controller.initializeBluetooth();

    const interrupted = controller.connect("timing-service-filter");
    await settle();
    lifecycle.setActive(false);
    await settle();
    lifecycle.setActive(true);
    await settle();

    // A fresh, explicit selection reaches the SAME peripheral and succeeds.
    await controller.connect("timing-service-filter");
    expect(controller.getSnapshot().device?.peripheralId).toBe("peripheral-1");

    // Only now does the interrupted attempt's native connect resolve.
    firstConnect.resolve();
    await interrupted;
    await settle();

    // The current connection must survive: the superseded attempt must not disconnect
    // the peripheral the operator is now using.
    expect(controller.getSnapshot().device?.peripheralId).toBe("peripheral-1");
    expect(controller.getSnapshot().status).toBe("connected");
    expect(transport.connectedPeripheralIds()).toContain("peripheral-1");
    expect(
      controller
        .getSnapshot()
        .log.entries.some((entry) => entry.kind === "superseded_connection_left_intact")
    ).toBe(true);
  });
});

describe("interruption during discovery", () => {
  it("a discovery result arriving after backgrounding is not applied", async () => {
    const discovery = deferred<NativeService[]>();
    const { controller, lifecycle } = build({
      getServices: () => discovery.promise,
    });
    await controller.initializeBluetooth();

    const pending = controller.connect("timing-service-filter");
    await settle();
    expect(controller.getSnapshot().status).toBe("connected");

    lifecycle.setActive(false);
    await settle();
    discovery.resolve([]);
    await pending;

    const snapshot = controller.getSnapshot();
    expect(snapshot.athleteDataDiscovery).toBe("not_attempted");
    expect(
      snapshot.log.entries.some((entry) => entry.kind === "stale_discovery_discarded")
    ).toBe(true);
  });

  it("a discovery failure after backgrounding does not mark the session as failed", async () => {
    const discovery = deferred<NativeService[]>();
    const { controller, lifecycle } = build({
      getServices: () => discovery.promise,
    });
    await controller.initializeBluetooth();

    const pending = controller.connect("timing-service-filter");
    await settle();
    lifecycle.setActive(false);
    await settle();

    discovery.reject(new Error("GATT operation failed"));
    await pending;

    expect(controller.getSnapshot().discoveryIncomplete).toBe(false);
    expect(controller.getSnapshot().status).toBe("disconnected");
  });
});

describe("teardown is safe when it overlaps", () => {
  it("survives disconnect, backgrounding and release in immediate succession", async () => {
    const { controller, transport, lifecycle } = build();
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");
    await controller.startListening();

    const disconnecting = controller.disconnect();
    lifecycle.setActive(false);
    const releasing = controller.release();
    await disconnecting;
    await releasing;
    await settle();

    const snapshot = controller.getSnapshot();
    expect(snapshot.device).toBeNull();
    expect(snapshot.notificationsActive).toBe(false);
    expect(snapshot.released).toBe(true);
    expect(transport.connectedPeripheralIds()).toHaveLength(0);
    expect(transport.nativeListenerKeys()).toHaveLength(0);
  });

  it("repeated release is harmless and does not disconnect twice", async () => {
    const { controller, transport } = build();
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");

    await controller.release();
    await controller.release();
    await controller.release();

    expect(transport.calls.filter((call) => call.name === "disconnect")).toHaveLength(1);
  });

  it("requires a fresh explicit selection after a background interruption", async () => {
    const { controller, transport, lifecycle } = build();
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");
    const selectionsBefore = transport.calls.filter(
      (call) => call.name === "requestDevice"
    ).length;

    lifecycle.setActive(false);
    await settle();
    lifecycle.setActive(true);
    await settle();

    // Returning to the foreground reconnects nothing by itself.
    expect(controller.getSnapshot().device).toBeNull();
    expect(transport.calls.filter((call) => call.name === "requestDevice")).toHaveLength(
      selectionsBefore
    );

    // Only an explicit selection brings a connection back, on a new generation.
    await controller.connect("timing-service-filter");
    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("connected");
    expect(snapshot.connectionEpoch).toBeGreaterThan(1);
    expect(snapshot.connections).toHaveLength(2);
    expect(snapshot.connections[0]?.endedBy).toBe("backgrounded");
  });

  it("a stale operation's completion does not clear a newer operation's busy state", async () => {
    const firstRead = deferred<DataView>();
    const secondRead = deferred<DataView>();
    let readCalls = 0;
    const { controller } = build({
      read: () => {
        readCalls += 1;
        return readCalls === 1 ? firstRead.promise : secondRead.promise;
      },
    });
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");

    const stale = controller.readCharacteristic(
      "ee152c14-79a7-447d-b435-030880aa7d7d"
    );
    await controller.disconnect();
    await controller.connect("timing-service-filter");
    const current = controller.readCharacteristic(
      "ee152c14-79a7-447d-b435-030880aa7d7d"
    );
    expect(controller.getSnapshot().busy).toBe(true);

    // The interrupted read settles now. It must not release the busy state that the
    // second, still-running read owns.
    firstRead.resolve(new DataView(new Uint8Array([0x01]).buffer));
    await stale;
    expect(controller.getSnapshot().busy).toBe(true);

    secondRead.resolve(new DataView(new Uint8Array([0x02]).buffer));
    await current;
    expect(controller.getSnapshot().busy).toBe(false);
    expect(controller.getSnapshot().reads).toHaveLength(1);
    expect(controller.getSnapshot().reads[0]?.hex).toBe("02");
  });
});
