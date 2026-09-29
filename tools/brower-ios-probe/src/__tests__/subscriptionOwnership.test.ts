// Regressions for subscription capability, ownership and native listener cleanup.
//
// The Capacitor BLE client registers its JS notification listener BEFORE awaiting the
// native `startNotifications`, so a failed start still leaves one behind; and losing
// the GATT connection does not remove it, nor does clearing a Map in the controller.
// On stop it removes the listener and deletes its map entry BEFORE awaiting the native
// stop, so a rejected native stop does not mean the listener survived. The fake
// transport reproduces that ordering and tracks the JS listener and the
// peripheral-side subscription separately, so these tests check ACTUAL cleanup calls
// and resource state rather than merely asserting `notificationsActive === false`.
import { describe, expect, it } from "vitest";
import {
  BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
  BROWER_TIMING_SERVICE_UUID,
} from "../probe/browerProtocol";
import { createProbeController } from "../probe/probeController";
import type { ProbeController } from "../probe/probeController";
import type { NativeService, ProbePlatform } from "../probe/transport";
import { buildProbeViewModel } from "../ui/viewModel";
import {
  createFakeExportTarget,
  createFakeLifecycle,
  createFakeTransport,
  createStepClock,
  deferred,
  timingServiceOnly,
} from "./fakes";
import type { FakeTransport, FakeTransportScript } from "./fakes";

const IOS: ProbePlatform = { supported: true, platform: "ios" };
const LISTENER_KEY = `peripheral-1|${BROWER_TIMING_SERVICE_UUID}|${BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID}`;

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

