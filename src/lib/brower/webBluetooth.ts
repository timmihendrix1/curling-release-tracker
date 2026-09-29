// A deliberately minimal structural description of the Web Bluetooth surface this
// diagnostic uses. TypeScript's `lib.dom` does not declare Web Bluetooth, and adding a
// dependency for an experimental API used by one development-only screen is not worth
// it — these interfaces describe exactly the members the controller touches, and
// nothing more.
//
// Declaring the surface structurally (rather than reaching for `navigator.bluetooth`
// through a cast at each call site) is also what makes the controller testable: an
// automated test injects an object implementing these interfaces. Such a mock proves
// the controller's own logic and lifecycle. It proves nothing whatsoever about real TCi
// firmware behaviour.

export interface BrowerCharacteristicPropertiesLike {
  read?: boolean;
  write?: boolean;
  writeWithoutResponse?: boolean;
  notify?: boolean;
  indicate?: boolean;
}

export interface BrowerCharacteristicLike {
  uuid: string;
  properties: BrowerCharacteristicPropertiesLike;
  readValue(): Promise<DataView>;
  // Narrowed to the only payload shape this diagnostic ever writes. The real
  // signature accepts a wider `BufferSource`; accepting less here is safe and avoids
  // the `ArrayBufferLike`/`ArrayBuffer` variance friction a wider type introduces.
  writeValueWithResponse?(value: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(value: Uint8Array): Promise<void>;
  startNotifications(): Promise<unknown>;
  stopNotifications(): Promise<unknown>;
  addEventListener(type: "characteristicvaluechanged", listener: (event: Event) => void): void;
  removeEventListener(
    type: "characteristicvaluechanged",
    listener: (event: Event) => void
  ): void;
}

export interface BrowerServiceLike {
  uuid: string;
  getCharacteristics(): Promise<BrowerCharacteristicLike[]>;
}

export interface BrowerGattServerLike {
  connected: boolean;
  connect(): Promise<BrowerGattServerLike>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BrowerServiceLike>;
}

export interface BrowerDeviceLike {
  /** Browser-generated, origin-scoped device identifier. NOT a manufacturer serial number. */
  id: string;
  name?: string | null;
  gatt?: BrowerGattServerLike;
  addEventListener(type: "gattserverdisconnected", listener: () => void): void;
  removeEventListener(type: "gattserverdisconnected", listener: () => void): void;
}

export type BrowerRequestDeviceOptions =
  | { filters: { services: string[] }[]; optionalServices?: string[] }
  | { acceptAllDevices: true; optionalServices?: string[] };

export interface BrowerBluetoothLike {
  getAvailability?(): Promise<boolean>;
  requestDevice(options: BrowerRequestDeviceOptions): Promise<BrowerDeviceLike>;
}

/**
 * Reads `navigator.bluetooth` without asserting it exists. Returns null on any
 * platform that does not expose it (Safari, Firefox, a non-Chromium browser, or a
 * Chromium build with the feature disabled), so callers can report an honest
 * unsupported state instead of throwing.
 */
export function resolveBluetoothApi(
  navigatorLike: unknown = typeof navigator === "undefined" ? undefined : navigator
): BrowerBluetoothLike | null {
  if (typeof navigatorLike !== "object" || navigatorLike === null) return null;
  const candidate = (navigatorLike as { bluetooth?: unknown }).bluetooth;
  if (typeof candidate !== "object" || candidate === null) return null;
  if (typeof (candidate as { requestDevice?: unknown }).requestDevice !== "function") {
    return null;
  }
  return candidate as BrowerBluetoothLike;
}

export type BrowerBrowserSupport =
  | { supported: true }
  | { supported: false; reason: "insecure-context" | "no-web-bluetooth" };

/**
 * Web Bluetooth requires a secure context. `http://localhost` counts as secure, which
 * is why the documented desktop procedure uses the dev server's localhost URL rather
 * than a LAN address.
 */
export function resolveBrowserSupport(
  bluetooth: BrowerBluetoothLike | null,
  isSecureContext: boolean
): BrowerBrowserSupport {
  if (!isSecureContext) return { supported: false, reason: "insecure-context" };
  if (bluetooth === null) return { supported: false, reason: "no-web-bluetooth" };
  return { supported: true };
}
