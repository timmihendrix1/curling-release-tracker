import { describe, expect, it } from "vitest";
import {
  BROWER_PROBE_READABLE_CHARACTERISTICS,
  BROWER_TIMING_SERVICE_UUID,
  browerCharacteristicLabel,
  copyBytesFromDataView,
  formatHexBytes,
} from "../probe/browerProtocol";
import { classifyProbeError, describeFailure } from "../probe/errors";
import { resolveProbePlatform } from "../probe/transport";
import { createFakeTransport } from "./fakes";

describe("platform resolution", () => {
  it("accepts native iOS", () => {
    expect(
      resolveProbePlatform({ isNativePlatform: () => true, getPlatform: () => "ios" })
    ).toEqual({ supported: true, platform: "ios" });
  });

  it("rejects a browser rather than reaching for Web Bluetooth", () => {
    expect(
      resolveProbePlatform({ isNativePlatform: () => false, getPlatform: () => "web" })
    ).toEqual({ supported: false, platform: "web", reason: "not_native" });
  });

  it("rejects native Android, which is out of scope for this experiment", () => {
    expect(
      resolveProbePlatform({ isNativePlatform: () => true, getPlatform: () => "android" })
    ).toEqual({ supported: false, platform: "android", reason: "not_ios" });
  });
});

describe("the transport boundary cannot write to the timer", () => {
  it("exposes no write operation at all", () => {
    const transport = createFakeTransport();
    const names = Object.keys(transport);
    for (const name of names) {
      expect(name.toLowerCase()).not.toContain("write");
    }
    expect(names).toContain("read");
    expect(names).toContain("startNotifications");
  });

  it("does not offer the Athlete Data characteristic as a read target", () => {
    const targets = BROWER_PROBE_READABLE_CHARACTERISTICS.map(
      (entry) => entry.characteristicUuid
    );
    expect(targets.map(browerCharacteristicLabel)).toEqual([
      "Time Base",
      "Power On Counter",
      "Serial Number",
    ]);
    expect(targets).not.toContain("bb8722a4-3810-4fd3-9321-f6cbdcc1ea4e");
  });

  it("uses the timing service UUID transcribed from the repository's protocol reference", () => {
    expect(BROWER_TIMING_SERVICE_UUID).toBe("11574949-d37a-4fd7-a171-f36fcdc3a461");
  });
});

describe("byte handling", () => {
  it("formats bytes as uppercase space-separated hex", () => {
    expect(formatHexBytes(new Uint8Array([0x00, 0x2b, 0x0d, 0xa2]))).toBe("00 2B 0D A2");
    expect(formatHexBytes(new Uint8Array([]))).toBe("");
  });

  it("copies out of a view whose buffer the producer still owns", () => {
    const buffer = new Uint8Array([1, 2, 3]);
    const copied = copyBytesFromDataView(new DataView(buffer.buffer));
    buffer.set([9, 9, 9]);
    expect(Array.from(copied)).toEqual([1, 2, 3]);
  });

  it("copies only the view's own window of a larger buffer", () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5]);
    const copied = copyBytesFromDataView(new DataView(buffer.buffer, 1, 3));
    expect(Array.from(copied)).toEqual([2, 3, 4]);
  });
});

describe("failure classification", () => {
  it("separates cancellation, permission, availability and absence", () => {
    expect(classifyProbeError(new Error("requestDevice cancelled"))).toBe("user_cancelled");
    expect(classifyProbeError(new Error("Bluetooth permission denied"))).toBe(
      "permission_denied"
    );
    expect(classifyProbeError(new Error("Bluetooth is powered off"))).toBe(
      "bluetooth_unavailable"
    );
    expect(classifyProbeError(new Error("No device found"))).toBe("device_not_found");
    expect(classifyProbeError(new Error("Operation timed out"))).toBe("timeout");
  });

  it("refuses to guess, rather than promoting an unrecognised failure into a confident one", () => {
    expect(classifyProbeError(new Error("Something odd happened"))).toBe("unknown_error");
    expect(classifyProbeError(undefined)).toBe("unknown_error");
    expect(classifyProbeError({ nothing: true })).toBe("unknown_error");
    expect(classifyProbeError("")).toBe("unknown_error");
  });

  it("returns its own fixed message, never text read off the thrown value", () => {
    const failure = describeFailure(classifyProbeError(new Error("secret internal detail")));
    expect(failure.message).not.toContain("secret internal detail");
    expect(failure.category).toBe("unknown_error");
  });
});