async function connected(script: FakeTransportScript = {}) {
  const built = build(script);
  await built.controller.initializeBluetooth();
  await built.controller.connect("timing-service-filter");
  return built;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

/** The timing service with Athlete Data advertising the given push properties. */
function timingServiceWithAthleteData(properties: {
  notify: boolean;
  indicate: boolean;
}): NativeService[] {
  return timingServiceOnly().map((service) => ({
    ...service,
    characteristics: service.characteristics.map((characteristic) =>
      characteristic.uuid === BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID
        ? {
            ...characteristic,
            properties: { ...characteristic.properties, ...properties },
          }
        : characteristic
    ),
  }));
}

describe("notify/indicate capability is required, not assumed", () => {
  it("refuses to subscribe when the device advertises neither notify nor indicate", async () => {
    const { controller, transport } = await connected({
      getServices: () =>
        Promise.resolve(timingServiceWithAthleteData({ notify: false, indicate: false })),
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot.athleteDataDiscovery).toBe("found");
    expect(snapshot.athleteDataNotifyCapability).toBe("unsupported");

    const result = await controller.startListening();

    expect(result.accepted).toBe(false);
    expect(result).toMatchObject({
      reason: expect.stringContaining("without notify or indicate"),
    });
    // Nothing was asked of the native side, so no listener can have been registered.
    expect(
      transport.calls.filter((call) => call.name === "startNotifications")
    ).toHaveLength(0);
    expect(transport.nativeListenerKeys()).toHaveLength(0);
  });

  it("explains the unsupported capability in the UI instead of silently disabling", async () => {
    const { controller } = await connected({
      getServices: () =>
        Promise.resolve(timingServiceWithAthleteData({ notify: false, indicate: false })),
    });

    const view = buildProbeViewModel(controller.getSnapshot());
    const start = view.actions.find((action) => action.id === "start-listening");

    expect(start?.enabled).toBe(false);
    expect(start?.disabledReason).toContain("without notify or indicate");
    expect(view.discoveryNotice).toContain("Observed:");
  });

  it("accepts a characteristic that offers indicate but not notify", async () => {
    const { controller } = await connected({
      getServices: () =>
        Promise.resolve(timingServiceWithAthleteData({ notify: false, indicate: true })),
    });

    expect(controller.getSnapshot().athleteDataNotifyCapability).toBe("supported");
    expect(await controller.startListening()).toEqual({ accepted: true });
  });

  it("reports the capability as unknown, never unsupported, when discovery failed", async () => {
    const { controller } = await connected({
      getServices: () => Promise.reject(new Error("GATT operation failed")),
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot.athleteDataNotifyCapability).toBe("unknown");
    expect(snapshot.athleteDataNotifyCapability).not.toBe("unsupported");
    expect(snapshot.controls.startListening.unavailableReason).toContain(
      "presence is unknown"
    );
  });
});

describe("subscription ownership is separate from connection ownership", () => {
  it("does not count a callback from a stopped subscription as a current observation", async () => {
    const { controller, transport } = await connected();
    await controller.startListening();
    await controller.stopListening();

    // A value the native bridge had already dispatched when the stop landed.
    transport.emitLateNotification(new DataView(new Uint8Array([0x0a, 0x0b]).buffer));

    const snapshot = controller.getSnapshot();
    expect(snapshot.notificationCount).toBe(0);
    expect(snapshot.notifications).toHaveLength(0);
    const stale = snapshot.log.entries.find(
      (entry) => entry.kind === "stale_notification_discarded"
    );
    // Retained as explicitly stale evidence rather than thrown away.
    expect(stale?.payload?.hex).toBe("0A 0B");
    expect(stale?.detail?.["staleReason"]).toBe("subscription");
  });

  it("does not let an OLD subscription's callback inflate the new one's count on the same connection", async () => {
    const { controller, transport } = await connected();
    await controller.startListening();
    await controller.stopListening();
    await controller.startListening();

    // ONLY the first subscription's callback fires late, on the same live connection.
    transport.emitFromSubscription(0, new DataView(new Uint8Array([0x11]).buffer));

    const snapshot = controller.getSnapshot();
    // Connection ownership alone would have accepted this: the connection never ended.
    expect(snapshot.status).toBe("connected");
    expect(snapshot.notificationCount).toBe(0);
    expect(
      snapshot.log.entries.some(
        (entry) =>
          entry.kind === "stale_notification_discarded" &&
          entry.detail?.["staleReason"] === "subscription"
      )
    ).toBe(true);
  });

  it("counts a notification from the CURRENT subscription normally", async () => {
    const { controller, transport } = await connected();
    await controller.startListening();
    await controller.stopListening();
    await controller.startListening();

    transport.emitNotification(new DataView(new Uint8Array(20).buffer));

    expect(controller.getSnapshot().notificationCount).toBe(1);
  });
});

describe("native listener resources are actually released", () => {
  it("releases the native listener on Stop, not merely the local flag", async () => {
    const { controller, transport } = await connected();
    await controller.startListening();
    expect(transport.nativeListenerKeys()).toEqual([LISTENER_KEY]);

    await controller.stopListening();

    expect(transport.nativeListenerKeys()).toHaveLength(0);
    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(0);
    expect(controller.getSnapshot().notificationsActive).toBe(false);
  });

  it("releases the listener the plugin registered even when the native start FAILS", async () => {
    const { controller, transport } = await connected({
      startNotifications: () => Promise.reject(new Error("GATT operation failed")),
    });

    const result = await controller.startListening();

    expect(result.accepted).toBe(false);
    // The plugin registers its listener before its own await, so a failed start would
    // otherwise strand it.
    expect(
      transport.calls.filter((call) => call.name === "stopNotifications")
    ).toHaveLength(1);
    expect(transport.nativeListenerKeys()).toHaveLength(0);
    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(0);
    expect(controller.getSnapshot().notificationsActive).toBe(false);
  });

  it("releases a subscription that completed after teardown", async () => {
    const start = deferred<void>();
    const { controller, transport } = await connected({
      startNotifications: () => start.promise,
    });

    const pending = controller.startListening();
    // Teardown is initiated while the native start is outstanding; the start then
    // settles and the queued cleanup runs.
    const teardown = controller.disconnect();
    start.resolve();
    await teardown;
    const result = await pending;
    await settle();

    expect(result.accepted).toBe(false);
    expect(controller.getSnapshot().notificationsActive).toBe(false);
    expect(transport.nativeListenerKeys()).toHaveLength(0);
    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(0);
  });

  it("releases native listeners after an UNEXPECTED disconnect, which does not remove them", async () => {
    const { controller, transport } = await connected();
    await controller.startListening();
    expect(transport.nativeListenerKeys()).toHaveLength(1);

    transport.dropConnection();
    await settle();

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("disconnected");
    expect(snapshot.notificationsActive).toBe(false);
    // The GATT drop does not remove the JS listener — the controller must stop it.
    expect(
      transport.calls.filter((call) => call.name === "stopNotifications")
    ).toHaveLength(1);
    expect(transport.nativeListenerKeys()).toHaveLength(0);
    expect(snapshot.ownedNativeListenerCount).toBe(0);
  });

  it("releases native listeners when the app is backgrounded", async () => {
    const { controller, transport, lifecycle } = await connected();
    await controller.startListening();

    lifecycle.setActive(false);
    await settle();

    expect(transport.nativeListenerKeys()).toHaveLength(0);
    expect(controller.getSnapshot().notificationsActive).toBe(false);
  });

  it("records cleanup as unconfirmed when the NATIVE stop fails after the listener was removed", async () => {
    const { controller, transport } = await connected({
      stopNotifications: () => Promise.reject(new Error("GATT operation failed")),
    });
    await controller.startListening();

    const result = await controller.stopListening();

    expect(result.accepted).toBe(false);
    const snapshot = controller.getSnapshot();
    // A cleanup error must never reinstate active observation...
    expect(snapshot.notificationsActive).toBe(false);
    expect(snapshot.controls.startListening.available).toBe(true);
    // ...and must never be reported as a release that completed.
    expect(snapshot.ownedNativeListenerCount).toBe(1);

    // The plugin removes its JS listener and deletes the map entry BEFORE awaiting the
    // native stop, so this failure does NOT mean the listener survived — it is already
    // gone. What is unknown is whether the peripheral stopped notifying.
    expect(transport.nativeListenerKeys()).toHaveLength(0);
    expect(transport.nativeSubscriptionKeys()).toEqual([LISTENER_KEY]);

    expect(
      snapshot.log.entries.some((entry) => entry.kind === "notifications_stop_failed")
    ).toBe(true);
    const unconfirmed = snapshot.log.entries.find(
      (entry) => entry.kind === "native_listener_release_unconfirmed"
    );
    expect(unconfirmed?.message).toContain("cannot tell");
    // The operator can see it, worded as unconfirmed rather than as a known leak.
    expect(buildProbeViewModel(snapshot).listenerNotice).toContain("could not be confirmed");
  });

  it("leaves the JS listener registered when listener REMOVAL itself fails", async () => {
    const { controller, transport } = await connected({
      removeListener: () => Promise.reject(new Error("Listener removal failed")),
    });
    await controller.startListening();

    const result = await controller.stopListening();

    expect(result.accepted).toBe(false);
    // Removal failed before the map entry was deleted and before the native stop was
    // reached, so BOTH halves are still in place.
    expect(transport.nativeListenerKeys()).toEqual([LISTENER_KEY]);
    expect(transport.nativeSubscriptionKeys()).toEqual([LISTENER_KEY]);
    expect(controller.getSnapshot().ownedNativeListenerCount).toBe(1);
    expect(controller.getSnapshot().notificationsActive).toBe(false);
  });

  it("a failed stop does not let a late callback count as a current observation", async () => {
    const { controller, transport } = await connected({
      stopNotifications: () => Promise.reject(new Error("GATT operation failed")),
    });
    await controller.startListening();
    await controller.stopListening();

    transport.emitLateNotification(new DataView(new Uint8Array([0x22]).buffer));

    expect(controller.getSnapshot().notificationCount).toBe(0);
  });

  it("release stops the native listeners it owns", async () => {
    const { controller, transport } = await connected();
    await controller.startListening();

    await controller.release();

    expect(transport.nativeListenerKeys()).toHaveLength(0);
    expect(
      transport.calls.filter((call) => call.name === "stopNotifications")
    ).toHaveLength(1);
  });
});
