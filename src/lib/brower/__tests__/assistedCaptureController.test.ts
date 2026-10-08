import { describe, expect, it, vi } from "vitest";
import {
  createBrowerAssistedCaptureController,
  type BrowerAssistedCaptureController,
} from "../assistedCaptureController";
import {
  resolveBrowerTransportAvailability,
  type BrowerAppLifecycleSource,
  type BrowerTimingTransport,
} from "../timingTransport";
import type { BrowerCaptureContext } from "../assistedCapture";
import {
  BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
  BROWER_TIMING_SERVICE_UUID,
} from "../protocol";

const CONTEXT: BrowerCaptureContext = {
  profileId: "profile-1",
  sessionId: "session-1",
  blockId: "block-1",
  sequenceId: "sequence-1",
  measurementMode: "back-hog",
};

function bytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function view(packet: Uint8Array): DataView {
  return new DataView(packet.buffer.slice(0) as ArrayBuffer);
}

function basePacket(splits: number[], appendixCount = 0, memoryLocation = "001"): Uint8Array {
  const field = (value: number) => value.toString(16).toUpperCase().padStart(5, "0");
  const padded = [...splits, ...Array<number>(4 - splits.length).fill(0)];
  return bytes(
    memoryLocation + "000" + "FF0000" + "0064CFF" + padded.map(field).join("") +
      appendixCount.toString(16).toUpperCase()
  );
}

function appendixPacket(splits: number[]): Uint8Array {
  const padded = [...splits, ...Array<number>(8 - splits.length).fill(0)];
  return bytes(padded.map((v) => v.toString(16).toUpperCase().padStart(5, "0")).join(""));
}

type Harness = {
  controller: BrowerAssistedCaptureController;
  transport: BrowerTimingTransport & {
    notify: (packet: Uint8Array) => void;
    dropConnection: () => void;
    calls: string[];
  };
  setActive: (isActive: boolean) => void;
};

function createHarness(
  overrides: Partial<BrowerTimingTransport> = {},
  options: { platform?: "ios" | "web" } = {}
): Harness {
  const calls: string[] = [];
  let notifyCallback: ((value: DataView) => void) | null = null;
  let onDisconnect: ((deviceId: string) => void) | null = null;

  const transport = {
    calls,
    async initialize() {
      calls.push("initialize");
    },
    async isEnabled() {
      calls.push("isEnabled");
      return true;
    },
    async requestDevice() {
      calls.push("requestDevice");
      return { deviceId: "peripheral-1", name: "TCi Timer" };
    },
    async connect(deviceId: string, disconnected: (id: string) => void) {
      calls.push(`connect:${deviceId}`);
      onDisconnect = disconnected;
    },
    async disconnect(deviceId: string) {
      calls.push(`disconnect:${deviceId}`);
    },
    async startNotifications(
      deviceId: string,
      service: string,
      characteristic: string,
      callback: (value: DataView) => void
    ) {
      calls.push(`startNotifications:${service}:${characteristic}`);
      notifyCallback = callback;
    },
    async stopNotifications(deviceId: string) {
      calls.push(`stopNotifications:${deviceId}`);
      notifyCallback = null;
    },
    notify(packet: Uint8Array) {
      notifyCallback?.(view(packet));
    },
    dropConnection() {
      onDisconnect?.("peripheral-1");
    },
    ...overrides,
  } as Harness["transport"];

  let activeListener: ((isActive: boolean) => void) | null = null;
  const lifecycle: BrowerAppLifecycleSource = {
    onActiveStateChange(listener) {
      activeListener = listener;
      return () => {
        activeListener = null;
      };
    },
  };

  const platform = options.platform ?? "ios";
  const controller = createBrowerAssistedCaptureController({
    availability: resolveBrowerTransportAvailability(platform),
    transport: platform === "ios" ? transport : null,
    lifecycle,
    now: () => "2026-09-30T10:00:00.000Z",
  });

  controller.attachLifecycle();

  return {
    controller,
    transport,
    setActive: (isActive) => activeListener?.(isActive),
  };
}

function armHarness(harness: Harness) {
  if (harness.controller.getView().capture.completeObservationCount === 0) {
    harness.transport.notify(basePacket([]));
  }
  harness.controller.arm(CONTEXT);
}

