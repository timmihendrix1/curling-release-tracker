import { describe, expect, it } from "vitest";
import {
  BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
  BROWER_TIME_BASE_CHARACTERISTIC_UUID,
} from "../probe/browerProtocol";
import { createProbeController } from "../probe/probeController";
import type { ProbeController } from "../probe/probeController";
import type { ProbePlatform } from "../probe/transport";
import { buildProbeViewModel } from "../ui/viewModel";
import type { ProbeActionId, ProbeViewModel } from "../ui/viewModel";
import {
  createFakeExportTarget,
  createFakeTransport,
  createStepClock,
  deferred,
  timingServiceOnly,
} from "./fakes";
import type { FakeTransportScript } from "./fakes";

const IOS: ProbePlatform = { supported: true, platform: "ios" };

function model(controller: ProbeController): ProbeViewModel {
  return buildProbeViewModel(controller.getSnapshot());
}

function action(view: ProbeViewModel, id: ProbeActionId) {
  const found = view.actions.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No action ${id}`);
  return found;
}

function build(script: FakeTransportScript = {}): ProbeController {
  return createProbeController({
    platform: IOS,
    transport: createFakeTransport(script),
    exportTarget: createFakeExportTarget(),
    now: createStepClock(),
  });
}

describe("the view model identifies what this app is", () => {
  it("always says it is a raw-data development instrument", () => {
    const view = model(build());
    expect(view.identity).toContain("Raw BLE data only");
    expect(view.identity).toContain("Development instrument");
    expect(view.notices.join(" ")).toContain("No packet field is decoded");
    expect(view.notices.join(" ")).toContain("never writes to the timer");
    expect(view.notices.join(" ")).toContain("Foreground only");
    expect(view.notices.join(" ")).toContain("held in memory");
  });

  it("states the unsupported platform rather than offering controls that cannot work", () => {
    const controller = createProbeController({
      platform: { supported: false, platform: "web", reason: "not_native" },
      transport: null,
      exportTarget: createFakeExportTarget(),
      now: createStepClock(),
    });

    const view = model(controller);

    expect(view.platformLine).toContain("unsupported");
    expect(view.notices.join(" ")).toContain("does not fall back to browser Bluetooth");
    expect(action(view, "initialize").enabled).toBe(false);
    expect(action(view, "connect-filtered").enabled).toBe(false);
  });
});

describe("action availability always carries its reason", () => {
  it("never leaves a disabled action without an explanation", async () => {
    const controller = build();
    for (const view of [model(controller)]) {
      for (const candidate of view.actions) {
        if (!candidate.enabled) expect(candidate.disabledReason).not.toBeNull();
        else expect(candidate.disabledReason).toBeNull();
      }
    }
    await controller.initializeBluetooth();
    for (const candidate of model(controller).actions) {
      if (!candidate.enabled) expect(candidate.disabledReason).not.toBeNull();
    }
  });

  it("asks for Bluetooth initialisation before device selection", () => {
    const view = model(build());
    expect(action(view, "connect-filtered").disabledReason).toBe(
      "Initialise Bluetooth first."
    );
  });

  it("offers both the filtered chooser and the explicit all-nearby fallback", async () => {
    const controller = build();
    await controller.initializeBluetooth();

    const view = model(controller);

    expect(action(view, "connect-filtered").enabled).toBe(true);
    expect(action(view, "connect-all").enabled).toBe(true);
    expect(action(view, "connect-all").label).toContain("all nearby");
  });

  it("explains an absent optional service without implying the connection is broken", async () => {
    const controller = build({ getServices: () => Promise.resolve(timingServiceOnly()) });
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");

    const view = model(controller);

    const serialRead = action(view, `read:${BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID}`);
    expect(serialRead.enabled).toBe(false);
    expect(serialRead.disabledReason).toContain("timing connection is unaffected");
    expect(action(view, `read:${BROWER_TIME_BASE_CHARACTERISTIC_UUID}`).enabled).toBe(true);
    expect(action(view, "start-listening").enabled).toBe(true);
  });

  it("distinguishes a failed enumeration from a confirmed absence in the copy it shows", async () => {
    const controller = build({
      getServices: () => Promise.reject(new Error("GATT operation failed")),
    });
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");

    const view = model(controller);

    expect(view.discoveryNotice).toContain("partial picture");
    expect(action(view, "start-listening").disabledReason).toContain(
      "presence is unknown"
    );
    for (const service of view.services) {
      expect(service.discoveryLabel).toContain("not evidence either way");
      expect(service.discoveryLabel).not.toContain("not present");
    }
  });

  it("reports discovered properties verbatim rather than as a summary judgement", async () => {
    const controller = build();
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");

    const view = model(controller);
    const timing = view.services[0];
    const athleteData = timing?.characteristics.find((c) => c.title === "Athlete Data");

    expect(athleteData?.properties).toBe("write, notify");
  });
});

describe("listening and export copy", () => {
  it("reports listening state and the count together", async () => {
    const transport = createFakeTransport();
    const controller = createProbeController({
      platform: IOS,
      transport,
      exportTarget: createFakeExportTarget(),
      now: createStepClock(),
    });
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");
    await controller.startListening();
    transport.emitNotification(new DataView(new Uint8Array(20).buffer));

    const view = model(controller);

    expect(view.notificationSummary).toBe(
      "Listening. 1 notifications received on this connection."
    );
    expect(view.notifications).toHaveLength(1);
    expect(view.notifications[0]?.meta).toContain("20 bytes");
    expect(view.notifications[0]?.meta).toContain("connection 1");
  });

  it("says plainly that a cancelled export saved nothing", async () => {
    const controller = createProbeController({
      platform: IOS,
      transport: createFakeTransport(),
      exportTarget: createFakeExportTarget((fileName) => ({ kind: "cancelled", fileName })),
      now: createStepClock(),
    });
    await controller.initializeBluetooth();
    await controller.exportLog();

    const view = model(controller);

    expect(view.exportLine).toBe("Last export: cancelled. Nothing was saved.");
    expect(view.logSummary).toContain("Not yet exported.");
  });

  it("reports an export as complete once it has been shared", async () => {
    const controller = build();
    await controller.initializeBluetooth();
    await controller.exportLog();

    expect(model(controller).logSummary).toContain("All entries exported.");
  });
});

describe("the connection line never outlives the connection", () => {
  it("stops saying 'connected' the moment teardown begins, while the handle is still held", async () => {
    const nativeDisconnect = deferred<void>();
    const controller = createProbeController({
      platform: IOS,
      transport: createFakeTransport({
        disconnect: () => nativeDisconnect.promise,
      }),
      exportTarget: createFakeExportTarget(),
      now: createStepClock(),
    });
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");
    expect(model(controller).connectionLine).toContain("Connected to");

    const pending = controller.disconnect();
    // Mid-teardown: the native disconnect has not returned yet, but ownership is
    // already retired, so the device is no longer published and the line says so.
    // Nothing anywhere claims a connection the probe has stopped owning.
    expect(controller.getSnapshot().device).toBeNull();
    expect(model(controller).connectionLine).toBe("Disconnecting…");

    nativeDisconnect.resolve();
    await pending;
    expect(model(controller).connectionLine).toBe("Not connected.");
  });
});
