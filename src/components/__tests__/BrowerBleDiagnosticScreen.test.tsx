// @vitest-environment jsdom
// The development-only Brower BLE diagnostic view, driven by an INJECTED MOCK
// Bluetooth API. Synthetic packets only — nothing here is evidence about real TCi
// firmware behaviour.
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import BrowerBleDiagnosticScreen from "../BrowerBleDiagnosticScreen";
import {
  BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
  BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID,
  BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
  BROWER_SERIAL_NUMBER_SERVICE_UUID,
  BROWER_TIME_BASE_CHARACTERISTIC_UUID,
  BROWER_TIMING_SERVICE_UUID,
} from "../../lib/brower/protocol";
import {
  createMockBluetooth,
  createMockCharacteristic,
  createMockDevice,
  createMockService,
  type MockBluetooth,
  type MockCharacteristic,
  type MockDevice,
} from "../../lib/brower/__tests__/mockBluetooth";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function buildMocks() {
  const athleteData = createMockCharacteristic({
    uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
    properties: { write: true, notify: true },
  });
  const timeBase = createMockCharacteristic({
    uuid: BROWER_TIME_BASE_CHARACTERISTIC_UUID,
    properties: { read: true },
    readValues: [new Uint8Array([0x10, 0x27, 0x00, 0x00])],
  });
  const powerOnCounter = createMockCharacteristic({
    uuid: BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID,
    properties: { read: true },
    readValues: [new Uint8Array(16).fill(0x02)],
  });
  const serialNumber = createMockCharacteristic({
    uuid: BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
    properties: { read: true },
    readValues: [new Uint8Array([0x41, 0x42])],
  });
  const device = createMockDevice({
    services: [
      createMockService(BROWER_TIMING_SERVICE_UUID, [athleteData, timeBase, powerOnCounter]),
      createMockService(BROWER_SERIAL_NUMBER_SERVICE_UUID, [serialNumber]),
    ],
  });
  const bluetooth = createMockBluetooth({ device });
  return { athleteData, timeBase, device, bluetooth };
}

function renderDiagnostic(
  overrides: { bluetooth?: MockBluetooth | null; isSecureContext?: boolean; nodeEnv?: string } = {},
  mocks?: { athleteData: MockCharacteristic; device: MockDevice; bluetooth: MockBluetooth }
) {
  const onClose = vi.fn();
  const result = render(
    <BrowerBleDiagnosticScreen
      onClose={onClose}
      controllerOptions={{
        bluetooth: overrides.bluetooth === undefined ? mocks?.bluetooth : overrides.bluetooth,
        isSecureContext: overrides.isSecureContext ?? true,
        nodeEnv: overrides.nodeEnv ?? "test",
      }}
    />
  );
  return { onClose, ...result };
}

async function connect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Select Device (timing service filter)" }));
  await waitFor(() =>
    expect(screen.getByTestId("brower-status")).toHaveTextContent("Status: connected")
  );
}

describe("production exclusion", () => {
  it("renders an unavailable notice and never touches Bluetooth in production", () => {
    const { bluetooth } = buildMocks();

    render(
      <BrowerBleDiagnosticScreen
        onClose={() => {}}
        controllerOptions={{ bluetooth, isSecureContext: true, nodeEnv: "production" }}
      />
    );

    expect(
      screen.getByText("This diagnostic is a development tool and is not available in this build.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Select Device (timing service filter)" })
    ).not.toBeInTheDocument();
    expect(bluetooth.requestDeviceCalls).toHaveLength(0);
  });

  it("uses the ambient NODE_ENV when no override is injected", () => {
    vi.stubEnv("NODE_ENV", "production");
    const requestDevice = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, bluetooth: { requestDevice } });

    render(<BrowerBleDiagnosticScreen onClose={() => {}} />);

    expect(
      screen.getByText("This diagnostic is a development tool and is not available in this build.")
    ).toBeInTheDocument();
    expect(requestDevice).not.toHaveBeenCalled();
  });
});