async function connected(overrides?: Partial<BrowerTimingTransport>): Promise<Harness> {
  const harness = createHarness(overrides);
  await harness.controller.connect();
  return harness;
}

describe("platform availability", () => {
  it("offers nothing on the Web rather than falling back to Web Bluetooth", async () => {
    const harness = createHarness({}, { platform: "web" });
    await harness.controller.connect();
    expect(harness.controller.getView().status).toBe("unsupported");
    expect(harness.transport.calls).toEqual([]);
  });

  it("resolves native platforms as supported and everything else as not", () => {
    expect(resolveBrowerTransportAvailability("ios")).toEqual({ supported: true, platform: "ios" });
    expect(resolveBrowerTransportAvailability("android")).toEqual({
      supported: true,
      platform: "android",
    });
    expect(resolveBrowerTransportAvailability("web")).toEqual({ supported: false, reason: "web" });
    expect(resolveBrowerTransportAvailability("unsupported_native")).toEqual({
      supported: false,
      reason: "unsupported_native",
    });
  });
});

describe("connecting", () => {
  it("subscribes to the documented Athlete Data characteristic and sends no command", async () => {
    const { controller, transport } = await connected();
    expect(controller.getView().status).toBe("connected");
    expect(transport.calls).toContain(
      `startNotifications:${BROWER_TIMING_SERVICE_UUID}:${BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID}`
    );
    // The transport interface has no write operation at all; nothing can send 0x0A.
    expect("write" in transport).toBe(false);
  });

  it("starts observing, never armed", async () => {
    const { controller } = await connected();
    expect(controller.getView().capture.phase).toBe("observing");
    expect(controller.getView().capture.baseline).toBeNull();
  });

  it("reports Bluetooth being switched off without connecting", async () => {
    const harness = createHarness({ isEnabled: async () => false });
    await harness.controller.connect();
    expect(harness.controller.getView().status).toBe("disconnected");
    expect(harness.controller.getView().notice).toMatch(/Bluetooth is switched off/);
    expect(harness.transport.calls).not.toContain("requestDevice");
  });

  it("surfaces a cancelled device picker and stays disconnected", async () => {
    const harness = createHarness({
      requestDevice: async () => {
        throw new Error("User cancelled the requestDevice() chooser.");
      },
    });
    await harness.controller.connect();
    expect(harness.controller.getView().status).toBe("disconnected");
    expect(harness.controller.getView().notice).toMatch(/cancelled/i);
  });

  it("releases a peripheral it opened when a later step fails", async () => {
    const harness = createHarness({
      startNotifications: async () => {
        throw new Error("Notifications refused.");
      },
    });
    await harness.controller.connect();
    expect(harness.transport.calls).toContain("disconnect:peripheral-1");
    expect(harness.controller.getView().status).toBe("disconnected");
  });

  it("refuses a second connect while one is already established", async () => {
    const { controller, transport } = await connected();
    await controller.connect();
    expect(transport.calls.filter((call) => call === "requestDevice")).toHaveLength(1);
  });
});

