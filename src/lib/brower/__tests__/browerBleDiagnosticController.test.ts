// Controller behaviour against an INJECTED MOCK Bluetooth API. Every packet below is
// synthetic. These tests prove the controller's lifecycle, serialization, validation,
// property-awareness and logging. They prove nothing about real Brower TCi firmware —
// see docs/BROWER_INTEGRATION_STATUS.md's acceptance gates.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWER_MAX_DISPLAYED_READS,
  BROWER_OBSERVATION_WINDOW_MS,
  createBrowerBleDiagnosticController,
  isBrowerDiagnosticEnvironment,
  type BrowerBleDiagnosticController,
  type BrowerControllerOptions,
} from "../browerBleDiagnosticController";
import {
  BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
  BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID,
  BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
  BROWER_SERIAL_NUMBER_SERVICE_UUID,
  BROWER_TIME_BASE_CHARACTERISTIC_UUID,
  BROWER_TIMING_SERVICE_UUID,
} from "../protocol";
import {
  createMockBluetooth,
  createMockCharacteristic,
  createMockDevice,
  createMockService,
  deferred,
  domException,
  type MockBluetooth,
  type MockCharacteristic,
  type MockDevice,
} from "./mockBluetooth";

afterEach(() => {
  vi.useRealTimers();
});

type Harness = {
  controller: BrowerBleDiagnosticController;
  bluetooth: MockBluetooth;
  device: MockDevice;
  athleteData: MockCharacteristic;
  timeBase: MockCharacteristic;
  powerOnCounter: MockCharacteristic;
  serialNumber: MockCharacteristic;
};

type HarnessOptions = {
  includeSerialService?: boolean;
  includeSerialCharacteristic?: boolean;
  includeTimingService?: boolean;
  athleteDataProperties?: { write?: boolean; writeWithoutResponse?: boolean; notify?: boolean };
  timeBaseReadable?: boolean;
  omitWriteWithResponseMethod?: boolean;
  omitWriteWithoutResponseMethod?: boolean;
  writeError?: unknown;
  controllerOptions?: Partial<BrowerControllerOptions>;
  extraTimingCharacteristics?: MockCharacteristic[];
};

function buildHarness(options: HarnessOptions = {}): Harness {
  const athleteData = createMockCharacteristic({
    uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
    properties: {
      write: options.athleteDataProperties?.write ?? true,
      writeWithoutResponse: options.athleteDataProperties?.writeWithoutResponse ?? false,
      notify: options.athleteDataProperties?.notify ?? true,
    },
    omitWriteWithResponseMethod: options.omitWriteWithResponseMethod,
    omitWriteWithoutResponseMethod: options.omitWriteWithoutResponseMethod,
    writeError: options.writeError,
  });
  const timeBase = createMockCharacteristic({
    uuid: BROWER_TIME_BASE_CHARACTERISTIC_UUID,
    properties: { read: options.timeBaseReadable ?? true },
    readValues: [
      new Uint8Array([0x10, 0x27, 0x00, 0x00]),
      new Uint8Array([0x20, 0x4e, 0x00, 0x00]),
    ],
  });
  const powerOnCounter = createMockCharacteristic({
    uuid: BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID,
    properties: { read: true },
    readValues: [new Uint8Array(16).fill(0x07)],
  });
  const serialNumber = createMockCharacteristic({
    uuid: BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
    properties: { read: true },
    readValues: [new Uint8Array([0x41, 0x42, 0x43])],
  });

  const services = [];
  if (options.includeTimingService !== false) {
    services.push(
      createMockService(BROWER_TIMING_SERVICE_UUID, [
        athleteData,
        timeBase,
        powerOnCounter,
        ...(options.extraTimingCharacteristics ?? []),
      ])
    );
  }
  if (options.includeSerialService !== false) {
    services.push(
      createMockService(
        BROWER_SERIAL_NUMBER_SERVICE_UUID,
        options.includeSerialCharacteristic === false ? [] : [serialNumber]
      )
    );
  }

  const device = createMockDevice({ services });
  const bluetooth = createMockBluetooth({ device });
  const controller = createBrowerBleDiagnosticController({
    bluetooth,
    isSecureContext: true,
    nodeEnv: "test",
    ...options.controllerOptions,
  });

  return { controller, bluetooth, device, athleteData, timeBase, powerOnCounter, serialNumber };
}

function logKinds(controller: BrowerBleDiagnosticController): string[] {
  return controller.getSnapshot().log.entries.map((entry) => entry.kind);
}

describe("production exclusion", () => {
  it("reports that a production environment is not a diagnostic environment", () => {
    expect(isBrowerDiagnosticEnvironment("production")).toBe(false);
    expect(isBrowerDiagnosticEnvironment("development")).toBe(true);
    expect(isBrowerDiagnosticEnvironment("test")).toBe(true);
  });

  it("refuses to construct a controller in production, before any Bluetooth access", () => {
    const bluetooth = createMockBluetooth({ device: createMockDevice() });

    expect(() =>
      createBrowerBleDiagnosticController({
        bluetooth,
        isSecureContext: true,
        nodeEnv: "production",
      })
    ).toThrow(/development-only/);
    expect(bluetooth.requestDeviceCalls).toHaveLength(0);
  });
});

describe("browser capability", () => {
  it("reports an unsupported browser when Web Bluetooth is absent", () => {
    const controller = createBrowerBleDiagnosticController({
      bluetooth: null,
      isSecureContext: true,
      nodeEnv: "test",
    });

    expect(controller.getSnapshot().support).toEqual({
      supported: false,
      reason: "no-web-bluetooth",
    });
    expect(controller.getSnapshot().status).toBe("unsupported");
    expect(logKinds(controller)).toContain("browser_capability");
  });

  it("reports an insecure context before considering the API at all", () => {
    const controller = createBrowerBleDiagnosticController({
      bluetooth: createMockBluetooth(),
      isSecureContext: false,
      nodeEnv: "test",
    });

    expect(controller.getSnapshot().support).toEqual({
      supported: false,
      reason: "insecure-context",
    });
  });

  it("never opens a chooser on an unsupported browser", async () => {
    const bluetooth = createMockBluetooth({ device: createMockDevice() });
    const controller = createBrowerBleDiagnosticController({
      bluetooth,
      isSecureContext: false,
      nodeEnv: "test",
    });

    await controller.connect("timing-service-filter");

    expect(bluetooth.requestDeviceCalls).toHaveLength(0);
  });
});

