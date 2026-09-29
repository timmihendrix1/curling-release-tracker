// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderProbe } from "../ui/render";
import { buildProbeViewModel } from "../ui/viewModel";
import { createProbeController } from "../probe/probeController";
import type { ProbeController } from "../probe/probeController";
import type { ProbePlatform } from "../probe/transport";
import {
  createFakeExportTarget,
  createFakeTransport,
  createStepClock,
  deferred,
} from "./fakes";

const TIME_BASE_UUID = "ee152c14-79a7-447d-b435-030880aa7d7d";

const IOS: ProbePlatform = { supported: true, platform: "ios" };

function paint(controller: ProbeController, onAction = vi.fn()): {
  root: HTMLElement;
  onAction: ReturnType<typeof vi.fn>;
} {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  renderProbe(root, buildProbeViewModel(controller.getSnapshot()), {
    onAction: (id) => {
      onAction(id);
    },
  });
  return { root, onAction };
}

function button(root: HTMLElement, id: string): HTMLButtonElement {
  const found = root.querySelector<HTMLButtonElement>(`button[data-action-id="${id}"]`);
  if (found === null) throw new Error(`No button ${id}`);
  return found;
}

describe("the rendered probe screen", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("identifies itself as a raw-data diagnostic on screen", () => {
    const controller = createProbeController({
      platform: IOS,
      transport: createFakeTransport(),
      exportTarget: createFakeExportTarget(),
      now: createStepClock(),
    });

    const { root } = paint(controller);

    expect(root.textContent).toContain("Raw BLE data only");
    expect(root.textContent).toContain("no training, assessment or exercise record");
  });

  it("disables an unavailable control and shows why, rather than failing silently", () => {
    const controller = createProbeController({
      platform: IOS,
      transport: createFakeTransport(),
      exportTarget: createFakeExportTarget(),
      now: createStepClock(),
    });

    const { root, onAction } = paint(controller);
    const connect = button(root, "connect-filtered");
    connect.click();

    expect(connect.disabled).toBe(true);
    expect(connect.title).toBe("Initialise Bluetooth first.");
    expect(root.textContent).toContain("Initialise Bluetooth first.");
    // A disabled button emits no action.
    expect(onAction).not.toHaveBeenCalled();
  });

  it("routes an enabled control to its action id", async () => {
    const controller = createProbeController({
      platform: IOS,
      transport: createFakeTransport(),
      exportTarget: createFakeExportTarget(),
      now: createStepClock(),
    });
    await controller.initializeBluetooth();

    const { root, onAction } = paint(controller);
    button(root, "connect-all").click();

    expect(onAction).toHaveBeenCalledWith("connect-all");
  });

  it("shows raw hex, byte length and the connection each observation belongs to", async () => {
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
    const bytes = new Uint8Array(20);
    bytes.set([0x00, 0x10, 0x00, 0xff]);
    transport.emitNotification(new DataView(bytes.buffer));

    const { root } = paint(controller);

    expect(root.textContent).toContain("00 10 00 FF");
    expect(root.textContent).toContain("20 bytes");
    expect(root.textContent).toContain("connection 1");
    // Nothing on screen claims to be a time, a split or a result.
    expect(root.textContent).not.toMatch(/\bseconds\b|\bsplit 1\b|\brelease time\b/i);
  });

  it("repaints from a fresh snapshot without leaving the previous render behind", async () => {
    const controller = createProbeController({
      platform: IOS,
      transport: createFakeTransport(),
      exportTarget: createFakeExportTarget(),
      now: createStepClock(),
    });
    const root = document.createElement("div");
    const render = () => {
      renderProbe(root, buildProbeViewModel(controller.getSnapshot()), {
        onAction: () => undefined,
      });
    };

    render();
    const before = root.querySelectorAll("button").length;
    await controller.initializeBluetooth();
    render();

    expect(root.querySelectorAll("button")).toHaveLength(before);
    expect(root.textContent).toContain("Bluetooth: ready.");
    expect(root.textContent).not.toContain("Bluetooth: not initialised.");
  });
});

describe("Disconnect stays usable while an operation is in flight", () => {
  it("renders Disconnect as enabled during a pending read, and invoking it invalidates that read", async () => {
    const pendingRead = deferred<DataView>();
    const transport = createFakeTransport({ read: () => pendingRead.promise });
    const controller = createProbeController({
      platform: IOS,
      transport,
      exportTarget: createFakeExportTarget(),
      now: createStepClock(),
    });
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");

    // A read is started and left hanging, exactly as a slow characteristic would.
    const read = controller.readCharacteristic(TIME_BASE_UUID);
    expect(controller.getSnapshot().busy).toBe(true);

    const { root } = paint(controller);
    const disconnect = button(root, "disconnect");
    // The control the operator actually sees must be usable here. Gating it on `busy`
    // would remove their way out at the one moment they most want it.
    expect(disconnect.disabled).toBe(false);

    // Invoke it the way a person does: through the rendered button.
    const clicked = new Promise<void>((resolve) => {
      renderProbe(root, buildProbeViewModel(controller.getSnapshot()), {
        onAction: (id) => {
          if (id === "disconnect") void controller.disconnect().then(() => { resolve(); });
        },
      });
      button(root, "disconnect").click();
    });
    await clicked;

    // The connection is gone immediately, without waiting for the read.
    expect(controller.getSnapshot().device).toBeNull();
    expect(controller.getSnapshot().status).toBe("disconnected");

    // The native bridge offers no cancellation, so the read is still outstanding; it
    // is INVALIDATED rather than cancelled, and its late value is not attributed to
    // any connection.
    pendingRead.resolve(new DataView(new Uint8Array([0xde, 0xad]).buffer));
    const result = await read;
    expect(result.accepted).toBe(false);
    expect(controller.getSnapshot().reads).toHaveLength(0);
    expect(
      controller
        .getSnapshot()
        .log.entries.some((entry) => entry.kind === "stale_read_discarded")
    ).toBe(true);
  });

  it("renders Disconnect as enabled during a pending subscription start", async () => {
    const pendingStart = deferred<void>();
    const controller = createProbeController({
      platform: IOS,
      transport: createFakeTransport({ startNotifications: () => pendingStart.promise }),
      exportTarget: createFakeExportTarget(),
      now: createStepClock(),
    });
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");

    const starting = controller.startListening();
    const { root } = paint(controller);

    expect(button(root, "disconnect").disabled).toBe(false);

    const teardown = controller.disconnect();
    pendingStart.resolve();
    await teardown;
    await starting;
    expect(controller.getSnapshot().notificationsActive).toBe(false);
  });

  it("disables Disconnect once teardown is already running, so it cannot run twice", async () => {
    const nativeDisconnect = deferred<void>();
    const transport = createFakeTransport({ disconnect: () => nativeDisconnect.promise });
    const controller = createProbeController({
      platform: IOS,
      transport,
      exportTarget: createFakeExportTarget(),
      now: createStepClock(),
    });
    await controller.initializeBluetooth();
    await controller.connect("timing-service-filter");

    const first = controller.disconnect();
    const { root } = paint(controller);
    expect(button(root, "disconnect").disabled).toBe(true);
    expect(button(root, "disconnect").title).toBe("Already disconnecting.");

    // A second invocation is refused rather than tearing down twice.
    expect(await controller.disconnect()).toEqual({
      accepted: false,
      reason: "Already disconnecting.",
    });

    nativeDisconnect.resolve();
    await first;
    expect(transport.calls.filter((call) => call.name === "disconnect")).toHaveLength(1);
  });
});