describe("packet assembly", () => {
  async function armedHarness(baseline = basePacket([])): Promise<Harness> {
    const harness = await connected();
    harness.transport.notify(baseline);
    armHarness(harness);
    return harness;
  }

  it("assembles a base packet and two appendices into one record, not three athletes", async () => {
    const harness = await armedHarness(bytes("001000FF00000016CDE" + "0".repeat(21)));
    harness.transport.notify(bytes("00 10 00 FF 00 00 00 16 CD E0 0E D6 09 16 00 A0 34 12 BD 42"));
    // Nothing is selectable until every declared appendix has arrived.
    expect(harness.controller.getView().capture.candidates).toEqual([]);

    harness.transport.notify(bytes("13 A2 31 CA 1C 1D 93 13 01 91 31 0E 33 BF 68 3C DE 94 8E 76"));
    expect(harness.controller.getView().capture.candidates).toEqual([]);

    harness.transport.notify(bytes("49 D4 95 35 5C 54 43 F6 4B E2 65 A9 17 5F 62 76 DD B8 14 4B"));
    const { capture } = harness.controller.getView();
    expect(capture.candidates).toHaveLength(20);
    expect(capture.candidates[0]).toMatchObject({ splitIndex: 1, intervalMs: 3798 });
    expect(capture.candidates.at(-1)).toMatchObject({ splitIndex: 20, intervalMs: 42608 });
    expect(Object.keys(capture.observed)).toEqual(["001-000-0016CDE"]);
  });

  it("abandons a record whole when its appendix is superseded", async () => {
    const harness = await armedHarness();
    harness.transport.notify(basePacket([3575, 14888, 20733, 33779], 1));
    // A new base packet arrives before the declared appendix.
    harness.transport.notify(basePacket([3575], 0));

    const { capture } = harness.controller.getView();
    expect(capture.rejectedAssemblyCount).toBe(1);
    expect(capture.lastRejectionReason).toMatch(/superseded before they all arrived/);
    expect(capture.phase).toBe("suspended");
    expect(capture.candidates).toHaveLength(0);
  });

  it("pauses rather than guessing when a packet cannot be read", async () => {
    const harness = await armedHarness();
    harness.transport.notify(new Uint8Array(12));
    const { capture } = harness.controller.getView();
    expect(capture.phase).toBe("suspended");
    expect(capture.candidates).toEqual([]);
    expect(capture.rejectedAssemblyCount).toBe(1);
    expect(capture.suspendedReason).toMatch(/could not be read/);
  });

  it("pauses when assembled splits are incoherent", async () => {
    const harness = await armedHarness();
    // Split 3 decreases against split 2.
    harness.transport.notify(basePacket([3575, 14888, 2560, 0], 0));
    const { capture } = harness.controller.getView();
    expect(capture.phase).toBe("suspended");
    expect(capture.candidates).toEqual([]);
  });

  it("ignores a record carrying no measured split", async () => {
    const harness = await armedHarness();
    harness.transport.notify(basePacket([0, 0, 0, 0], 0));
    const { capture } = harness.controller.getView();
    expect(capture.phase).toBe("armed");
    expect(capture.candidates).toEqual([]);
    expect(capture.rejectedAssemblyCount).toBe(0);
  });

  it("offers nothing for packets that arrive before the operator confirms setup", async () => {
    const harness = await connected();
    harness.transport.notify(basePacket([3575, 14888], 0));
    expect(harness.controller.getView().capture.candidates).toEqual([]);

    // Arming baselines those two splits; only the third becomes selectable.
    armHarness(harness);
    harness.transport.notify(basePacket([3575, 14888, 20733], 0));
    const { capture } = harness.controller.getView();
    expect(capture.candidates).toHaveLength(1);
    expect(capture.candidates[0].splitIndex).toBe(3);
  });

  it("offers nothing new for a byte-for-byte repeat", async () => {
    const harness = await armedHarness();
    const packet = basePacket([3575, 14888], 0);
    harness.transport.notify(packet);
    const first = harness.controller.getView().capture.candidates.map((c) => c.id);
    harness.transport.notify(packet);
    expect(harness.controller.getView().capture.candidates.map((c) => c.id)).toEqual(first);
  });

  it("surfaces exhaustion at the documented twenty-split limit", async () => {
    const harness = await armedHarness();
    harness.transport.notify(basePacket([1000, 2000, 3000, 4000], 2));
    harness.transport.notify(appendixPacket([5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000]));
    harness.transport.notify(
      appendixPacket([13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000])
    );
    expect(harness.controller.getView().capture.exhaustedRecordKeys).toEqual(["001-000-0064CFF"]);
  });
});