describe("device selection", () => {
  it("opens the chooser only when connect is explicitly called", async () => {
    const { controller, bluetooth } = buildHarness();

    expect(bluetooth.requestDeviceCalls).toHaveLength(0);

    await controller.connect("timing-service-filter");

    expect(bluetooth.requestDeviceCalls).toHaveLength(1);
  });

  it("filters on the timing service and keeps the serial service optional", async () => {
    const { controller, bluetooth } = buildHarness();

    await controller.connect("timing-service-filter");

    expect(bluetooth.requestDeviceCalls[0]).toEqual({
      filters: [{ services: [BROWER_TIMING_SERVICE_UUID] }],
      optionalServices: [BROWER_SERIAL_NUMBER_SERVICE_UUID],
    });
  });

  it("offers a fallback chooser listing both documented services as optional", async () => {
    const { controller, bluetooth } = buildHarness();

    await controller.connect("all-devices");

    expect(bluetooth.requestDeviceCalls[0]).toEqual({
      acceptAllDevices: true,
      optionalServices: [BROWER_TIMING_SERVICE_UUID, BROWER_SERIAL_NUMBER_SERVICE_UUID],
    });
  });

  it("treats a cancelled chooser as idle, not as a failure", async () => {
    const bluetooth = createMockBluetooth({ requestDeviceError: domException("NotFoundError") });
    const controller = createBrowerBleDiagnosticController({
      bluetooth,
      isSecureContext: true,
      nodeEnv: "test",
    });

    await controller.connect("all-devices");

    expect(controller.getSnapshot().status).toBe("idle");
    expect(controller.getSnapshot().failure).toBeNull();
    expect(logKinds(controller)).toContain("device_selection_cancelled");
  });

  it("reports denied Bluetooth permission as an actionable failure", async () => {
    const bluetooth = createMockBluetooth({
      requestDeviceError: domException("NotAllowedError"),
    });
    const controller = createBrowerBleDiagnosticController({
      bluetooth,
      isSecureContext: true,
      nodeEnv: "test",
    });

    await controller.connect("all-devices");

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("failed");
    expect(snapshot.failure).toContain("denied Bluetooth access");
    expect(logKinds(controller)).toContain("device_selection_failed");
  });

  it("records the browser device identifier separately from any serial number", async () => {
    const { controller } = buildHarness();

    await controller.connect("timing-service-filter");

    expect(controller.getSnapshot().device).toEqual({
      name: "TCi Timer",
      browserDeviceId: "mock-browser-device-id",
    });
    const selection = controller
      .getSnapshot()
      .log.entries.find((entry) => entry.kind === "device_selected");
    expect(selection?.message).toContain("does not confirm this is a TCi Timer");
  });
});

describe("service and characteristic discovery", () => {
  it("records the actual advertised properties of each discovered characteristic", async () => {
    const { controller } = buildHarness();

    await controller.connect("timing-service-filter");

    const snapshot = controller.getSnapshot();
    const timing = snapshot.services.find((service) => service.uuid === BROWER_TIMING_SERVICE_UUID);
    expect(timing?.discovery).toBe("found");
    expect(timing?.characteristicsEnumerated).toBe(true);
    expect(timing?.discoveryFailureCategory).toBeNull();

    const athlete = timing?.characteristics.find(
      (characteristic) => characteristic.uuid === BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID
    );
    expect(athlete?.label).toBe("Athlete Data");
    expect(athlete?.properties).toEqual({
      read: false,
      write: true,
      writeWithoutResponse: false,
      notify: true,
      indicate: false,
    });
  });

  it("lists an undiscovered-meaning characteristic without naming it", async () => {
    const unknown = createMockCharacteristic({
      uuid: "00001111-2222-3333-4444-555566667777",
      properties: { read: true },
    });
    const { controller } = buildHarness({ extraTimingCharacteristics: [unknown] });

    await controller.connect("timing-service-filter");

    const characteristics = controller
      .getSnapshot()
      .services.flatMap((service) => service.characteristics);
    const entry = characteristics.find((item) => item.uuid === unknown.uuid);
    expect(entry?.label).toBeNull();
    // Discovered, but never read or written automatically.
    expect(unknown.readCallCount).toBe(0);
    expect(unknown.writeCalls).toHaveLength(0);
  });

  it("releases the connection when the documented timing service is absent", async () => {
    const { controller, device } = buildHarness({ includeTimingService: false });

    await controller.connect("all-devices");

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("failed");
    expect(snapshot.failure).toContain("timing service was not found");
    expect(device.gatt.disconnectCallCount).toBeGreaterThanOrEqual(1);
    expect(logKinds(controller)).toContain("service_absent");
  });

  it("stays usable when the optional serial number service is missing", async () => {
    const { controller, timeBase } = buildHarness({ includeSerialService: false });

    await controller.connect("timing-service-filter");

    expect(controller.getSnapshot().status).toBe("connected");
    expect(timeBase.readCallCount).toBe(1);
    const serialService = controller
      .getSnapshot()
      .services.find((service) => service.uuid === BROWER_SERIAL_NUMBER_SERVICE_UUID);
    expect(serialService?.discovery).toBe("absent");
  });

  it("stays usable when the serial service exists but exposes no characteristic", async () => {
    const { controller } = buildHarness({ includeSerialCharacteristic: false });

    await controller.connect("timing-service-filter");

    expect(controller.getSnapshot().status).toBe("connected");
    expect(logKinds(controller)).toContain("characteristic_absent");
  });
});