describe("browser capability", () => {
  it("explains an unsupported browser and offers no connect action", () => {
    renderDiagnostic({ bluetooth: null });

    expect(
      screen.getByText(
        "This browser does not support Web Bluetooth. Use Chrome on macOS for this diagnostic."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select Device (timing service filter)" })
    ).toBeDisabled();
  });

  it("explains an insecure context", () => {
    const { bluetooth } = buildMocks();
    renderDiagnostic({ bluetooth, isSecureContext: false });

    expect(
      screen.getByText(
        "Web Bluetooth needs a secure context. Open the app over the localhost development URL or HTTPS."
      )
    ).toBeInTheDocument();
  });
});

describe("connection", () => {
  it("does not open a chooser on mount", () => {
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    expect(mocks.bluetooth.requestDeviceCalls).toHaveLength(0);
    expect(screen.getByTestId("brower-status")).toHaveTextContent("Status: idle");
  });

  it("connects only on an explicit click and distinguishes the browser identifier from a serial number", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);

    expect(mocks.bluetooth.requestDeviceCalls).toHaveLength(1);
    expect(screen.getByText("Selected device: TCi Timer")).toBeInTheDocument();
    expect(
      screen.getByText(/Browser device identifier: mock-browser-device-id/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/It is not the manufacturer serial number/)
    ).toBeInTheDocument();
  });

  it("offers the fallback chooser and explains the advertising discrepancy", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    expect(
      screen.getByText(/advertising example carries a different service identifier/)
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Select Device (show all nearby devices)" }));

    await waitFor(() => expect(mocks.bluetooth.requestDeviceCalls).toHaveLength(1));
    expect(mocks.bluetooth.requestDeviceCalls[0]).toEqual({
      acceptAllDevices: true,
      optionalServices: [BROWER_TIMING_SERVICE_UUID, BROWER_SERIAL_NUMBER_SERVICE_UUID],
    });
  });

  it("shows discovered services with their actual properties", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);

    expect(screen.getByText("Timing service — found")).toBeInTheDocument();
    expect(screen.getByText("Serial Number service — found (optional)")).toBeInTheDocument();
    const athleteDataEntry = screen
      .getAllByRole("listitem")
      .find(
        (item) =>
          item.textContent?.includes("Athlete Data") === true &&
          item.textContent.includes(BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID)
      );
    expect(athleteDataEntry?.textContent).toContain("write, notify");
  });

  it("shows raw read bytes and their length without interpreting them", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);

    // The same raw bytes appear in the reads list and again in the diagnostic log.
    await waitFor(() => expect(screen.getAllByText("10 27 00 00").length).toBeGreaterThan(0));
    expect(screen.getByText(/Time Base · 4 bytes/)).toBeInTheDocument();
    expect(screen.getByText(/no number is derived from them here/)).toBeInTheDocument();
  });
});

describe("notifications", () => {
  it("records each notification as its own raw byte sequence", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);
    await user.click(screen.getByRole("button", { name: "Start Listening" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop Listening" })).toBeEnabled()
    );

    act(() => {
      mocks.athleteData.emitNotification(new Uint8Array([0x0a, 0x0b, 0x0c]));
    });

    await waitFor(() =>
      expect(screen.getByTestId("brower-notification-count")).toHaveTextContent(
        "1 notification received"
      )
    );
    expect(screen.getAllByText("0A 0B 0C").length).toBeGreaterThan(0);
  });

  it("explains why a subscription is unavailable when the device does not advertise notify", async () => {
    const user = userEvent.setup();
    const athleteData = createMockCharacteristic({
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      properties: { write: true, notify: false, indicate: false },
    });
    const device = createMockDevice({
      services: [createMockService(BROWER_TIMING_SERVICE_UUID, [athleteData])],
    });
    const bluetooth = createMockBluetooth({ device });

    render(
      <BrowerBleDiagnosticScreen
        onClose={() => {}}
        controllerOptions={{ bluetooth, isSecureContext: true, nodeEnv: "test" }}
      />
    );
    await connect(user);

    expect(
      screen.getByText(
        "This device does not advertise notify or indicate for Athlete Data, so no subscription was attempted."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Listening" })).toBeDisabled();
    expect(athleteData.startNotificationsCallCount).toBe(0);
  });

  it("says that silence alone does not mean the connection failed", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);

    expect(
      screen.getByText(
        "No notification received yet. Silence does not by itself mean the connection failed."
      )
    ).toBeInTheDocument();
  });
});