describe("lifecycle invalidation", () => {
  it("tears down and clears candidates when the app leaves the screen", async () => {
    const harness = await connected();
    armHarness(harness);
    harness.transport.notify(basePacket([3575], 0));
    expect(harness.controller.getView().capture.candidates).toHaveLength(1);

    harness.setActive(false);
    await vi.waitFor(() => expect(harness.controller.getView().busy).toBe(false));

    const result = harness.controller.getView();
    expect(result.status).toBe("disconnected");
    expect(result.capture.phase).toBe("suspended");
    expect(result.capture.candidates).toEqual([]);
    expect(result.notice).toMatch(/does not capture in the background/);
    expect(harness.transport.calls).toContain("disconnect:peripheral-1");
  });

  it("pauses on an unexpected disconnect without issuing its own disconnect", async () => {
    const harness = await connected();
    armHarness(harness);
    harness.transport.dropConnection();
    await vi.waitFor(() => expect(harness.controller.getView().busy).toBe(false));

    const result = harness.controller.getView();
    expect(result.status).toBe("disconnected");
    expect(result.capture.phase).toBe("suspended");
    expect(result.notice).toMatch(/timer disconnected/i);
    expect(harness.transport.calls).not.toContain("disconnect:peripheral-1");
  });

  it("requires a fresh baseline and re-arming after reconnecting", async () => {
    const harness = await connected();
    armHarness(harness);
    harness.transport.notify(basePacket([3575, 14888], 0));
    harness.setActive(false);
    await vi.waitFor(() => expect(harness.controller.getView().busy).toBe(false));

    await harness.controller.connect();
    const afterReconnect = harness.controller.getView().capture;
    expect(afterReconnect.phase).toBe("observing");
    expect(afterReconnect.baseline).toBeNull();
    expect(afterReconnect.observed).toEqual({});

    // Packets that arrive before the new arming are baselined, not offered.
    harness.transport.notify(basePacket([3575, 14888], 0));
    expect(harness.controller.getView().capture.candidates).toEqual([]);
  });

  it("suspends when the capture context no longer matches the armed one", async () => {
    const harness = await connected();
    armHarness(harness);
    harness.transport.notify(basePacket([3575], 0));

    harness.controller.reconcileContext({ ...CONTEXT, sequenceId: "sequence-2" });
    const { capture } = harness.controller.getView();
    expect(capture.phase).toBe("suspended");
    expect(capture.candidates).toEqual([]);
    expect(capture.suspendedReason).toMatch(/training context changed/);
  });

  it("suspends when the capture context disappears entirely", async () => {
    const harness = await connected();
    armHarness(harness);
    harness.controller.reconcileContext(null);
    expect(harness.controller.getView().capture.phase).toBe("suspended");
  });

  it("leaves a matching context armed", async () => {
    const harness = await connected();
    armHarness(harness);
    harness.controller.reconcileContext({ ...CONTEXT });
    expect(harness.controller.getView().capture.phase).toBe("armed");
  });

  it("ignores notifications that arrive after release", async () => {
    const harness = await connected();
    armHarness(harness);
    await harness.controller.release();
    harness.transport.notify(basePacket([3575], 0));
    expect(harness.controller.getView().capture.candidates).toEqual([]);
  });
});

describe("obsolete cleanup", () => {
  it("does not disconnect a replacement connection holding the same peripheral", async () => {
    // A teardown whose disconnect is slow must not tear down a connection established
    // afterwards. `connect` refuses to start while a cleanup is outstanding, and the
    // teardown re-checks the live attempt before issuing the destructive call.
    let releaseDisconnect: (() => void) | null = null;
    const harness = await connected({
      disconnect: async () => {
        await new Promise<void>((resolve) => {
          releaseDisconnect = resolve;
        });
      },
    });

    const teardown = harness.controller.disconnect();
    await vi.waitFor(() => expect(releaseDisconnect).not.toBeNull());

    // A connect attempted during the outstanding cleanup is refused outright.
    await harness.controller.connect();
    expect(harness.transport.calls.filter((call) => call === "requestDevice")).toHaveLength(1);

    releaseDisconnect!();
    await teardown;
    expect(harness.controller.getView().status).toBe("disconnected");
  });

  it("stops notifications before disconnecting", async () => {
    const harness = await connected();
    await harness.controller.disconnect();
    const stopIndex = harness.transport.calls.indexOf("stopNotifications:peripheral-1");
    const disconnectIndex = harness.transport.calls.indexOf("disconnect:peripheral-1");
    expect(stopIndex).toBeGreaterThan(-1);
    expect(disconnectIndex).toBeGreaterThan(stopIndex);
  });

  it("hands control back even when teardown fails", async () => {
    const harness = await connected({
      disconnect: async () => {
        throw new Error("Peripheral already gone.");
      },
    });
    await harness.controller.disconnect();
    expect(harness.controller.getView().busy).toBe(false);
    expect(harness.controller.getView().status).toBe("disconnected");
  });
});

