// Regressions for native notification-listener ownership.
//
// The plugin's notification API is KEY-BASED: a second `startNotifications` for the
// same peripheral/service/characteristic replaces the first registration, and
// `stopNotifications` stops whatever is registered under that key. An obsolete cleanup
// and a replacement registration therefore share a key and cannot be told apart by key
// alone — which is what these tests hold the controller to.
//
// Several cases run the transport through the plugin's OWN queue
// (`getQueue(true)` from the installed package) so the controller's bookkeeping is
// exercised against real serialization rather than an idealised one.
import { describe, expect, it } from "vitest";
import { getQueue } from "@capacitor-community/bluetooth-le/dist/esm/queue.js";
import {
  BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
  BROWER_TIMING_SERVICE_UUID,
} from "../probe/browerProtocol";
import { createProbeController } from "../probe/probeController";
import { buildProbeViewModel } from "../ui/viewModel";
import type { ProbeController } from "../probe/probeController";
import type { NativeBleTransport, ProbePlatform } from "../probe/transport";
import {
  createFakeExportTarget,
  createFakeTransport,
  createStepClock,
  deferred,
} from "./fakes";
import type { FakeTransport, FakeTransportScript } from "./fakes";

const IOS: ProbePlatform = { supported: true, platform: "ios" };

/**
 * Wraps a transport so every operation runs through the installed plugin's queue,
 * reproducing the serialization `BleClient` applies to its own calls.
 *
 * Written out explicitly rather than with a Proxy so each wrapped method keeps its
 * real signature — the point of these tests is the ordering, and an untyped
 * indirection would hide a mismatch rather than surface it.
 */
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