describe("the memory read experiment", () => {
  it("keeps Send disabled until a byte-order hypothesis is chosen", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);
    await user.click(screen.getByRole("button", { name: "Start Listening" }));

    expect(screen.getByRole("button", { name: "Send Request" })).toBeDisabled();
    expect(screen.getByTestId("brower-command-preview")).toHaveTextContent(
      "Select a byte-order hypothesis and a valid range."
    );

    await user.click(
      screen.getByRole("radio", { name: "Little-endian (least significant byte first)" })
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send Request" })).toBeEnabled()
    );
  });

  it("keeps Send disabled until a notification subscription exists", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);
    await user.click(
      screen.getByRole("radio", { name: "Little-endian (least significant byte first)" })
    );

    expect(screen.getByRole("button", { name: "Send Request" })).toBeDisabled();
    expect(
      screen.getByText(/Start listening for Athlete Data notifications first/)
    ).toBeInTheDocument();
  });

  it("previews the exact bytes for each explicitly chosen hypothesis", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await user.clear(screen.getByLabelText("Start address"));
    await user.type(screen.getByLabelText("Start address"), "4");
    await user.clear(screen.getByLabelText("Stop address"));
    await user.type(screen.getByLabelText("Stop address"), "6");

    await user.click(
      screen.getByRole("radio", { name: "Little-endian (least significant byte first)" })
    );
    expect(screen.getByTestId("brower-command-preview")).toHaveTextContent(
      "55 01 04 00 06 00 AA"
    );

    await user.click(
      screen.getByRole("radio", { name: "Big-endian (most significant byte first)" })
    );
    expect(screen.getByTestId("brower-command-preview")).toHaveTextContent(
      "55 01 00 04 00 06 AA"
    );
  });

  it("refuses a fractional address instead of truncating it to a different address", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);
    await user.click(screen.getByRole("button", { name: "Start Listening" }));
    await user.click(
      screen.getByRole("radio", { name: "Big-endian (most significant byte first)" })
    );

    await user.clear(screen.getByLabelText("Start address"));
    await user.type(screen.getByLabelText("Start address"), "1.9");

    // The reproduced defect: Send stayed enabled and 55 01 00 01 00 03 AA was written,
    // i.e. address 1 rather than anything the operator typed.
    expect(screen.getByRole("button", { name: "Send Request" })).toBeDisabled();
    expect(screen.getByTestId("brower-command-preview")).toHaveTextContent(
      "Select a byte-order hypothesis and a valid range."
    );
    expect(
      screen.getByText(
        "Addresses must be whole numbers written in full digits — no decimal point, sign, or exponent."
      )
    ).toBeInTheDocument();
    expect(mocks.athleteData.writeCalls).toHaveLength(0);
  });

  it("marks only the malformed field as invalid", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await user.clear(screen.getByLabelText("Start address"));
    await user.type(screen.getByLabelText("Start address"), "1.9");

    expect(screen.getByLabelText("Start address")).toHaveAttribute("aria-invalid", "true");
    // The stop field is well-formed; only the range as a whole is unusable.
    expect(screen.getByLabelText("Stop address")).toHaveAttribute("aria-invalid", "false");
  });

  it("refuses exponent-form input rather than reinterpreting it", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);
    await user.click(screen.getByRole("button", { name: "Start Listening" }));
    await user.click(
      screen.getByRole("radio", { name: "Little-endian (least significant byte first)" })
    );

    await user.clear(screen.getByLabelText("Start address"));
    await user.type(screen.getByLabelText("Start address"), "1e2");

    expect(screen.getByRole("button", { name: "Send Request" })).toBeDisabled();
    expect(mocks.athleteData.writeCalls).toHaveLength(0);
  });

  it("refuses an empty address field", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);
    await user.click(screen.getByRole("button", { name: "Start Listening" }));
    await user.click(
      screen.getByRole("radio", { name: "Little-endian (least significant byte first)" })
    );
    await user.clear(screen.getByLabelText("Stop address"));

    expect(screen.getByText("Enter a start and stop address.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Request" })).toBeDisabled();
    expect(mocks.athleteData.writeCalls).toHaveLength(0);
  });

  it("writes exactly the boundary addresses the operator typed", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);
    await user.click(screen.getByRole("button", { name: "Start Listening" }));
    await user.clear(screen.getByLabelText("Start address"));
    await user.type(screen.getByLabelText("Start address"), "499");
    await user.clear(screen.getByLabelText("Stop address"));
    await user.type(screen.getByLabelText("Stop address"), "499");
    await user.click(
      screen.getByRole("radio", { name: "Big-endian (most significant byte first)" })
    );

    expect(screen.getByTestId("brower-command-preview")).toHaveTextContent(
      "55 01 01 F3 01 F3 AA"
    );

    await user.click(screen.getByRole("button", { name: "Send Request" }));
    await waitFor(() => expect(mocks.athleteData.writeCalls).toHaveLength(1));
    // The preview and the bytes on the wire agree, and both carry address 499.
    expect(mocks.athleteData.writeCalls[0].bytes).toEqual([
      0x55, 0x01, 0x01, 0xf3, 0x01, 0xf3, 0xaa,
    ]);
  });

  it("refuses an out-of-range address without writing anything", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);
    await user.click(screen.getByRole("button", { name: "Start Listening" }));
    await user.click(
      screen.getByRole("radio", { name: "Little-endian (least significant byte first)" })
    );
    await user.clear(screen.getByLabelText("Start address"));
    await user.type(screen.getByLabelText("Start address"), "500");

    expect(screen.getByRole("button", { name: "Send Request" })).toBeDisabled();
    expect(mocks.athleteData.writeCalls).toHaveLength(0);
  });

  it("labels both orderings as experimental hypotheses with no default", async () => {
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    expect(
      screen.getByText(/Both options below are experimental hypotheses; neither is a confirmed default/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the timer may return a different range than the one you asked for/)
    ).toBeInTheDocument();
    screen.getAllByRole("radio").forEach((radio) => expect(radio).not.toBeChecked());
  });

  it("rejects an invalid range without writing anything", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);
    await user.click(screen.getByRole("button", { name: "Start Listening" }));
    await user.click(
      screen.getByRole("radio", { name: "Little-endian (least significant byte first)" })
    );

    await user.clear(screen.getByLabelText("Stop address"));
    await user.type(screen.getByLabelText("Stop address"), "500");

    expect(
      screen.getByText("Start and stop must be between 1 and 499.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Request" })).toBeDisabled();
    expect(mocks.athleteData.writeCalls).toHaveLength(0);
  });

  it("sends exactly one bounded 0x01 request and opens a non-authoritative observation window", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);
    await user.click(screen.getByRole("button", { name: "Start Listening" }));
    await user.click(
      screen.getByRole("radio", { name: "Big-endian (most significant byte first)" })
    );
    await user.click(screen.getByRole("button", { name: "Send Request" }));

    await waitFor(() => expect(mocks.athleteData.writeCalls).toHaveLength(1));
    expect(mocks.athleteData.writeCalls[0].bytes).toEqual([
      0x55, 0x01, 0x00, 0x01, 0x00, 0x03, 0xaa,
    ]);
    expect(screen.getByTestId("brower-observation-window")).toHaveTextContent(
      /not proof that every reply has arrived/
    );
  });

  it("offers no arbitrary command console and no New Athlete action", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);
    await connect(user);

    expect(screen.queryByRole("button", { name: /New Athlete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear Memory/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset/i })).not.toBeInTheDocument();
    expect(screen.getByText(/never sends New Athlete, and never clears or resets the timer/))
      .toBeInTheDocument();
  });
});

