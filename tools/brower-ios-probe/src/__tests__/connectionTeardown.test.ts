// Regressions for the connection-teardown lifecycle.
//
// Teardown cannot finish synchronously: releasing the notification listeners may wait
// on a native call that is still outstanding, and only after that does the probe issue
// the peripheral disconnect. That leaves a window in which the attempt is already
// retired but its disconnect has not been sent yet. If a replacement connection to the
// same peripheral is established inside that window, the retired attempt's disconnect
// arrives afterwards and tears the replacement down — leaving the probe reporting a
// connection that no longer exists.
//
// Every case here runs the transport through the installed plugin's own
// `getQueue(true)`, because the defect is about the ORDER native calls actually reach
// the bridge in. Assertions check native call targets and order and real resource
// state, not only snapshot flags.
import { describe, expect, it } from "vitest";
import { getQueue } from "@capacitor-community/bluetooth-le/dist/esm/queue.js";
import { createProbeController } from "../probe/probeController";
import type { ProbeController } from "../probe/probeController";
import type { NativeBleTransport, ProbePlatform } from "../probe/transport";
import { buildProbeViewModel } from "../ui/viewModel";
import {
  createFakeExportTarget,
  createFakeLifecycle,
  createFakeTransport,
  createStepClock,
  deferred,
} from "./fakes";
import type { FakeTransport, FakeTransportScript } from "./fakes";

const IOS: ProbePlatform = { supported: true, platform: "ios" };

/** Serializes every operation through the plugin's own queue, as `BleClient` does. */
function queued(transport: NativeBleTransport): NativeBleTransport {
  const queue: <T>(operation: () => Promise<T>) => Promise<T> = getQueue(true);
  return {
    initialize: () => queue(() => transport.initialize()),
    isEnabled: () => queue(() => transport.isEnabled()),
    requestDevice: (request) => queue(() => transport.requestDevice(request)),
    connect: (deviceId, onDisconnect) =>
      queue(() => transport.connect(deviceId, onDisconnect)),
    disconnect: (deviceId) => queue(() => transport.disconnect(deviceId)),
    getServices: (deviceId) => queue(() => transport.getServices(deviceId)),
    read: (deviceId, service, characteristic) =>
      queue(() => transport.read(deviceId, service, characteristic)),
    startNotifications: (deviceId, service, characteristic, callback) =>
      queue(() =>
        transport.startNotifications(deviceId, service, characteristic, callback)
      ),
    stopNotifications: (deviceId, service, characteristic) =>
      queue(() => transport.stopNotifications(deviceId, service, characteristic)),
  };
}

async function drain(): Promise<void> {
  for (let index = 0; index < 80; index += 1) await Promise.resolve();
}

function build(script: FakeTransportScript = {}): {
  controller: ProbeController;
  transport: FakeTransport;
  lifecycle: ReturnType<typeof createFakeLifecycle>;
} {
  const transport = createFakeTransport(script);
  const lifecycle = createFakeLifecycle();
  const controller = createProbeController({
    platform: IOS,
    transport: queued(transport),
    exportTarget: createFakeExportTarget(),
    lifecycle,
    now: createStepClock(),
  });
  return { controller, transport, lifecycle };
}

/** Native call names in the order they actually reached the transport. */
function order(transport: FakeTransport): string[] {
  return transport.calls.map((call) => call.name);
}

function callsTo(transport: FakeTransport, name: string): string[][] {
  return transport.calls.filter((call) => call.name === name).map((call) => call.args);
}