function key(peripheralId: string): string {
  return `${peripheralId}|${BROWER_TIMING_SERVICE_UUID}|${BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID}`;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

async function listeningController(
  script: FakeTransportScript = {},
  options: { useQueue?: boolean } = {}
): Promise<{ controller: ProbeController; transport: FakeTransport }> {
  const transport = createFakeTransport(script);
  const controller = createProbeController({
    platform: IOS,
    transport: options.useQueue === true ? queued(transport) : transport,
    exportTarget: createFakeExportTarget(),
    now: createStepClock(),
  });
  await controller.initializeBluetooth();
  await controller.connect("all-nearby");
  await controller.startListening();
  return { controller, transport };
}

describe("a pending Stop must not retire the replacement Start", () => {
  for (const useQueue of [false, true]) {
    const label = useQueue ? "with the plugin's queue" : "unqueued";

    it(`keeps the replacement registration when an old Stop completes late (${label})`, async () => {
      const firstStop = deferred<void>();
      let stops = 0;
      const { controller, transport } = await listeningController(
        {
          stopNotifications: () => {
            stops += 1;
            return stops === 1 ? firstStop.promise : Promise.resolve();
          },
        },
        { useQueue }
      );

      // Stop is issued and left pending natively.
      const stopping = controller.stopListening();
      // Start becomes available immediately: the token is retired and Stop holds no
      // busy claim. Restarting here is legitimate, and must not be corrupted by the
      // stop that is still in flight.
      expect(controller.getSnapshot().controls.startListening.available).toBe(true);
      const starting = controller.startListening();

      firstStop.resolve();
      await stopping;
      await starting;
      await settle();

      const snapshot = controller.getSnapshot();
      expect(snapshot.notificationsActive).toBe(true);
      // The replacement's ownership must survive the older stop's completion.
      expect(snapshot.ownedNativeListenerCount).toBe(1);
      expect(transport.nativeListenerKeys()).toEqual([key("peripheral-1")]);
      expect(transport.nativeSubscriptionKeys()).toEqual([key("peripheral-1")]);
    });

    it(`still releases the replacement on Disconnect afterwards (${label})`, async () => {
      const firstStop = deferred<void>();
      let stops = 0;
      const { controller, transport } = await listeningController(
        {
          stopNotifications: () => {
            stops += 1;
            return stops === 1 ? firstStop.promise : Promise.resolve();
          },
        },
        { useQueue }
      );

      const stopping = controller.stopListening();
      const starting = controller.startListening();
      firstStop.resolve();
      await stopping;
      await starting;
      await settle();

      await controller.disconnect();
      await settle();

      // The leak this guards against: ownership lost above means cleanup skipped here.
      expect(transport.nativeListenerKeys()).toHaveLength(0);
      expect(transport.nativeSubscriptionKeys()).toHaveLength(0);
      expect(controller.getSnapshot().ownedNativeListenerCount).toBe(0);
    });
  }

  it("does not let an old Stop's FAILURE mark the replacement as unconfirmed", async () => {
    const firstStop = deferred<void>();
    let stops = 0;
    const { controller, transport } = await listeningController({
      stopNotifications: () => {
        stops += 1;
        return stops === 1 ? firstStop.promise : Promise.resolve();
      },
    });

    const stopping = controller.stopListening();
    const starting = controller.startListening();
    firstStop.reject(new Error("GATT operation failed"));
    await stopping;
    await starting;
    await settle();

    const snapshot = controller.getSnapshot();
    // Two records: the old one whose stop failed is retained as unconfirmed, AND the
    // replacement. The old failure must not be charged against the replacement.
    expect(snapshot.notificationsActive).toBe(true);
    expect(snapshot.ownedNativeListenerCount).toBe(2);
    expect(transport.nativeSubscriptionKeys()).toEqual([key("peripheral-1")]);

    // The replacement is genuinely live: its callback still counts as an observation.
    transport.emitNotification(new DataView(new Uint8Array(20).buffer));
    expect(controller.getSnapshot().notificationCount).toBe(1);

    // Nothing warns about unconfirmed cleanup while a subscription is running.
    expect(buildProbeViewModel(controller.getSnapshot()).listenerNotice).toBeNull();

    // One key-scoped stop then resolves both records.
    await controller.disconnect();
    await settle();
    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(0);
    expect(transport.nativeSubscriptionKeys()).toHaveLength(0);
  });
});

describe("Stop targets the subscription the operator is actually listening to", () => {
  it("stops peripheral B, not an older unresolved record for peripheral A", async () => {
    const stopTargets: string[] = [];
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
    const nativeStop = transport.stopNotifications.bind(transport);
    transport.stopNotifications = async (deviceId, service, characteristic) => {
      stopTargets.push(deviceId);
      // Cleanup for A never completes cleanly, so its record is retained.
      if (deviceId === "peripheral-A") throw new Error("Not connected to device.");
      return nativeStop(deviceId, service, characteristic);
    };

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
    await settle();

    // A's cleanup is outstanding.
    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(1);

    await controller.connect("all-nearby");
    await controller.startListening();
    expect(controller.getSnapshot().device?.peripheralId).toBe("peripheral-B");

    const result = await controller.stopListening();

    // The stop must address B. Selecting by characteristic alone would have found A's
    // older record first and left B listening.
    expect(stopTargets.at(-1)).toBe("peripheral-B");
    expect(result).toEqual({ accepted: true });
    expect(controller.getSnapshot().notificationsActive).toBe(false);
    expect(transport.nativeSubscriptionKeys()).not.toContain(key("peripheral-B"));
  });

  it("does not report A as stopped merely because B's cleanup succeeded", async () => {
    const stopTargets: string[] = [];
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
    const nativeStop = transport.stopNotifications.bind(transport);
    transport.stopNotifications = async (deviceId, service, characteristic) => {
      stopTargets.push(deviceId);
      if (deviceId === "peripheral-A") throw new Error("Not connected to device.");
      return nativeStop(deviceId, service, characteristic);
    };

    const controller = createProbeController({
      platform: IOS,
      transport,
      exportTarget: createFakeExportTarget(),
      now: createStepClock(),
    });
    await controller.initializeBluetooth();
    await controller.connect("all-nearby");
    await controller.startListening();
    await controller.disconnect();
    await settle();
    await controller.connect("all-nearby");
    await controller.startListening();
    await controller.stopListening();
    await settle();

    // B is resolved; A's unresolved record stays outstanding and separate.
    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(1);
    const remaining = transport.nativeSubscriptionKeys();
    expect(remaining).toContain(key("peripheral-A"));
    expect(remaining).not.toContain(key("peripheral-B"));
  });
});

describe("the plugin's cleanup ordering is modelled as it actually is", () => {
  it("treats a native-stop rejection as unconfirmed, not as a surviving callback", async () => {
    const { controller, transport } = await listeningController({
      stopNotifications: () => Promise.reject(new Error("GATT operation failed")),
    });

    await controller.stopListening();

    // BleClient removes the JS listener and deletes its map entry BEFORE awaiting the
    // native stop, so the callback is already gone when this rejection arrives.
    expect(transport.nativeListenerKeys()).toHaveLength(0);
    // What is genuinely unknown is whether the peripheral stopped notifying.
    expect(transport.nativeSubscriptionKeys()).toEqual([key("peripheral-1")]);
    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(1);

    const entry = controller
      .getSnapshot()
      .log.entries.find((candidate) => candidate.kind === "native_listener_release_unconfirmed");
    expect(entry?.message).toContain("neither claims the subscription was released");
  });

  it("treats a listener-removal failure as leaving both halves in place", async () => {
    const { controller, transport } = await listeningController({
      removeListener: () => Promise.reject(new Error("Listener removal failed")),
    });

    await controller.stopListening();

    expect(transport.nativeListenerKeys()).toEqual([key("peripheral-1")]);
    expect(transport.nativeSubscriptionKeys()).toEqual([key("peripheral-1")]);
    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(1);
    expect(controller.getSnapshot().notificationsActive).toBe(false);
  });

  it("resolves an unconfirmed record and a replacement with a single stop for the key", async () => {
    let stops = 0;
    const { controller, transport } = await listeningController({
      stopNotifications: () => {
        stops += 1;
        return stops === 1
          ? Promise.reject(new Error("GATT operation failed"))
          : Promise.resolve();
      },
    });

    await controller.stopListening();
    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(1);

    // Restarting on the same key, then tearing down, must clear BOTH the unconfirmed
    // record and the replacement — with one stop, because the stop is key-scoped.
    await controller.startListening();
    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(2);

    await controller.disconnect();
    await settle();

    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(0);
    expect(transport.nativeListenerKeys()).toHaveLength(0);
    expect(transport.nativeSubscriptionKeys()).toHaveLength(0);
  });
});