describe("the log", () => {
  it("exports a versioned JSON file and revokes its object URL", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    const revokeObjectURL = vi.fn();
    let capturedBlob: Blob | null = null;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => {
        capturedBlob = blob;
        return "blob:mock";
      },
      revokeObjectURL,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderDiagnostic({}, mocks);
    await connect(user);
    await user.click(screen.getByRole("button", { name: "Export Log" }));

    expect(capturedBlob).not.toBeNull();
    const parsed = JSON.parse(await (capturedBlob as unknown as Blob).text()) as {
      schemaVersion: number;
      kind: string;
      entries: { kind: string }[];
      notes: string[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.kind).toBe("brower-tci-ble-diagnostic-log");
    expect(parsed.entries.map((entry) => entry.kind)).toContain("connected");
    expect(parsed.notes.join(" ")).toContain("No training or assessment record");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("warns that an exported log can contain device identifiers and athlete records", () => {
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    expect(
      screen.getByText(
        /An exported file can contain the browser's device identifier and raw athlete records read from the timer/
      )
    ).toBeInTheDocument();
  });

  it("says that clearing the log does not clear the timer's memory", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);
    await connect(user);

    expect(
      screen.getByText(/Clearing the log here does not clear the timer's memory/)
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear Log" }));

    await waitFor(() =>
      expect(screen.getByTestId("brower-log-summary")).toHaveTextContent("0 entries")
    );
    expect(mocks.athleteData.writeCalls).toHaveLength(0);
  });
});

describe("modal semantics and keyboard containment", () => {
  it("exposes dialog semantics with an accessible name and takes initial focus", async () => {
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Brower TCi BLE Diagnostic");
    await waitFor(() => expect(dialog).toHaveFocus());
  });

  it("keeps Tab and Shift+Tab inside the dialog rather than reaching the page behind it", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();

    render(
      <>
        <button type="button">Background navigation</button>
        <BrowerBleDiagnosticScreen
          onClose={() => {}}
          controllerOptions={{
            bluetooth: mocks.bluetooth,
            isSecureContext: true,
            nodeEnv: "test",
          }}
        />
      </>
    );

    const dialog = screen.getByRole("dialog");
    const background = screen.getByRole("button", { name: "Background navigation" });
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Forward from the last control wraps to the first, never to the background.
    last.focus();
    await user.tab();
    expect(background).not.toHaveFocus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(first).toHaveFocus();

    // Backward from the first control wraps to the last — the exact traversal that
    // previously reached the primary navigation behind the overlay.
    await user.tab({ shift: true });
    expect(background).not.toHaveFocus();
    expect(last).toHaveFocus();
  });

  it("contains Shift+Tab immediately after opening, before any control is used", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();

    render(
      <>
        <button type="button">Open BLE Diagnostic</button>
        <BrowerBleDiagnosticScreen
          onClose={() => {}}
          controllerOptions={{
            bluetooth: mocks.bluetooth,
            isSecureContext: true,
            nodeEnv: "test",
          }}
        />
      </>
    );

    const dialog = screen.getByRole("dialog");
    const background = screen.getByRole("button", { name: "Open BLE Diagnostic" });
    // The container itself holds focus at this point — the exact state the previous
    // handler fell through, because `Node.contains` reports a node as containing itself.
    await waitFor(() => expect(dialog).toHaveFocus());

    await user.tab({ shift: true });

    expect(background).not.toHaveFocus();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("contains Tab immediately after opening as well", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();

    render(
      <>
        <button type="button">Open BLE Diagnostic</button>
        <BrowerBleDiagnosticScreen
          onClose={() => {}}
          controllerOptions={{
            bluetooth: mocks.bluetooth,
            isSecureContext: true,
            nodeEnv: "test",
          }}
        />
      </>
    );

    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog).toHaveFocus());

    await user.tab();

    expect(screen.getByRole("button", { name: "Open BLE Diagnostic" })).not.toHaveFocus();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("contains Shift+Tab when the container holds focus again after connecting", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();

    render(
      <>
        <button type="button">Open BLE Diagnostic</button>
        <BrowerBleDiagnosticScreen
          onClose={() => {}}
          controllerOptions={{
            bluetooth: mocks.bluetooth,
            isSecureContext: true,
            nodeEnv: "test",
          }}
        />
      </>
    );

    await connect(user);

    // Connecting changes which controls exist and can leave focus back on the
    // container (a focused control becoming disabled does the same thing).
    const dialog = screen.getByRole("dialog");
    dialog.focus();
    expect(dialog).toHaveFocus();

    await user.tab({ shift: true });

    expect(screen.getByRole("button", { name: "Open BLE Diagnostic" })).not.toHaveFocus();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    const { onClose } = renderDiagnostic({}, mocks);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the trigger that is still present on close", async () => {
    const mocks = buildMocks();
    const trigger = document.createElement("button");
    trigger.textContent = "Open BLE Diagnostic";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { unmount } = renderDiagnostic({}, mocks);
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());

    unmount();

    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("does not force focus onto a trigger that no longer exists", async () => {
    const mocks = buildMocks();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = renderDiagnostic({}, mocks);
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());

    // Simulates the overlay unmounting because the athlete navigated away: the Settings
    // trigger is gone by the time cleanup runs.
    trigger.remove();

    expect(() => unmount()).not.toThrow();
  });
});