describe("an obsolete teardown must never disconnect a replacement", () => {
  it("refuses reselection while the old cleanup is still outstanding, then succeeds after it", async () => {
    const pendingStart = deferred<void>();
    let starts = 0;
    const { controller, transport, lifecycle } = build({
      startNotifications: () => {
        starts += 1;
        return starts === 1 ? pendingStart.promise : Promise.resolve();
      },
    });
    await controller.initializeBluetooth();
    await controller.connect("all-nearby");

    // A subscription start is left outstanding, so the cleanup that follows cannot
    // finish immediately.
    const oldStart = controller.startListening();
    await drain();

    lifecycle.setActive(false);
    // Invalidation is synchronous: nothing counts as current observation from here.
    expect(controller.getSnapshot().notificationsActive).toBe(false);
    expect(controller.getSnapshot().device).toBeNull();
    lifecycle.setActive(true);

    // Reselecting NOW would create a connection that the retired attempt's disconnect
    // would later tear down. It is refused, and the controller and the rendered UI
    // give the same reason.
    const blocked = await controller.connect("all-nearby");
    expect(blocked.accepted).toBe(false);
    const snapshot = controller.getSnapshot();
    expect(snapshot.controls.connect.available).toBe(false);
    expect(snapshot.controls.connect.unavailableReason).toContain("still being released");
    const connectAction = buildProbeViewModel(snapshot).actions.find(
      (action) => action.id === "connect-filtered"
    );
    expect(connectAction?.enabled).toBe(false);
    expect(connectAction?.disabledReason).toBe(snapshot.controls.connect.unavailableReason);
    // Nothing was selected, so no second connection exists to be torn down.
    expect(callsTo(transport, "requestDevice")).toHaveLength(1);

    // The outstanding start settles; cleanup completes and hands control back.
    pendingStart.resolve();
    await oldStart;
    await drain();
    expect(controller.getSnapshot().controls.connect.available).toBe(true);

    // An explicit retry now connects — and stays connected.
    const retry = await controller.connect("all-nearby");
    await drain();

    expect(retry).toEqual({ accepted: true });
    expect(controller.getSnapshot().status).toBe("connected");
    expect(transport.connectedPeripheralIds()).toContain("peripheral-1");

    // The decisive ordering: the retired attempt's disconnect reached the bridge
    // BEFORE the replacement's connect, so it cannot have torn it down.
    const names = order(transport);
    const obsoleteDisconnect = names.indexOf("disconnect");
    const replacementConnect = names.lastIndexOf("connect");
    expect(obsoleteDisconnect).toBeGreaterThan(-1);
    expect(obsoleteDisconnect).toBeLessThan(replacementConnect);
    expect(callsTo(transport, "disconnect")).toEqual([["peripheral-1"]]);
  });

  it("never leaves a live replacement disconnected by the retired attempt's cleanup", async () => {
    // Design-agnostic invariant: however reselection-during-cleanup is handled, the
    // probe must not end up reporting a connection the bridge no longer has. This is
    // the shape of the originally observed failure, where the obsolete
    // `disconnect(peripheral-1)` landed after the replacement's `connect`.
    const pendingStart = deferred<void>();
    let starts = 0;
    const { controller, transport, lifecycle } = build({
      startNotifications: () => {
        starts += 1;
        return starts === 1 ? pendingStart.promise : Promise.resolve();
      },
    });
    await controller.initializeBluetooth();
    await controller.connect("all-nearby");
    const oldStart = controller.startListening();
    await drain();

    lifecycle.setActive(false);
    lifecycle.setActive(true);

    // Fired without awaiting, so the outstanding start can settle underneath it.
    const reselection = controller.connect("all-nearby");
    pendingStart.resolve();
    await oldStart;
    const outcome = await reselection;
    await drain();

    // If the reselection was refused while cleanup was outstanding, the operator
    // retries — that is a legitimate design. What is NOT legitimate is a connection
    // the probe believes in and the bridge does not.
    if (!outcome.accepted) {
      expect(await controller.connect("all-nearby")).toEqual({ accepted: true });
      await drain();
    }

    expect(controller.getSnapshot().status).toBe("connected");
    expect(controller.getSnapshot().device?.peripheralId).toBe("peripheral-1");
    expect(transport.connectedPeripheralIds()).toContain("peripheral-1");
    // No disconnect may follow the connection the probe is currently reporting.
    const names = order(transport);
    expect(names.lastIndexOf("disconnect")).toBeLessThan(names.lastIndexOf("connect"));
  });

  it("keeps a same-peripheral replacement connected once the reselection is accepted", async () => {
    const { controller, transport, lifecycle } = build();
    await controller.initializeBluetooth();
    await controller.connect("all-nearby");
    await controller.startListening();

    lifecycle.setActive(false);
    await drain();
    lifecycle.setActive(true);

    const reconnect = await controller.connect("all-nearby");
    await drain();

    expect(reconnect).toEqual({ accepted: true });
    expect(controller.getSnapshot().status).toBe("connected");
    expect(controller.getSnapshot().device?.peripheralId).toBe("peripheral-1");
    // The live connection survives, and no further disconnect follows it.
    expect(transport.connectedPeripheralIds()).toEqual(["peripheral-1"]);
    const names = order(transport);
    expect(names.lastIndexOf("disconnect")).toBeLessThan(names.lastIndexOf("connect"));
  });

  it("does not let cleanup of a DIFFERENT peripheral disturb the current connection", async () => {
    let picks = 0;
    const transport = createFakeTransport({
      requestDevice: () => {
        picks += 1;
        return Promise.resolve({
          deviceId: picks === 1 ? "peripheral-A" : "peripheral-B",
          name: "BROWER TCi CH 0",
        });
      },
    });
    const controller = createProbeController({
      platform: IOS,
      transport: queued(transport),
      exportTarget: createFakeExportTarget(),
      now: createStepClock(),
    });
    await controller.initializeBluetooth();
    await controller.connect("all-nearby");
    await controller.startListening();
    await controller.disconnect();
    await drain();

    await controller.connect("all-nearby");
    await controller.startListening();
    await drain();

    expect(controller.getSnapshot().device?.peripheralId).toBe("peripheral-B");
    // A was disconnected; B is live and was never a disconnect target.
    expect(callsTo(transport, "disconnect")).toEqual([["peripheral-A"]]);
    expect(transport.connectedPeripheralIds()).toEqual(["peripheral-B"]);
    expect(controller.getSnapshot().notificationsActive).toBe(true);
  });
});

