import { expect, test, type Page } from "@playwright/test";
import { freshLoad, goToSettings, primaryNav, readCloudSportingRecords } from "./utils";

// The development-only Brower TCi BLE diagnostic, driven end-to-end through the real
// application shell (real identity gate, real Settings screen, real overlay) against an
// INJECTED MOCK `navigator.bluetooth`. Every byte here is synthetic: this scenario
// proves the application's own flow and isolation, never real TCi firmware behaviour.

type BrowerMockState = {
  requestDeviceCalls: unknown[];
  writeCalls: number[][];
  connectCount: number;
  disconnectCount: number;
  notificationListenerCount: number;
  startNotificationsCount: number;
};

declare global {
  interface Window {
    __browerMock: BrowerMockState & { emitNotification: (bytes: number[]) => void };
  }
}

async function installBluetoothMock(page: Page) {
  await page.addInitScript(() => {
    const TIMING_SERVICE = "11574949-d37a-4fd7-a171-f36fcdc3a461";
    const ATHLETE_DATA = "bb8722a4-3810-4fd3-9321-f6cbdcc1ea4e";
    const TIME_BASE = "ee152c14-79a7-447d-b435-030880aa7d7d";
    const POWER_ON_COUNTER = "882c254a-d1f1-440f-8d08-4d0e5a9d4226";
    const SERIAL_SERVICE = "ffae864c-ee9f-4f31-ad8a-9bcbac855a9f";
    const SERIAL_CHARACTERISTIC = "beef94d7-4124-423d-82e0-5aa556bc722b";

    const state = {
      requestDeviceCalls: [] as unknown[],
      writeCalls: [] as number[][],
      connectCount: 0,
      disconnectCount: 0,
      notificationListenerCount: 0,
      startNotificationsCount: 0,
    };

    const notificationListeners: ((event: unknown) => void)[] = [];

    function makeReadable(uuid: string, bytes: number[]) {
      return {
        uuid,
        properties: {
          read: true,
          write: false,
          writeWithoutResponse: false,
          notify: false,
          indicate: false,
        },
        async readValue() {
          return new DataView(new Uint8Array(bytes).buffer);
        },
        async startNotifications() {
          throw new Error("not supported");
        },
        async stopNotifications() {
          throw new Error("not supported");
        },
        addEventListener() {},
        removeEventListener() {},
      };
    }

    const athleteData = {
      uuid: ATHLETE_DATA,
      properties: {
        read: false,
        write: true,
        writeWithoutResponse: false,
        notify: true,
        indicate: false,
      },
      async readValue() {
        throw new Error("not readable");
      },
      async writeValueWithResponse(value: Uint8Array) {
        state.writeCalls.push(Array.from(value));
      },
      async startNotifications() {
        state.startNotificationsCount += 1;
        return athleteData;
      },
      async stopNotifications() {
        return athleteData;
      },
      addEventListener(_type: string, listener: (event: unknown) => void) {
        notificationListeners.push(listener);
        state.notificationListenerCount = notificationListeners.length;
      },
      removeEventListener(_type: string, listener: (event: unknown) => void) {
        const index = notificationListeners.indexOf(listener);
        if (index >= 0) notificationListeners.splice(index, 1);
        state.notificationListenerCount = notificationListeners.length;
      },
    };

    const services = new Map([
      [
        TIMING_SERVICE,
        {
          uuid: TIMING_SERVICE,
          async getCharacteristics() {
            return [
              athleteData,
              makeReadable(TIME_BASE, [0x10, 0x27, 0x00, 0x00]),
              makeReadable(POWER_ON_COUNTER, new Array(16).fill(0x03)),
            ];
          },
        },
      ],
      [
        SERIAL_SERVICE,
        {
          uuid: SERIAL_SERVICE,
          async getCharacteristics() {
            return [makeReadable(SERIAL_CHARACTERISTIC, [0x54, 0x43, 0x69])];
          },
        },
      ],
    ]);

    const disconnectListeners: (() => void)[] = [];
    const server = {
      connected: false,
      async connect() {
        state.connectCount += 1;
        server.connected = true;
        return server;
      },
      disconnect() {
        state.disconnectCount += 1;
        server.connected = false;
      },
      async getPrimaryService(uuid: string) {
        const service = services.get(uuid);
        if (service === undefined) {
          const error = new Error("service not found");
          error.name = "NotFoundError";
          throw error;
        }
        return service;
      },
    };

    const device = {
      id: "e2e-mock-device-id",
      name: "TCi Timer (mock)",
      gatt: server,
      addEventListener(_type: string, listener: () => void) {
        disconnectListeners.push(listener);
      },
      removeEventListener(_type: string, listener: () => void) {
        const index = disconnectListeners.indexOf(listener);
        if (index >= 0) disconnectListeners.splice(index, 1);
      },
    };

    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: {
        async requestDevice(options: unknown) {
          state.requestDeviceCalls.push(options);
          return device;
        },
      },
    });

    window.__browerMock = {
      ...state,
      get requestDeviceCalls() {
        return state.requestDeviceCalls;
      },
      get writeCalls() {
        return state.writeCalls;
      },
      get connectCount() {
        return state.connectCount;
      },
      get disconnectCount() {
        return state.disconnectCount;
      },
      get notificationListenerCount() {
        return state.notificationListenerCount;
      },
      get startNotificationsCount() {
        return state.startNotificationsCount;
      },
      emitNotification(bytes: number[]) {
        const view = new DataView(new Uint8Array(bytes).buffer);
        [...notificationListeners].forEach((listener) =>
          listener({ target: { value: view } })
        );
      },
    } as Window["__browerMock"];
  });
}