describe("discovery failures are shown as unknown, not as absence", () => {
  it("does not present a failed characteristic enumeration as an empty inspected service", async () => {
    const user = userEvent.setup();
    const athleteData = createMockCharacteristic({
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      properties: { write: true, notify: true },
    });
    const device = createMockDevice({
      services: [
        createMockService(BROWER_TIMING_SERVICE_UUID, [athleteData], {
          getCharacteristicsError: { name: "SecurityError", message: "synthetic" },
        }),
      ],
    });
    const bluetooth = createMockBluetooth({ device });

    render(
      <BrowerBleDiagnosticScreen
        onClose={() => {}}
        controllerOptions={{ bluetooth, isSecureContext: true, nodeEnv: "test" }}
      />
    );
    await connect(user);

    expect(screen.getByTestId("brower-discovery-incomplete")).toHaveTextContent(
      "not evidence that anything is missing from it"
    );
    expect(
      screen.getByText(
        "The service was found, but listing its characteristics failed. Which characteristics it exposes is unknown, not empty."
      )
    ).toBeInTheDocument();
    // The old wording would have claimed a successfully inspected, empty service.
    expect(screen.queryByText("This service exposes no characteristics.")).not.toBeInTheDocument();
  });

  it("calls Athlete Data unknown, not absent, when the enumeration failed", async () => {
    const user = userEvent.setup();
    const athleteData = createMockCharacteristic({
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      properties: { write: true, notify: true },
    });
    const device = createMockDevice({
      services: [
        createMockService(BROWER_TIMING_SERVICE_UUID, [athleteData], {
          getCharacteristicsError: { name: "SecurityError", message: "synthetic" },
        }),
      ],
    });
    const bluetooth = createMockBluetooth({ device });

    render(
      <BrowerBleDiagnosticScreen
        onClose={() => {}}
        controllerOptions={{ bluetooth, isSecureContext: true, nodeEnv: "test" }}
      />
    );
    await connect(user);

    // The services section already said discovery was incomplete; the notifications
    // section used to contradict it by claiming confirmed absence.
    expect(screen.getByTestId("brower-discovery-incomplete")).toBeInTheDocument();
    expect(screen.getByTestId("brower-athlete-data-unknown")).toHaveTextContent(
      "Whether this device exposes the Athlete Data characteristic is unknown"
    );
    expect(
      screen.queryByText(/The Athlete Data characteristic was not found on this device/)
    ).not.toBeInTheDocument();
    // An unusable subscription is never offered.
    expect(screen.getByRole("button", { name: "Start Listening" })).toBeDisabled();
    expect(athleteData.startNotificationsCallCount).toBe(0);
  });

  it("still says Athlete Data was not found when discovery succeeded without it", async () => {
    const user = userEvent.setup();
    const timeBase = createMockCharacteristic({
      uuid: BROWER_TIME_BASE_CHARACTERISTIC_UUID,
      properties: { read: true },
      readValues: [new Uint8Array([0x10, 0x27, 0x00, 0x00])],
    });
    const device = createMockDevice({
      services: [createMockService(BROWER_TIMING_SERVICE_UUID, [timeBase])],
    });
    const bluetooth = createMockBluetooth({ device });

    render(
      <BrowerBleDiagnosticScreen
        onClose={() => {}}
        controllerOptions={{ bluetooth, isSecureContext: true, nodeEnv: "test" }}
      />
    );
    await connect(user);

    expect(
      screen.getByText(/The Athlete Data characteristic was not found on this device/)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("brower-athlete-data-unknown")).not.toBeInTheDocument();
    expect(screen.queryByTestId("brower-discovery-incomplete")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Listening" })).toBeDisabled();
  });

  it("labels a service whose lookup failed as unknown rather than not found", async () => {
    const user = userEvent.setup();
    const athleteData = createMockCharacteristic({
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      properties: { write: true, notify: true },
    });
    const device = createMockDevice({
      services: [
        createMockService(BROWER_TIMING_SERVICE_UUID, [athleteData]),
        createMockService(BROWER_SERIAL_NUMBER_SERVICE_UUID, []),
      ],
      getPrimaryServiceErrors: {
        [BROWER_SERIAL_NUMBER_SERVICE_UUID]: { name: "NetworkError", message: "synthetic" },
      },
    });
    const bluetooth = createMockBluetooth({ device });

    render(
      <BrowerBleDiagnosticScreen
        onClose={() => {}}
        controllerOptions={{ bluetooth, isSecureContext: true, nodeEnv: "test" }}
      />
    );
    await connect(user);

    expect(
      screen.getByText("Serial Number service — lookup failed — unknown (optional)")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Serial Number service — not found (optional)")
    ).not.toBeInTheDocument();
  });

  it("still says not found when the device genuinely lacks the optional service", async () => {
    const user = userEvent.setup();
    const athleteData = createMockCharacteristic({
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      properties: { write: true, notify: true },
    });
    const device = createMockDevice({
      services: [createMockService(BROWER_TIMING_SERVICE_UUID, [athleteData])],
    });
    const bluetooth = createMockBluetooth({ device });

    render(
      <BrowerBleDiagnosticScreen
        onClose={() => {}}
        controllerOptions={{ bluetooth, isSecureContext: true, nodeEnv: "test" }}
      />
    );
    await connect(user);

    expect(
      screen.getByText("Serial Number service — not found (optional)")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("brower-discovery-incomplete")).not.toBeInTheDocument();
  });
});

describe("lifecycle", () => {
  it("states that it records no training result", () => {
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    expect(
      screen.getByText(
        "Nothing here records training. No shot, session, assessment or exercise result is created or changed, and nothing is saved to this device or your cloud account."
      )
    ).toBeInTheDocument();
  });

  it("releases the connection and every listener on unmount", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    const { unmount } = renderDiagnostic({}, mocks);

    await connect(user);
    await user.click(screen.getByRole("button", { name: "Start Listening" }));
    await waitFor(() => expect(mocks.athleteData.listeners).toHaveLength(1));

    unmount();

    expect(mocks.device.gatt.disconnectCallCount).toBeGreaterThanOrEqual(1);
    expect(mocks.device.gatt.connected).toBe(false);
    expect(mocks.athleteData.listeners).toHaveLength(0);
    expect(mocks.device.disconnectListeners).toHaveLength(0);
  });

  it("closes without connecting when Close is pressed", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    const { onClose } = renderDiagnostic({}, mocks);

    await user.click(screen.getByRole("button", { name: "Close BLE Diagnostic" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.bluetooth.requestDeviceCalls).toHaveLength(0);
  });

  it("survives React Strict Mode's double invoke without duplicate listeners", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    const onClose = vi.fn();

    render(
      <StrictMode>
        <BrowerBleDiagnosticScreen
          onClose={onClose}
          controllerOptions={{
            bluetooth: mocks.bluetooth,
            isSecureContext: true,
            nodeEnv: "test",
          }}
        />
      </StrictMode>
    );

    await connect(user);
    await user.click(screen.getByRole("button", { name: "Start Listening" }));
    await waitFor(() => expect(mocks.athleteData.listeners).toHaveLength(1));

    act(() => {
      mocks.athleteData.emitNotification(new Uint8Array([0x07]));
    });

    await waitFor(() =>
      expect(screen.getByTestId("brower-notification-count")).toHaveTextContent(
        "1 notification received"
      )
    );
    expect(mocks.device.disconnectListeners).toHaveLength(1);
  });

  it("persists nothing and creates no sporting record", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    localStorage.clear();
    const indexedDbOpen = vi.fn();
    vi.stubGlobal("indexedDB", { open: indexedDbOpen, deleteDatabase: vi.fn() });

    renderDiagnostic({}, mocks);
    await connect(user);
    await user.click(screen.getByRole("button", { name: "Start Listening" }));
    await user.click(
      screen.getByRole("radio", { name: "Little-endian (least significant byte first)" })
    );
    await user.click(screen.getByRole("button", { name: "Send Request" }));
    await waitFor(() => expect(mocks.athleteData.writeCalls).toHaveLength(1));

    act(() => {
      mocks.athleteData.emitNotification(new Uint8Array([0x01, 0x02, 0x03]));
    });
    await waitFor(() =>
      expect(screen.getByTestId("brower-notification-count")).toHaveTextContent(
        "1 notification received"
      )
    );

    expect(localStorage.length).toBe(0);
    expect(indexedDbOpen).not.toHaveBeenCalled();
  });

  it("reports a lost connection without reconnecting by itself", async () => {
    const user = userEvent.setup();
    const mocks = buildMocks();
    renderDiagnostic({}, mocks);

    await connect(user);
    const connectsBefore = mocks.device.gatt.connectCallCount;

    act(() => {
      mocks.device.emitUnexpectedDisconnect();
    });

    await waitFor(() =>
      expect(screen.getByTestId("brower-status")).toHaveTextContent("Status: disconnected")
    );
    expect(
      within(screen.getByRole("alert")).getByText(/connection to the timer was lost/)
    ).toBeInTheDocument();
    expect(mocks.device.gatt.connectCallCount).toBe(connectsBefore);
  });
});