describe("candidate retirement through the controller", () => {
  it("removes an accepted candidate and never offers it again", async () => {
    const harness = await connected();
    armHarness(harness);
    const packet = basePacket([3575, 14888], 0);
    harness.transport.notify(packet);

    const [first] = harness.controller.getView().capture.candidates;
    harness.controller.retireCandidate(first.id, "accepted");
    expect(harness.controller.getView().capture.candidates.map((c) => c.splitIndex)).toEqual([2]);

    harness.transport.notify(packet);
    expect(harness.controller.getView().capture.candidates.map((c) => c.splitIndex)).toEqual([2]);
  });

  it("discards every candidate without creating anything", async () => {
    const harness = await connected();
    armHarness(harness);
    harness.transport.notify(basePacket([3575, 14888], 0));
    harness.controller.discardAllCandidates();
    expect(harness.controller.getView().capture.candidates).toEqual([]);
  });
});

describe("pilot safety regressions", () => {
  it("requires a complete baseline before arming", async () => {
    const { controller } = await connected();
    controller.arm(CONTEXT);
    expect(controller.canArm()).toBe(false);
    expect(controller.getView().capture.phase).not.toBe("armed");
  });

  it("does not promote an assembly begun during setup", async () => {
    const { controller, transport } = await connected();
    transport.notify(basePacket([1000]));
    transport.notify(basePacket([1000, 2000, 3000, 4000], 1));
    controller.arm(CONTEXT);
    transport.notify(appendixPacket([5000]));
    expect(controller.getView().capture.candidates).toEqual([]);
    controller.arm(CONTEXT);
    expect(controller.getView().capture.baseline?.["001-000-0064CFF"]).toHaveLength(5);
  });

  it("rejects a packet with two coherent interpretations", async () => {
    const { controller, transport } = await connected();
    transport.notify(basePacket([10])); controller.arm(CONTEXT);
    transport.notify(basePacket([10, 20, 30, 40], 1));
    transport.notify(bytes("0010000200003000040000500006000070000800"));
    expect(controller.getView().capture.phase).toBe("armed");
    expect(controller.getView().notice).toContain("Waiting for an unambiguous update");
    // Armed and recovering are different facts. A surface must be able to read the
    // second one without parsing the notice text.
    expect(controller.getView().awaitingUnambiguousRecord).toBe(true);
    expect(controller.canArm()).toBe(false);
    expect(controller.getView().capture.candidates).toEqual([]);
  });

  // Raw packets from the user's 2026-09-30T16-48-03-219Z export, seq 44–55.
  // Only packet bytes are needed; no peripheral identifier is copied into tests.
  const liveBase = "001000FF0000012138800D9403D1704D5D0805A2";
  const liveAppendix1 = "08841096D50ABD70B4690BE490CBC00E7910F0A8";
  const live14 = "0F9858E872000000000000000000000000000000";
  const live15 = "0F9858E8728EDA60000000000000000000000000";
  const live16Ambiguous = "0F9858E8728EDA68F2DE00000000000000000000";
  const live17 = "0F9858E8728EDA68F2DE8FAA4000000000000000";

  function liveSnapshot(h: Harness, appendix2: string, base = liveBase) {
    h.transport.notify(bytes(base));
    h.transport.notify(bytes(liveAppendix1));
    h.transport.notify(bytes(appendix2));
  }

  async function waitingOnLiveAmbiguity() {
    const h = await connected();
    liveSnapshot(h, live14);
    h.controller.arm(CONTEXT);
    liveSnapshot(h, live15);
    const stale = h.controller.getView().capture.candidates[0];
    expect(stale.intervalMs).toBe(1332);
    liveSnapshot(h, live16Ambiguous);
    expect(h.controller.verifyCandidateStillLive(stale)).not.toBeNull();
    expect(h.controller.getView().capture.candidates).toEqual([]);
    expect(h.controller.getView().capture.phase).toBe("armed");
    expect(h.controller.getView().awaitingUnambiguousRecord).toBe(true);
    return h;
  }

  it("recovers the real split-16 ambiguity only on a clear full same-record snapshot", async () => {
    const h = await waitingOnLiveAmbiguity();
    const epoch = h.controller.getView().capture.armingEpoch;
    // Repeated ambiguous data never becomes a candidate by repetition.
    liveSnapshot(h, live16Ambiguous);
    expect(h.controller.getView().capture.candidates).toEqual([]);
    liveSnapshot(h, live17);
    expect(h.controller.getView().notice).toBeNull();
    expect(h.controller.getView().awaitingUnambiguousRecord).toBe(false);
    expect(h.controller.getView().capture.armingEpoch).toBe(epoch);
    expect(h.controller.getView().capture.candidates.map(c => c.intervalMs)).toEqual([1332, 1336, 1990]);
    for (const c of h.controller.getView().capture.candidates) h.controller.retireCandidate(c.id, "accepted");
    liveSnapshot(h, live17);
    expect(h.controller.getView().capture.candidates).toEqual([]);
  });

  it("ignores orphan appendices, fake bases and New until a known header or reconnect", async () => {
    const h = await waitingOnLiveAmbiguity();
    h.transport.notify(bytes(live17)); // orphan, not a new athlete
    h.transport.notify(basePacket([3300], 0, "042"));
    h.transport.notify(basePacket([], 0, "002"));
    expect(h.controller.getView().capture.candidates).toEqual([]);
    expect(h.controller.canArm()).toBe(false);
    expect(Object.keys(h.controller.getView().capture.observed)).toEqual(["001-000-0121388"]);
    await h.controller.disconnect();
    await h.controller.connect();
    h.transport.notify(basePacket([], 0, "002"));
    h.controller.arm(CONTEXT);
    h.transport.notify(basePacket([3300], 0, "002"));
    expect(h.controller.getView().capture.candidates.map(c => c.intervalMs)).toEqual([3300]);
  });

  it("never recovers through a changed cumulative prefix", async () => {
    const h = await waitingOnLiveAmbiguity();
    liveSnapshot(h, live17, liveBase.replace("00D94", "00D95"));
    expect(h.controller.getView().capture.phase).toBe("suspended");
    expect(h.controller.getView().capture.candidates).toEqual([]);
  });

  it("does not undo a pause or promote measurements observed while paused", async () => {
    const h = await waitingOnLiveAmbiguity();
    h.controller.reconcileContext(null);
    liveSnapshot(h, live17);
    expect(h.controller.getView().capture.phase).toBe("suspended");
    expect(h.controller.getView().capture.candidates).toEqual([]);
    h.controller.arm(CONTEXT);
    liveSnapshot(h, live17);
    expect(h.controller.getView().capture.candidates).toEqual([]);
  });

  it("keeps a pre-arming ambiguous baseline unarmed until fully recovered", async () => {
    const h = await connected();
    liveSnapshot(h, live16Ambiguous);
    h.controller.arm(CONTEXT);
    expect(h.controller.getView().capture.phase).not.toBe("armed");
    liveSnapshot(h, live17);
    h.controller.arm(CONTEXT);
    liveSnapshot(h, live17);
    expect(h.controller.getView().capture.candidates).toEqual([]);
  });

  it("holds reselection until a retired native connect and its cleanup settle", async () => {
    let settle!: () => void;
    let count = 0;
    const resources = new Set<string>();
    const h = createHarness({
      connect: async (id) => {
        if (++count === 1) await new Promise<void>((resolve) => { settle = resolve; });
        resources.add(id);
      },
      disconnect: async (id) => { resources.delete(id); },
    });
    const old = h.controller.connect();
    await vi.waitFor(() => expect(settle).toBeDefined());
    await h.controller.disconnect();
    await h.controller.connect();
    expect(count).toBe(1);
    settle(); await old;
    expect(resources.size).toBe(0);
    await h.controller.connect();
    expect(resources.has("peripheral-1")).toBe(true);
    expect(h.controller.getView().status).toBe("connected");
  });

  it("cleans a failed notification registration rather than only disconnecting", async () => {
    const h = await connected({ startNotifications: async () => { throw new Error("native start failed after listener registration"); } });
    expect(h.transport.calls).toContain("stopNotifications:peripheral-1");
    expect(h.controller.getView().status).toBe("disconnected");
  });

  it("does not revive a candidate object after reconnect even if its result id recurs", async () => {
    const h = await connected(); armHarness(h);
    h.transport.notify(basePacket([3575]));
    const old = h.controller.getView().capture.candidates[0];
    await h.controller.disconnect(); await h.controller.connect(); armHarness(h);
    h.transport.notify(basePacket([3575]));
    const replacement = h.controller.getView().capture.candidates[0];
    expect(replacement.id).toBe(old.id);
    expect(h.controller.verifyCandidateStillLive(old)).not.toBeNull();
    expect(h.controller.verifyCandidateStillLive(replacement)).toBeNull();
  });
});