async function openDiagnostic(page: Page) {
  await goToSettings(page);
  await page.getByRole("button", { name: "Open BLE Diagnostic" }).click();
  await expect(
    page.getByRole("heading", { name: "Brower TCi BLE Diagnostic" })
  ).toBeVisible();
}

test.describe("Brower TCi BLE diagnostic", () => {
  test("connects, reads, subscribes, sends one bounded request and cleans up", async ({
    page,
  }) => {
    await installBluetoothMock(page);
    await freshLoad(page);

    const storageBefore = await page.evaluate(() =>
      Object.fromEntries(Object.entries(localStorage))
    );

    await openDiagnostic(page);

    // The diagnostic is honest about what it is, and never opens a chooser by itself.
    await expect(
      page.getByText(
        "Nothing here records training. No shot, session, assessment or exercise result is created or changed, and nothing is saved to this device or your cloud account."
      )
    ).toBeVisible();
    expect(await page.evaluate(() => window.__browerMock.requestDeviceCalls.length)).toBe(0);
    await expect(page.getByTestId("brower-status")).toHaveText("Status: idle");

    // Explicit user gesture opens the chooser.
    await page
      .getByRole("button", { name: "Select Device (timing service filter)" })
      .click();
    await expect(page.getByTestId("brower-status")).toHaveText("Status: connected — Connected.");
    expect(await page.evaluate(() => window.__browerMock.connectCount)).toBe(1);

    await expect(page.getByText("Selected device: TCi Timer (mock)")).toBeVisible();
    await expect(page.getByText(/Browser device identifier: e2e-mock-device-id/)).toBeVisible();
    await expect(page.getByText("Timing service — found")).toBeVisible();
    await expect(page.getByText("Serial Number service — found (optional)")).toBeVisible();

    // Documented readable characteristics were read as raw bytes.
    await expect(page.getByText("10 27 00 00").first()).toBeVisible();
    await expect(page.getByText(/Time Base · 4 bytes/)).toBeVisible();

    // Notification subscription is explicit.
    await page.getByRole("button", { name: "Start Listening" }).click();
    await expect(page.getByRole("button", { name: "Stop Listening" })).toBeEnabled();
    expect(await page.evaluate(() => window.__browerMock.startNotificationsCount)).toBe(1);
    expect(await page.evaluate(() => window.__browerMock.notificationListenerCount)).toBe(1);

    await page.evaluate(() => window.__browerMock.emitNotification([0x01, 0x02, 0x03, 0x04]));
    await expect(page.getByTestId("brower-notification-count")).toContainText(
      "1 notification received"
    );
    await expect(page.getByText("01 02 03 04").first()).toBeVisible();

    // The bounded memory-read experiment requires an explicit byte-order hypothesis.
    await expect(page.getByRole("button", { name: "Send Request" })).toBeDisabled();
    await page
      .getByRole("radio", { name: "Big-endian (most significant byte first)" })
      .click();
    await page.getByRole("button", { name: "Send Request" }).click();

    await expect
      .poll(() => page.evaluate(() => window.__browerMock.writeCalls))
      .toEqual([[0x55, 0x01, 0x00, 0x01, 0x00, 0x03, 0xaa]]);
    await expect(page.getByTestId("brower-observation-window")).toContainText(
      "not proof that every reply has arrived"
    );

    // Closing the view releases the connection and every listener.
    await page.getByRole("button", { name: "Close BLE Diagnostic" }).click();
    await expect(
      page.getByRole("heading", { name: "Brower TCi BLE Diagnostic" })
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__browerMock.disconnectCount)
    ).toBeGreaterThanOrEqual(1);
    expect(await page.evaluate(() => window.__browerMock.notificationListenerCount)).toBe(0);

    // No sporting side effect of any kind, and no persisted diagnostic state.
    // Compared key by key rather than as a whole snapshot: the app's unrelated public
    // exercise-diagram cache legitimately writes its own keys while this runs, and
    // attributing those to the diagnostic would make the assertion meaningless.
    const storageAfter = await page.evaluate(() =>
      Object.fromEntries(Object.entries(localStorage))
    );
    const changedKeys = Array.from(
      new Set([...Object.keys(storageBefore), ...Object.keys(storageAfter)])
    ).filter((key) => storageBefore[key] !== storageAfter[key]);

    expect(changedKeys.filter((key) => key.startsWith("curling.sporting."))).toEqual([]);
    expect(changedKeys.filter((key) => /brower|bluetooth|diagnostic|ble/i.test(key))).toEqual(
      []
    );
    expect(await readCloudSportingRecords(page)).toEqual([]);
  });

  test("offers the fallback chooser and never sends a command by itself", async ({ page }) => {
    await installBluetoothMock(page);
    await freshLoad(page);
    await openDiagnostic(page);

    await page
      .getByRole("button", { name: "Select Device (show all nearby devices)" })
      .click();
    await expect(page.getByTestId("brower-status")).toHaveText("Status: connected — Connected.");

    expect(await page.evaluate(() => window.__browerMock.requestDeviceCalls)).toEqual([
      {
        acceptAllDevices: true,
        optionalServices: [
          "11574949-d37a-4fd7-a171-f36fcdc3a461",
          "ffae864c-ee9f-4f31-ad8a-9bcbac855a9f",
        ],
      },
    ]);

    // Connecting, discovering, reading and subscribing write nothing to the device.
    await page.getByRole("button", { name: "Start Listening" }).click();
    await expect(page.getByRole("button", { name: "Stop Listening" })).toBeEnabled();
    await page.getByRole("button", { name: "Read Time Base" }).click();
    await expect(page.getByTestId("brower-log-summary")).toContainText("entries");

    expect(await page.evaluate(() => window.__browerMock.writeCalls)).toEqual([]);

    // No New Athlete / clear / reset control exists anywhere in the view.
    await expect(page.getByRole("button", { name: /New Athlete/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Clear Memory/i })).toHaveCount(0);
  });

  test("contains focus from the moment it opens, before any control is used", async ({
    page,
  }) => {
    await installBluetoothMock(page);
    await freshLoad(page);
    await openDiagnostic(page);

    // No Connect, no Start Listening — this is the state the previous regression never
    // exercised, and the one in which the dialog container itself holds focus.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    const afterShiftTab = await page.evaluate(() => ({
      inside: document.activeElement?.closest('[role="dialog"]') !== null,
      text: document.activeElement?.textContent?.trim() ?? "",
    }));
    expect(afterShiftTab.inside).toBe(true);
    expect(afterShiftTab.text).not.toBe("Open BLE Diagnostic");

    // Forward from the container is contained too.
    await dialog.focus();
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null
      )
    ).toBe(true);

    // And again once the container regains focus after a connection.
    await page
      .getByRole("button", { name: "Select Device (timing service filter)" })
      .click();
    await expect(page.getByTestId("brower-status")).toHaveText("Status: connected — Connected.");
    await dialog.focus();
    await expect(dialog).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null
      )
    ).toBe(true);

    expect(await page.evaluate(() => window.__browerMock.disconnectCount)).toBe(0);
  });

  test("contains keyboard focus, and releases the connection when the view actually changes", async ({
    page,
  }) => {
    await installBluetoothMock(page);
    await freshLoad(page);
    await openDiagnostic(page);

    await page
      .getByRole("button", { name: "Select Device (timing service filter)" })
      .click();
    await expect(page.getByTestId("brower-status")).toHaveText("Status: connected — Connected.");
    await page.getByRole("button", { name: "Start Listening" }).click();
    await expect(page.getByRole("button", { name: "Stop Listening" })).toBeEnabled();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toHaveAccessibleName("Brower TCi BLE Diagnostic");

    // The reproduced defect: Shift+Tab reached the background primary navigation, and
    // activating it changed the page while the diagnostic stayed mounted and connected.
    // Focus must never leave the dialog in either direction.
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Shift+Tab");
      const insideDialog = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null
      );
      expect(insideDialog).toBe(true);
    }
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      const insideDialog = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null
      );
      expect(insideDialog).toBe(true);
    }

    // The navigation is still there, just not keyboard-reachable while this is open.
    await expect(primaryNav(page).getByRole("button", { name: "Home" })).toHaveCount(1);
    expect(await page.evaluate(() => window.__browerMock.disconnectCount)).toBe(0);

    // Force an actual view change the way a stray programmatic navigation would, rather
    // than relying on the overlay merely blocking pointer and keyboard input.
    await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="primary-nav-mobile"]');
      const home = Array.from(nav?.querySelectorAll("button") ?? []).find((button) =>
        (button.textContent ?? "").includes("Home")
      );
      if (home === undefined) throw new Error("The Home navigation button was not found.");
      home.click();
    });

    // Navigating away unmounts the diagnostic and releases everything it owned.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Today's Plan")).toBeVisible();
    expect(
      await page.evaluate(() => window.__browerMock.disconnectCount)
    ).toBeGreaterThanOrEqual(1);
    expect(await page.evaluate(() => window.__browerMock.notificationListenerCount)).toBe(0);

    // Returning to Settings must not resurrect it.
    await goToSettings(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open BLE Diagnostic" })).toBeVisible();
  });

  test.describe("without an authenticated profile", () => {
    // Same isolation the identity gate suite uses: a context with no stored session,
    // rather than mutating the shared fixture's state.
    test.use({ storageState: { cookies: [], origins: [] } });

    test("keeps the diagnostic behind the existing access gate", async ({ page }) => {
      await installBluetoothMock(page);
      await page.goto("/");

      await expect(page.getByRole("heading", { name: "Athlete access" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Open BLE Diagnostic" })).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Brower TCi BLE Diagnostic" })
      ).toHaveCount(0);
      expect(await page.evaluate(() => window.__browerMock.requestDeviceCalls.length)).toBe(0);
    });
  });
});