describe("cleanup failure leaves an honest, recoverable state", () => {
  it("hands selection back even when the native disconnect rejects", async () => {
    const { controller, transport, lifecycle } = build({
      disconnect: () => Promise.reject(new Error("Not connected to device.")),
    });
    await controller.initializeBluetooth();
    await controller.connect("all-nearby");

    lifecycle.setActive(false);
    await drain();
    lifecycle.setActive(true);

    // A failed disconnect must not strand the probe: selection is available again.
    expect(controller.getSnapshot().controls.connect.available).toBe(true);
    expect(callsTo(transport, "disconnect")).toEqual([["peripheral-1"]]);

    const retry = await controller.connect("all-nearby");
    await drain();
    expect(retry).toEqual({ accepted: true });
    expect(controller.getSnapshot().status).toBe("connected");
  });

  it("hands selection back even when the notification cleanup rejects", async () => {
    const { controller, lifecycle } = build({
      stopNotifications: () => Promise.reject(new Error("GATT operation failed")),
    });
    await controller.initializeBluetooth();
    await controller.connect("all-nearby");
    await controller.startListening();

    lifecycle.setActive(false);
    await drain();
    lifecycle.setActive(true);

    expect(controller.getSnapshot().controls.connect.available).toBe(true);
    // The unresolved cleanup is still reported honestly rather than silently dropped.
    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(1);
    expect(await controller.connect("all-nearby")).toEqual({ accepted: true });
  });
});

describe("overlapping teardown does not deadlock or cross-contaminate", () => {
  it("survives Disconnect, backgrounding and release issued together", async () => {
    const pendingStart = deferred<void>();
    let starts = 0;
    const { controller, transport, lifecycle } = build({
      startNotifications: () => {
        starts += 1;
        return starts === 1 ? pendingStart.promise : Promise.resolve();
      },
    });
    await controller.initializeBluetooth();
    await controller.connect("all-nearby");
    const listening = controller.startListening();
    await drain();

    const disconnecting = controller.disconnect();
    lifecycle.setActive(false);
    const releasing = controller.release();
    // Invalidation is immediate regardless of how the three overlap.
    expect(controller.getSnapshot().notificationsActive).toBe(false);
    expect(controller.getSnapshot().device).toBeNull();

    pendingStart.resolve();
    await Promise.all([listening, disconnecting, releasing]);
    await drain();

    expect(controller.getSnapshot().released).toBe(true);
    expect(transport.connectedPeripheralIds()).toHaveLength(0);
    expect(transport.nativeListenerKeys()).toHaveLength(0);
    expect(transport.nativeSubscriptionKeys()).toHaveLength(0);
    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(0);
  });

  it("treats an unexpected disconnect callback during cleanup as ending that attempt only", async () => {
    const { controller, transport } = build();
    await controller.initializeBluetooth();
    await controller.connect("all-nearby");
    await controller.startListening();

    // The device drops on its own. The probe never reconnects by itself.
    transport.dropConnection();
    await drain();

    expect(controller.getSnapshot().status).toBe("disconnected");
    expect(controller.getSnapshot().device).toBeNull();
    expect(callsTo(transport, "requestDevice")).toHaveLength(1);
    // Listeners are released, and selection is usable again.
    expect(transport.nativeListenerKeys()).toHaveLength(0);
    expect(controller.getSnapshot().controls.connect.available).toBe(true);

    const reconnect = await controller.connect("all-nearby");
    await drain();
    expect(reconnect).toEqual({ accepted: true });
    expect(transport.connectedPeripheralIds()).toEqual(["peripheral-1"]);
  });

  it("emits the explicit-disconnect callback path without reconnecting by itself", async () => {
    const { controller, transport } = build();
    await controller.initializeBluetooth();
    await controller.connect("all-nearby");

    await controller.disconnect();
    await drain();
    // The fake's explicit disconnect clears the registered callback, so no
    // gattserverdisconnected-style event follows a user-requested disconnect.
    transport.dropConnection();
    await drain();

    expect(controller.getSnapshot().status).toBe("disconnected");
    expect(
      controller
        .getSnapshot()
        .log.entries.filter((entry) => entry.kind === "unexpected_disconnect")
    ).toHaveLength(0);
    expect(callsTo(transport, "connect")).toHaveLength(1);
  });
});