describe("discovery failure is never reported as absence", () => {
  function buildWithServiceError(uuid: string, error: unknown) {
    const athleteData = createMockCharacteristic({
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      properties: { write: true, notify: true },
    });
    const timeBase = createMockCharacteristic({
      uuid: BROWER_TIME_BASE_CHARACTERISTIC_UUID,
      properties: { read: true },
      readValues: [new Uint8Array([0x01, 0x02, 0x03, 0x04])],
    });
    const device = createMockDevice({
      services: [
        createMockService(BROWER_TIMING_SERVICE_UUID, [athleteData, timeBase]),
        createMockService(BROWER_SERIAL_NUMBER_SERVICE_UUID, []),
      ],
      getPrimaryServiceErrors: { [uuid]: error },
    });
    return {
      device,
      controller: createBrowerBleDiagnosticController({
        bluetooth: createMockBluetooth({ device }),
        isSecureContext: true,
        nodeEnv: "test",
      }),
    };
  }

  it("does not claim the timing service is missing when its lookup throws NetworkError", async () => {
    const { controller, device } = buildWithServiceError(
      BROWER_TIMING_SERVICE_UUID,
      domException("NetworkError")
    );

    await controller.connect("timing-service-filter");

    const kinds = logKinds(controller);
    expect(kinds).toContain("service_discovery_failed");
    expect(kinds).not.toContain("service_absent");

    const entry = controller
      .getSnapshot()
      .log.entries.find((item) => item.kind === "service_discovery_failed");
    expect(entry?.uuid).toBe(BROWER_TIMING_SERVICE_UUID);
    expect(entry?.detail).toMatchObject({
      operation: "getPrimaryService",
      errorCategory: "NetworkError",
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("failed");
    expect(snapshot.failure).toContain("Could not determine");
    expect(snapshot.failure).not.toContain("was not found");
    // The failed connection is still released.
    expect(device.gatt.disconnectCallCount).toBeGreaterThanOrEqual(1);
  });

  it("does not claim the timing service is missing when its lookup throws SecurityError", async () => {
    const { controller } = buildWithServiceError(
      BROWER_TIMING_SERVICE_UUID,
      domException("SecurityError")
    );

    await controller.connect("timing-service-filter");

    const entry = controller
      .getSnapshot()
      .log.entries.find((item) => item.kind === "service_discovery_failed");
    expect(entry?.detail).toMatchObject({ errorCategory: "SecurityError" });
    expect(logKinds(controller)).not.toContain("service_absent");
  });

  it("still reports a genuine NotFoundError as confirmed absence", async () => {
    const { controller } = buildHarness({ includeTimingService: false });

    await controller.connect("all-devices");

    const kinds = logKinds(controller);
    expect(kinds).toContain("service_absent");
    expect(kinds).not.toContain("service_discovery_failed");
    expect(controller.getSnapshot().failure).toContain("was not found on this device");
  });

  it("treats a failed optional-service lookup as unknown, not absent, and stays usable", async () => {
    const { controller } = buildWithServiceError(
      BROWER_SERIAL_NUMBER_SERVICE_UUID,
      domException("NetworkError")
    );

    await controller.connect("timing-service-filter");

    const snapshot = controller.getSnapshot();
    // Optional functionality failing must remain nonfatal.
    expect(snapshot.status).toBe("connected");

    const serial = snapshot.services.find(
      (service) => service.uuid === BROWER_SERIAL_NUMBER_SERVICE_UUID
    );
    expect(serial?.discovery).toBe("failed");
    expect(serial?.discoveryFailureCategory).toBe("NetworkError");
    expect(snapshot.discoveryIncomplete).toBe(true);
    expect(logKinds(controller)).toContain("service_discovery_failed");
  });

  it("does not present a failed characteristic enumeration as an empty service", async () => {
    const athleteData = createMockCharacteristic({
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      properties: { write: true, notify: true },
    });
    const device = createMockDevice({
      services: [
        createMockService(BROWER_TIMING_SERVICE_UUID, [athleteData], {
          getCharacteristicsError: domException("SecurityError"),
        }),
      ],
    });
    const controller = createBrowerBleDiagnosticController({
      bluetooth: createMockBluetooth({ device }),
      isSecureContext: true,
      nodeEnv: "test",
    });

    await controller.connect("timing-service-filter");

    const snapshot = controller.getSnapshot();
    const timing = snapshot.services.find(
      (service) => service.uuid === BROWER_TIMING_SERVICE_UUID
    );

    expect(timing?.discovery).toBe("found");
    expect(timing?.characteristicsEnumerated).toBe(false);
    expect(timing?.discoveryFailureCategory).toBe("SecurityError");
    expect(timing?.characteristics).toEqual([]);
    expect(snapshot.discoveryIncomplete).toBe(true);

    // The regression Codex reproduced: connected, failure null, and misleading
    // "characteristic missing" entries.
    expect(snapshot.failure).not.toBeNull();
    const kinds = logKinds(controller);
    expect(kinds).toContain("characteristic_enumeration_failed");
    expect(kinds).not.toContain("characteristic_absent");
    expect(kinds).not.toContain("service_discovered");
  });

  it("does not report a characteristic as missing when an explicit read's enumeration fails", async () => {
    const athleteData = createMockCharacteristic({
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      properties: { write: true, notify: true },
    });
    const timeBase = createMockCharacteristic({
      uuid: BROWER_TIME_BASE_CHARACTERISTIC_UUID,
      properties: { read: true },
      readValues: [new Uint8Array([0x01, 0x02, 0x03, 0x04])],
    });
    const timingService = createMockService(BROWER_TIMING_SERVICE_UUID, [
      athleteData,
      timeBase,
    ]);
    const device = createMockDevice({ services: [timingService] });
    const controller = createBrowerBleDiagnosticController({
      bluetooth: createMockBluetooth({ device }),
      isSecureContext: true,
      nodeEnv: "test",
    });

    await controller.connect("timing-service-filter");
    expect(controller.getSnapshot().reads).toHaveLength(1);

    // Enumeration starts failing only after the initial discovery succeeded.
    timingService.getCharacteristics = async () => {
      throw domException("NetworkError");
    };

    await controller.readCharacteristic(BROWER_TIME_BASE_CHARACTERISTIC_UUID);

    const entries = controller.getSnapshot().log.entries;
    const timeBaseEntries = entries.filter(
      (entry) => entry.uuid === BROWER_TIME_BASE_CHARACTERISTIC_UUID
    );
    expect(timeBaseEntries.map((entry) => entry.kind)).toContain(
      "characteristic_discovery_failed"
    );
    // Time Base must never be reported as absent on the strength of a failed lookup.
    // (Power On Counter genuinely is absent from this device and is correctly reported
    // as such during the initial connect — that entry is expected and is not this one.)
    expect(timeBaseEntries.map((entry) => entry.kind)).not.toContain("characteristic_absent");
    expect(
      entries.some(
        (entry) =>
          entry.kind === "characteristic_absent" &&
          entry.uuid === BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID
      )
    ).toBe(true);
    expect(controller.getSnapshot().discoveryIncomplete).toBe(true);
    expect(controller.getSnapshot().failure).toContain("Could not determine");
    // No retry, and no extra read observation invented.
    expect(controller.getSnapshot().reads).toHaveLength(1);
  });

  it("records only sanitized error categories, never thrown message text", async () => {
    const hostile = {
      name: "NetworkError",
      message: "sb_secret_do_not_log_this",
      toString: () => "sb_secret_do_not_log_this",
    };
    const { controller } = buildWithServiceError(BROWER_SERIAL_NUMBER_SERVICE_UUID, hostile);

    await controller.connect("timing-service-filter");

    const serialized = JSON.stringify(controller.getSnapshot().log);
    expect(serialized).not.toContain("sb_secret_do_not_log_this");
    expect(serialized).toContain("NetworkError");
  });
});

describe("Athlete Data discovery is resolved from the enumeration that succeeded", () => {
  it("enumerates each found service exactly once during connect, with no redundant lookup", async () => {
    const athleteData = createMockCharacteristic({
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      properties: { write: true, notify: true },
    });
    const timeBase = createMockCharacteristic({
      uuid: BROWER_TIME_BASE_CHARACTERISTIC_UUID,
      properties: { read: true },
      readValues: [new Uint8Array([0x01, 0x02, 0x03, 0x04])],
    });
    const serialNumber = createMockCharacteristic({
      uuid: BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
      properties: { read: true },
      readValues: [new Uint8Array([0x41])],
    });
    const timingService = createMockService(BROWER_TIMING_SERVICE_UUID, [
      athleteData,
      timeBase,
    ]);
    const serialService = createMockService(BROWER_SERIAL_NUMBER_SERVICE_UUID, [serialNumber]);
    const device = createMockDevice({ services: [timingService, serialService] });
    const controller = createBrowerBleDiagnosticController({
      bluetooth: createMockBluetooth({ device }),
      isSecureContext: true,
      nodeEnv: "test",
    });

    await controller.connect("timing-service-filter");

    // A second round-trip per service is what previously allowed the Athlete Data
    // handle to be lost while the services list still advertised the characteristic.
    expect(timingService.getCharacteristicsCallCount).toBe(1);
    expect(serialService.getCharacteristicsCallCount).toBe(1);
    expect(controller.getSnapshot().athleteDataDiscovery).toBe("found");
  });

  it("stays consistent when only a SECOND enumeration of the timing service would fail", async () => {
    // Codex's exact probe: the first enumeration succeeds, a second would reject with
    // NetworkError. Previously the connect issued that second call for the Athlete Data
    // lookup, discarded the failed outcome, and left status connected / failure null /
    // discoveryIncomplete false with a Start Listening control that did nothing.
    const athleteData = createMockCharacteristic({
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      properties: { write: true, notify: true },
    });
    const timingService = createMockService(BROWER_TIMING_SERVICE_UUID, [athleteData]);
    const enumerate = timingService.getCharacteristics.bind(timingService);
    let calls = 0;
    timingService.getCharacteristics = async () => {
      calls += 1;
      if (calls === 2) throw domException("NetworkError");
      return enumerate();
    };
    const device = createMockDevice({ services: [timingService] });
    const controller = createBrowerBleDiagnosticController({
      bluetooth: createMockBluetooth({ device }),
      isSecureContext: true,
      nodeEnv: "test",
    });

    await controller.connect("all-devices");
    await controller.startNotifications();

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("connected");
    expect(snapshot.athleteDataDiscovery).toBe("found");
    expect(snapshot.discoveryIncomplete).toBe(false);
    expect(snapshot.failure).toBeNull();
    // The control that appears available actually works.
    expect(snapshot.notificationsActive).toBe(true);
    expect(athleteData.startNotificationsCallCount).toBe(1);
  });

  it("reports Athlete Data as unknown — not absent — when the enumeration failed", async () => {
    const athleteData = createMockCharacteristic({
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      properties: { write: true, notify: true },
    });
    const device = createMockDevice({
      services: [
        createMockService(BROWER_TIMING_SERVICE_UUID, [athleteData], {
          getCharacteristicsError: domException("SecurityError"),
        }),
      ],
    });
    const controller = createBrowerBleDiagnosticController({
      bluetooth: createMockBluetooth({ device }),
      isSecureContext: true,
      nodeEnv: "test",
    });

    await controller.connect("timing-service-filter");

    const snapshot = controller.getSnapshot();
    expect(snapshot.athleteDataDiscovery).toBe("failed");
    expect(snapshot.discoveryIncomplete).toBe(true);
    expect(snapshot.failure).not.toBeNull();

    const entry = controller
      .getSnapshot()
      .log.entries.find(
        (item) =>
          item.kind === "characteristic_discovery_failed" &&
          item.uuid === BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID
      );
    expect(entry).toBeDefined();
    expect(entry?.detail).toMatchObject({
      operation: "getCharacteristics",
      errorCategory: "SecurityError",
    });
    // Never reported as absent on the strength of a query that failed.
    expect(
      controller
        .getSnapshot()
        .log.entries.some(
          (item) =>
            item.kind === "characteristic_absent" &&
            item.uuid === BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID
        )
    ).toBe(false);
  });

  it("refuses a subscription request in that state instead of failing silently", async () => {
    const athleteData = createMockCharacteristic({
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      properties: { write: true, notify: true },
    });
    const device = createMockDevice({
      services: [
        createMockService(BROWER_TIMING_SERVICE_UUID, [athleteData], {
          getCharacteristicsError: domException("NetworkError"),
        }),
      ],
    });
    const controller = createBrowerBleDiagnosticController({
      bluetooth: createMockBluetooth({ device }),
      isSecureContext: true,
      nodeEnv: "test",
    });

    await controller.connect("timing-service-filter");
    await controller.startNotifications();

    expect(controller.getSnapshot().notificationsActive).toBe(false);
    expect(athleteData.startNotificationsCallCount).toBe(0);
    expect(athleteData.listeners).toHaveLength(0);
    const entry = controller
      .getSnapshot()
      .log.entries.find((item) => item.kind === "notifications_unavailable");
    expect(entry?.message).toContain("unknown");
    expect(entry?.detail).toMatchObject({ athleteDataDiscovery: "failed" });
  });

  it("still reports confirmed absence when the enumeration succeeded without Athlete Data", async () => {
    const timeBase = createMockCharacteristic({
      uuid: BROWER_TIME_BASE_CHARACTERISTIC_UUID,
      properties: { read: true },
      readValues: [new Uint8Array([0x01, 0x02, 0x03, 0x04])],
    });
    const device = createMockDevice({
      services: [createMockService(BROWER_TIMING_SERVICE_UUID, [timeBase])],
    });
    const controller = createBrowerBleDiagnosticController({
      bluetooth: createMockBluetooth({ device }),
      isSecureContext: true,
      nodeEnv: "test",
    });

    await controller.connect("timing-service-filter");

    const snapshot = controller.getSnapshot();
    expect(snapshot.athleteDataDiscovery).toBe("absent");
    // A confirmed absence is not an incomplete inspection.
    expect(snapshot.discoveryIncomplete).toBe(false);
    expect(
      snapshot.log.entries.some(
        (item) =>
          item.kind === "characteristic_absent" &&
          item.uuid === BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID
      )
    ).toBe(true);
    // The read path still worked from the same enumeration.
    expect(snapshot.reads.some((read) => read.uuid === BROWER_TIME_BASE_CHARACTERISTIC_UUID)).toBe(
      true
    );
  });
});

describe("property-aware reads", () => {
  it("reads documented readable characteristics as raw bytes on connect", async () => {
    const { controller } = buildHarness();

    await controller.connect("timing-service-filter");

    const reads = controller.getSnapshot().reads;
    const timeBaseRead = reads.find(
      (read) => read.uuid === BROWER_TIME_BASE_CHARACTERISTIC_UUID
    );
    expect(timeBaseRead?.hex).toBe("10 27 00 00");
    expect(timeBaseRead?.byteLength).toBe(4);

    const counterRead = reads.find(
      (read) => read.uuid === BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID
    );
    expect(counterRead?.byteLength).toBe(16);
  });

  it("never claims an interpretation for a raw read", async () => {
    const { controller } = buildHarness();

    await controller.connect("timing-service-filter");

    const entry = controller
      .getSnapshot()
      .log.entries.find((item) => item.kind === "characteristic_read");
    expect(entry?.message).toContain("No numeric interpretation");
  });

  it("does not read a characteristic whose discovered properties exclude read", async () => {
    const { controller, timeBase } = buildHarness({ timeBaseReadable: false });

    await controller.connect("timing-service-filter");
    await controller.readCharacteristic(BROWER_TIME_BASE_CHARACTERISTIC_UUID);

    expect(timeBase.readCallCount).toBe(0);
    expect(logKinds(controller)).toContain("characteristic_not_readable");
  });

  it("records an independent observation per explicit read", async () => {
    const { controller, timeBase } = buildHarness();

    await controller.connect("timing-service-filter");
    await controller.readCharacteristic(BROWER_TIME_BASE_CHARACTERISTIC_UUID);

    expect(timeBase.readCallCount).toBe(2);
    const timeBaseReads = controller
      .getSnapshot()
      .reads.filter((read) => read.uuid === BROWER_TIME_BASE_CHARACTERISTIC_UUID);
    expect(timeBaseReads.map((read) => read.hex)).toEqual(["20 4E 00 00", "10 27 00 00"]);
  });

  it("bounds the retained read observations", async () => {
    const { controller } = buildHarness();
    await controller.connect("timing-service-filter");

    for (let index = 0; index < BROWER_MAX_DISPLAYED_READS + 5; index += 1) {
      await controller.readCharacteristic(BROWER_TIME_BASE_CHARACTERISTIC_UUID);
    }

    expect(controller.getSnapshot().reads).toHaveLength(BROWER_MAX_DISPLAYED_READS);
  });

  it("does not retry a failed read", async () => {
    const failing = createMockCharacteristic({
      uuid: BROWER_TIME_BASE_CHARACTERISTIC_UUID,
      properties: { read: true },
      readError: domException("NetworkError"),
    });
    const services = [
      createMockService(BROWER_TIMING_SERVICE_UUID, [
        createMockCharacteristic({
          uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
          properties: { write: true, notify: true },
        }),
        failing,
      ]),
    ];
    const device = createMockDevice({ services });
    const controller = createBrowerBleDiagnosticController({
      bluetooth: createMockBluetooth({ device }),
      isSecureContext: true,
      nodeEnv: "test",
    });

    await controller.connect("timing-service-filter");

    expect(failing.readCallCount).toBe(1);
    expect(logKinds(controller)).toContain("characteristic_read_failed");
    expect(controller.getSnapshot().status).toBe("connected");
  });
});

describe("notifications", () => {
  it("subscribes only on an explicit request and preserves each byte sequence", async () => {
    const { controller, athleteData } = buildHarness();

    await controller.connect("timing-service-filter");
    expect(athleteData.startNotificationsCallCount).toBe(0);

    await controller.startNotifications();
    expect(athleteData.startNotificationsCallCount).toBe(1);
    expect(controller.getSnapshot().notificationsActive).toBe(true);

    athleteData.emitNotification(new Uint8Array([0x01, 0x02, 0x03]));
    athleteData.emitNotification(new Uint8Array([0xaa, 0xbb]));

    const notifications = controller.getSnapshot().notifications;
    expect(notifications).toHaveLength(2);
    expect(notifications[0].hex).toBe("AA BB");
    expect(notifications[0].byteLength).toBe(2);
    expect(notifications[1].hex).toBe("01 02 03");
    expect(controller.getSnapshot().notificationCount).toBe(2);
  });

  it("copies notification bytes at receipt time even when the device reuses its buffer", async () => {
    const { controller, athleteData } = buildHarness();

    await controller.connect("timing-service-filter");
    await controller.startNotifications();

    athleteData.emitNotificationFromSharedBuffer(new Uint8Array([0x11, 0x22, 0x33]));
    athleteData.emitNotificationFromSharedBuffer(new Uint8Array([0x44, 0x55, 0x66]));

    const notifications = controller.getSnapshot().notifications;
    expect(notifications[0].hex).toBe("44 55 66");
    // The earlier observation must NOT have been overwritten by the reused buffer.
    expect(notifications[1].hex).toBe("11 22 33");
  });

  it("registers exactly one listener even when start is requested repeatedly", async () => {
    const { controller, athleteData } = buildHarness();

    await controller.connect("timing-service-filter");
    await controller.startNotifications();
    await controller.startNotifications();
    await controller.startNotifications();

    expect(athleteData.listeners).toHaveLength(1);
    expect(athleteData.startNotificationsCallCount).toBe(1);

    athleteData.emitNotification(new Uint8Array([0x01]));
    expect(controller.getSnapshot().notificationCount).toBe(1);
  });

  it("removes the listener on stop, so later bytes are not recorded", async () => {
    const { controller, athleteData } = buildHarness();

    await controller.connect("timing-service-filter");
    await controller.startNotifications();
    await controller.stopNotifications();

    expect(athleteData.listeners).toHaveLength(0);
    expect(controller.getSnapshot().notificationsActive).toBe(false);

    athleteData.emitNotification(new Uint8Array([0x01]));
    expect(controller.getSnapshot().notificationCount).toBe(0);
  });

  it("does not subscribe when the characteristic advertises neither notify nor indicate", async () => {
    const { controller, athleteData } = buildHarness({
      athleteDataProperties: { notify: false, write: true },
    });

    await controller.connect("timing-service-filter");
    await controller.startNotifications();

    expect(athleteData.startNotificationsCallCount).toBe(0);
    expect(athleteData.listeners).toHaveLength(0);
    expect(controller.getSnapshot().notificationsActive).toBe(false);
    expect(logKinds(controller)).toContain("notifications_unsupported");
  });

  it("leaves no listener behind when the subscription itself fails", async () => {
    const athleteData = createMockCharacteristic({
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      properties: { write: true, notify: true },
      startNotificationsError: domException("NetworkError"),
    });
    const device = createMockDevice({
      services: [createMockService(BROWER_TIMING_SERVICE_UUID, [athleteData])],
    });
    const controller = createBrowerBleDiagnosticController({
      bluetooth: createMockBluetooth({ device }),
      isSecureContext: true,
      nodeEnv: "test",
    });

    await controller.connect("timing-service-filter");
    await controller.startNotifications();

    expect(athleteData.listeners).toHaveLength(0);
    expect(controller.getSnapshot().notificationsActive).toBe(false);
    expect(logKinds(controller)).toContain("notifications_failed");
  });
});

describe("the bounded memory-read experiment", () => {
  async function connectedAndListening(options: HarnessOptions = {}) {
    const harness = buildHarness(options);
    await harness.controller.connect("timing-service-filter");
    await harness.controller.startNotifications();
    return harness;
  }

  it("writes the exact documented bytes for the little-endian hypothesis", async () => {
    const { controller, athleteData } = await connectedAndListening();

    const outcome = await controller.sendAthleteDataRequest({
      startAddress: 4,
      stopAddress: 6,
      byteOrder: "little-endian",
    });

    expect(outcome).toEqual({ accepted: true });
    expect(athleteData.writeCalls).toEqual([
      { method: "withResponse", bytes: [0x55, 0x01, 0x04, 0x00, 0x06, 0x00, 0xaa] },
    ]);
  });

  it("writes the exact documented bytes for the big-endian hypothesis", async () => {
    const { controller, athleteData } = await connectedAndListening();

    await controller.sendAthleteDataRequest({
      startAddress: 4,
      stopAddress: 6,
      byteOrder: "big-endian",
    });

    expect(athleteData.writeCalls).toEqual([
      { method: "withResponse", bytes: [0x55, 0x01, 0x00, 0x04, 0x00, 0x06, 0xaa] },
    ]);
  });

  it("records the chosen hypothesis with the successful write", async () => {
    const { controller } = await connectedAndListening();

    await controller.sendAthleteDataRequest({
      startAddress: 2,
      stopAddress: 4,
      byteOrder: "big-endian",
    });

    const entry = controller
      .getSnapshot()
      .log.entries.find((item) => item.kind === "command_write");
    expect(entry?.direction).toBe("tx");
    expect(entry?.payload?.hex).toBe("55 01 00 02 00 04 AA");
    expect(entry?.detail).toMatchObject({
      byteOrderHypothesis: "big-endian",
      startAddress: 2,
      stopAddress: 4,
      writeMethod: "writeValueWithResponse",
    });
    expect(entry?.message).toContain("unverified hypothesis");
  });

  it("records a failed write distinctly from a successful one", async () => {
    const { controller } = await connectedAndListening({
      writeError: domException("NetworkError"),
    });

    await controller.sendAthleteDataRequest({
      startAddress: 1,
      stopAddress: 2,
      byteOrder: "little-endian",
    });

    const kinds = logKinds(controller);
    expect(kinds).toContain("command_write_failed");
    expect(kinds).not.toContain("command_write");
    // A failed write must not open an observation window.
    expect(controller.getSnapshot().observationWindowActive).toBe(false);
  });

  it("refuses to send before a notification subscription exists", async () => {
    const { controller, athleteData } = buildHarness();
    await controller.connect("timing-service-filter");

    const outcome = await controller.sendAthleteDataRequest({
      startAddress: 1,
      stopAddress: 2,
      byteOrder: "little-endian",
    });

    expect(outcome).toEqual({
      accepted: false,
      reason:
        "Subscribe to Athlete Data notifications first — replies arrive only through that subscription.",
    });
    expect(athleteData.writeCalls).toHaveLength(0);
  });

  it("refuses to send without an explicit byte-order hypothesis", async () => {
    const { controller, athleteData } = await connectedAndListening();

    const outcome = await controller.sendAthleteDataRequest({
      startAddress: 1,
      stopAddress: 2,
      byteOrder: null as unknown as "little-endian",
    });

    expect(outcome).toEqual({
      accepted: false,
      reason: "Select a byte-order hypothesis before sending.",
    });
    expect(athleteData.writeCalls).toHaveLength(0);
  });

  it("refuses an out-of-range or oversized request without writing anything", async () => {
    const { controller, athleteData } = await connectedAndListening();

    expect(
      await controller.sendAthleteDataRequest({
        startAddress: 0,
        stopAddress: 2,
        byteOrder: "little-endian",
      })
    ).toMatchObject({ accepted: false });
    expect(
      await controller.sendAthleteDataRequest({
        startAddress: 1,
        stopAddress: 500,
        byteOrder: "little-endian",
      })
    ).toMatchObject({ accepted: false });
    expect(
      await controller.sendAthleteDataRequest({
        startAddress: 10,
        stopAddress: 1,
        byteOrder: "little-endian",
      })
    ).toMatchObject({ accepted: false });
    expect(
      await controller.sendAthleteDataRequest({
        startAddress: 1,
        stopAddress: 30,
        byteOrder: "little-endian",
      })
    ).toMatchObject({ accepted: false });

    expect(athleteData.writeCalls).toHaveLength(0);
  });

  it("uses write-without-response only when that is the supported property", async () => {
    const { controller, athleteData } = await connectedAndListening({
      athleteDataProperties: { write: false, writeWithoutResponse: true, notify: true },
    });

    await controller.sendAthleteDataRequest({
      startAddress: 1,
      stopAddress: 1,
      byteOrder: "little-endian",
    });

    expect(athleteData.writeCalls[0].method).toBe("withoutResponse");
  });

  it("refuses to send when no write property is advertised", async () => {
    const { controller, athleteData } = await connectedAndListening({
      athleteDataProperties: { write: false, writeWithoutResponse: false, notify: true },
    });

    const outcome = await controller.sendAthleteDataRequest({
      startAddress: 1,
      stopAddress: 1,
      byteOrder: "little-endian",
    });

    expect(outcome).toMatchObject({ accepted: false });
    expect(athleteData.writeCalls).toHaveLength(0);
  });

  it("rejects an overlapping request while the observation window is open", async () => {
    const { controller, athleteData } = await connectedAndListening();

    await controller.sendAthleteDataRequest({
      startAddress: 1,
      stopAddress: 2,
      byteOrder: "little-endian",
    });
    expect(controller.getSnapshot().observationWindowActive).toBe(true);

    const second = await controller.sendAthleteDataRequest({
      startAddress: 3,
      stopAddress: 4,
      byteOrder: "little-endian",
    });

    expect(second).toMatchObject({ accepted: false });
    expect(athleteData.writeCalls).toHaveLength(1);
  });

  it("closes the observation window on a timeout that it does not describe as proof", async () => {
    vi.useFakeTimers();
    const harness = buildHarness();
    await harness.controller.connect("timing-service-filter");
    await harness.controller.startNotifications();
    await harness.controller.sendAthleteDataRequest({
      startAddress: 1,
      stopAddress: 2,
      byteOrder: "little-endian",
    });

    expect(harness.controller.getSnapshot().observationWindowActive).toBe(true);

    vi.advanceTimersByTime(BROWER_OBSERVATION_WINDOW_MS);

    expect(harness.controller.getSnapshot().observationWindowActive).toBe(false);
    const closed = harness.controller
      .getSnapshot()
      .log.entries.find((entry) => entry.kind === "observation_window_closed");
    expect(closed?.message).toContain("not proof");
  });

  it("still records a notification that arrives after the window closed, uncorrelated", async () => {
    vi.useFakeTimers();
    const harness = buildHarness();
    await harness.controller.connect("timing-service-filter");
    await harness.controller.startNotifications();
    await harness.controller.sendAthleteDataRequest({
      startAddress: 1,
      stopAddress: 2,
      byteOrder: "little-endian",
    });

    vi.advanceTimersByTime(BROWER_OBSERVATION_WINDOW_MS + 1000);
    harness.athleteData.emitNotification(new Uint8Array([0x09, 0x08]));

    expect(harness.controller.getSnapshot().notificationCount).toBe(1);
    expect(harness.controller.getSnapshot().notifications[0].hex).toBe("09 08");
  });

  it("never polls, retries or sends a second command by itself", async () => {
    vi.useFakeTimers();
    const harness = buildHarness();
    await harness.controller.connect("timing-service-filter");
    await harness.controller.startNotifications();
    await harness.controller.sendAthleteDataRequest({
      startAddress: 1,
      stopAddress: 2,
      byteOrder: "little-endian",
    });

    vi.advanceTimersByTime(BROWER_OBSERVATION_WINDOW_MS * 10);

    expect(harness.athleteData.writeCalls).toHaveLength(1);
  });
});

describe("no automatic or undocumented writes", () => {
  it("writes nothing during selection, discovery, reads, subscription or disconnect", async () => {
    const { controller, athleteData } = buildHarness();

    await controller.connect("timing-service-filter");
    await controller.readCharacteristic(BROWER_TIME_BASE_CHARACTERISTIC_UUID);
    await controller.startNotifications();
    await controller.stopNotifications();
    await controller.disconnect();

    expect(athleteData.writeCalls).toHaveLength(0);
  });

  it("only ever emits command type 0x01 framed by 0x55/0xAA", async () => {
    const { controller, athleteData } = buildHarness();
    await controller.connect("timing-service-filter");
    await controller.startNotifications();

    await controller.sendAthleteDataRequest({
      startAddress: 1,
      stopAddress: 3,
      byteOrder: "little-endian",
    });

    athleteData.writeCalls.forEach((call) => {
      expect(call.bytes).toHaveLength(7);
      expect(call.bytes[0]).toBe(0x55);
      expect(call.bytes[1]).toBe(0x01);
      // 0x0A is New Athlete — state-changing and never sent by this diagnostic.
      expect(call.bytes[1]).not.toBe(0x0a);
      expect(call.bytes[6]).toBe(0xaa);
    });
  });

  it("does not reconnect by itself after a disconnect", async () => {
    vi.useFakeTimers();
    const harness = buildHarness();

    await harness.controller.connect("timing-service-filter");
    await harness.controller.disconnect();
    const connectsAfterDisconnect = harness.device.gatt.connectCallCount;

    vi.advanceTimersByTime(60_000);

    expect(harness.device.gatt.connectCallCount).toBe(connectsAfterDisconnect);
    expect(harness.bluetooth.requestDeviceCalls).toHaveLength(1);
  });
});

describe("lifecycle and stale completions", () => {
  it("releases a GATT connection that completes after the view was released", async () => {
    const gate = deferred<void>();
    const device = createMockDevice({
      services: [
        createMockService(BROWER_TIMING_SERVICE_UUID, [
          createMockCharacteristic({
            uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
            properties: { write: true, notify: true },
          }),
        ]),
      ],
      connectGate: gate.promise,
    });
    const controller = createBrowerBleDiagnosticController({
      bluetooth: createMockBluetooth({ device }),
      isSecureContext: true,
      nodeEnv: "test",
    });

    const connecting = controller.connect("timing-service-filter");
    await vi.waitFor(() => expect(device.gatt.connectCallCount).toBe(1));

    controller.release();
    gate.resolve();
    await connecting;

    // The stale connect completed and was released rather than adopted.
    expect(device.gatt.connected).toBe(false);
    expect(device.gatt.disconnectCallCount).toBeGreaterThanOrEqual(1);
    expect(controller.getSnapshot().status).toBe("idle");
    expect(controller.getSnapshot().device).toBeNull();
  });

  it("drops a chooser that resolves after release without connecting", async () => {
    const gate = deferred<MockDevice>();
    const device = createMockDevice();
    const controller = createBrowerBleDiagnosticController({
      bluetooth: createMockBluetooth({ requestDeviceGate: gate.promise }),
      isSecureContext: true,
      nodeEnv: "test",
    });

    const connecting = controller.connect("all-devices");
    await vi.waitFor(() =>
      expect(controller.getSnapshot().status).toBe("selecting")
    );

    controller.release();
    gate.resolve(device);
    await connecting;

    expect(device.gatt.connectCallCount).toBe(0);
    expect(controller.getSnapshot().device).toBeNull();
  });

  it("never runs an operation queued before a release", async () => {
    const { controller, bluetooth } = buildHarness();

    const connecting = controller.connect("timing-service-filter");
    controller.release();
    await connecting;

    expect(bluetooth.requestDeviceCalls).toHaveLength(0);
  });

  it("cancels a pending read when the connection is released mid-flight", async () => {
    const { controller, timeBase } = buildHarness();
    await controller.connect("timing-service-filter");

    const reading = controller.readCharacteristic(BROWER_TIME_BASE_CHARACTERISTIC_UUID);
    controller.release();
    await reading;

    // Only the single read performed during connect; the queued one was cancelled.
    expect(timeBase.readCallCount).toBe(1);
  });

  it("cancels a queued command write when the connection is released first", async () => {
    const { controller, athleteData } = buildHarness();
    await controller.connect("timing-service-filter");
    await controller.startNotifications();

    const sending = controller.sendAthleteDataRequest({
      startAddress: 1,
      stopAddress: 2,
      byteOrder: "little-endian",
    });
    controller.release();
    await sending;

    expect(athleteData.writeCalls).toHaveLength(0);
  });

  it("treats an unexpected disconnect as an immediate invalidation", async () => {
    const { controller, device, athleteData } = buildHarness();
    await controller.connect("timing-service-filter");
    await controller.startNotifications();

    device.emitUnexpectedDisconnect();

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("disconnected");
    expect(snapshot.failure).toContain("connection to the timer was lost");
    expect(snapshot.notificationsActive).toBe(false);
    expect(athleteData.listeners).toHaveLength(0);
    expect(logKinds(controller)).toContain("unexpected_disconnect");

    // A late notification from the dead connection changes nothing.
    athleteData.emitNotification(new Uint8Array([0x01]));
    expect(controller.getSnapshot().notificationCount).toBe(0);
  });

  it("does not report our own disconnect as unexpected", async () => {
    const { controller, device } = buildHarness();
    await controller.connect("timing-service-filter");

    await controller.disconnect();
    // Whatever the platform does after our own disconnect must not be reported as a loss.
    device.emitUnexpectedDisconnect();

    expect(logKinds(controller)).not.toContain("unexpected_disconnect");
    expect(controller.getSnapshot().status).toBe("disconnected");
    expect(device.disconnectListeners).toHaveLength(0);
  });

  it("releases the previous connection and its listeners when Connect is clicked again", async () => {
    const { controller, device, athleteData, bluetooth } = buildHarness();

    await controller.connect("timing-service-filter");
    await controller.startNotifications();
    expect(athleteData.listeners).toHaveLength(1);

    await controller.connect("timing-service-filter");

    expect(bluetooth.requestDeviceCalls).toHaveLength(2);
    expect(device.gatt.disconnectCallCount).toBeGreaterThanOrEqual(1);
    // Exactly one disconnect listener and no stale notification listener survives.
    expect(device.disconnectListeners).toHaveLength(1);
    expect(athleteData.listeners).toHaveLength(0);
  });

  it("stays usable after release, as a Strict Mode remount requires", async () => {
    const { controller, device } = buildHarness();

    await controller.connect("timing-service-filter");
    controller.release();
    await controller.connect("timing-service-filter");

    expect(controller.getSnapshot().status).toBe("connected");
    expect(device.gatt.connectCallCount).toBe(2);
    expect(device.disconnectListeners).toHaveLength(1);
  });

  it("clears transient connection state but keeps the log on release", async () => {
    const { controller } = buildHarness();

    await controller.connect("timing-service-filter");
    const entriesBefore = controller.getSnapshot().log.entries.length;
    expect(entriesBefore).toBeGreaterThan(0);

    controller.release();

    const snapshot = controller.getSnapshot();
    expect(snapshot.device).toBeNull();
    expect(snapshot.reads).toHaveLength(0);
    expect(snapshot.notifications).toHaveLength(0);
    expect(snapshot.log.entries).toHaveLength(entriesBefore);
  });

  it("completes the remaining cleanup when one teardown step throws", async () => {
    const { controller, device, athleteData } = buildHarness();
    await controller.connect("timing-service-filter");
    await controller.startNotifications();

    athleteData.stopNotifications = async () => {
      throw new Error("synthetic teardown failure");
    };

    expect(() => controller.release()).not.toThrow();
    expect(device.gatt.disconnectCallCount).toBeGreaterThanOrEqual(1);
    expect(device.disconnectListeners).toHaveLength(0);
  });
});

describe("the log", () => {
  it("emits a snapshot to subscribers without emitting on subscribe", async () => {
    const { controller } = buildHarness();
    const listener = vi.fn();

    const unsubscribe = controller.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();

    await controller.connect("timing-service-filter");
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    const callsAfterUnsubscribe = listener.mock.calls.length;
    await controller.disconnect();
    expect(listener.mock.calls).toHaveLength(callsAfterUnsubscribe);
  });

  it("records connection boundaries and observed properties", async () => {
    const { controller } = buildHarness();

    await controller.connect("timing-service-filter");
    await controller.disconnect();

    const kinds = logKinds(controller);
    expect(kinds).toContain("device_selection_requested");
    expect(kinds).toContain("device_selected");
    expect(kinds).toContain("connected");
    expect(kinds).toContain("service_discovered");
    expect(kinds).toContain("characteristic_discovered");
    expect(kinds).toContain("disconnected");

    const discovered = controller
      .getSnapshot()
      .log.entries.find(
        (entry) =>
          entry.kind === "characteristic_discovered" &&
          entry.uuid === BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID
      );
    expect(discovered?.detail).toMatchObject({ write: true, notify: true, read: false });
  });

  it("carries no account, Profile or credential identifier", async () => {
    const { controller, athleteData } = buildHarness();
    await controller.connect("timing-service-filter");
    await controller.startNotifications();
    athleteData.emitNotification(new Uint8Array([0x01, 0x02]));

    const serialized = JSON.stringify(controller.getSnapshot().log).toLowerCase();

    ["profile", "account", "token", "supabase", "credential", "session_id", "email"].forEach(
      (forbidden) => {
        expect(serialized).not.toContain(forbidden);
      }
    );
  });

  it("clears only its own entries, never the timer's memory", async () => {
    const { controller, athleteData } = buildHarness();
    await controller.connect("timing-service-filter");

    controller.clearLog();

    expect(controller.getSnapshot().log.entries).toHaveLength(0);
    // Clearing the log writes nothing to the device.
    expect(athleteData.writeCalls).toHaveLength(0);
    expect(controller.getSnapshot().status).toBe("connected");
  });
});
