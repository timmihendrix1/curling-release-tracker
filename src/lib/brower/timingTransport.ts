// The platform-isolated BLE boundary for the assisted Brower training pilot.
//
// This is a PRODUCTION boundary, written fresh rather than promoted from
// `tools/brower-ios-probe/` — that probe stays a separate instrument, and
// docs/MOBILE_APP_MIGRATION.md §M4 explicitly forbids its diagnostic architecture
// becoming the cross-platform boundary.
//
// **There is no write operation, and that is load-bearing.** Not a write that is never
// called — no method at all. The pilot authorises no command to the timer: no memory
// request, no New Athlete (`0x0A`), no channel or test command, no clear. Making the
// capability absent from the type means a future change that wanted to send one would
// have to widen this interface in a diff that is impossible to miss.
//
// Everything platform-specific lives in an implementation of this interface. iOS is the
// only one built today; an Android implementation would satisfy exactly this contract,
// which is what keeps the controller, decoder and state machine platform-neutral.

export type BrowerBleDevice = {
  /** Platform-assigned peripheral identifier. App- and device-scoped, NOT a serial number. */
  deviceId: string;
  name: string | null;
};

export interface BrowerTimingTransport {
  /** Triggers the platform Bluetooth permission prompt on first call. */
  initialize(): Promise<void>;
  /** Whether Bluetooth is powered on and usable. */
  isEnabled(): Promise<boolean>;
  /** Opens the platform device picker, filtered to the Brower timing service. */
  requestDevice(request: {
    services: string[];
    optionalServices: string[];
  }): Promise<BrowerBleDevice>;
  connect(deviceId: string, onDisconnect: (deviceId: string) => void): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  startNotifications(
    deviceId: string,
    service: string,
    characteristic: string,
    callback: (value: DataView) => void
  ): Promise<void>;
  stopNotifications(
    deviceId: string,
    service: string,
    characteristic: string
  ): Promise<void>;
}

/**
 * The injected app foreground/background boundary.
 *
 * iOS suspends a foreground app's JavaScript shortly after it leaves the screen, and
 * CoreBluetooth delivers nothing to a suspended app unless the app declares a background
 * Bluetooth mode. This pilot declares none (`UIBackgroundModes` is deliberately absent —
 * see docs/MOBILE_APP_MIGRATION.md's open decision P3), so a capture that "continued"
 * across backgrounding is not a capture that kept observing: it is one whose
 * observations stopped with nobody told.
 *
 * Backgrounding therefore ends active observation and requires an explicit re-arm.
 */
export interface BrowerAppLifecycleSource {
  /** Registers a foreground/background listener. Returns an idempotent unsubscribe. */
  onActiveStateChange(listener: (isActive: boolean) => void): () => void;
}

export type BrowerTransportAvailability =
  | { supported: true; platform: "ios" | "android" }
  | { supported: false; reason: "web" | "unsupported_native" };

/**
 * Decides whether a real transport may be constructed at all.
 *
 * Note what is absent: no branch that falls back to `navigator.bluetooth` when the
 * native check fails. The Web build reports "unsupported" and offers manual entry,
 * because desktop Web Bluetooth evidence transfers nothing to a phone and the pilot is
 * scoped to the installed native application.
 *
 * The iOS Simulator satisfies this check and still has no Bluetooth hardware. That is
 * not detectable here and is stated in the device checklist instead of guessed at.
 */
export function resolveBrowerTransportAvailability(
  platform: "web" | "ios" | "android" | "unsupported_native"
): BrowerTransportAvailability {
  if (platform === "ios" || platform === "android") {
    return { supported: true, platform };
  }
  return { supported: false, reason: platform === "web" ? "web" : "unsupported_native" };
}

/**
 * Copies a notification's bytes immediately, before any staleness or ownership check.
 *
 * The platform may reuse or neuter the underlying buffer once the callback returns, so
 * a later read of a retained `DataView` can yield different bytes than arrived. Copying
 * first means an obsolete packet is discarded as a decision, never corrupted by accident.
 */
export function copyBrowerPacketBytes(value: DataView): Uint8Array {
  const bytes = new Uint8Array(value.byteLength);
  for (let index = 0; index < value.byteLength; index += 1) {
    bytes[index] = value.getUint8(index);
  }
  return bytes;
}
