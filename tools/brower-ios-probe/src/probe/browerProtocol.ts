// Brower TCi Timer BLE identifiers, for the native iOS transport probe.
//
// Every UUID here is transcribed from the repository's canonical protocol reference,
// `docs/BROWER_INTEGRATION_STATUS.md` ("Documented protocol facts" → "Services and
// characteristics"), which in turn transcribes the manufacturer document
// `docs/hardware/brower/TC Timer BLE to Smartphone BLE Communication V4.docx`.
// Nothing here is inferred from BLE convention.
//
// This file is deliberately a duplicate of a handful of constants rather than an
// import from `src/lib/brower/protocol.ts`. The probe is a standalone Capacitor
// project with its own dependency graph; importing the application module would drag
// a Next-bound source tree into it and couple a throwaway experiment to production
// code. The trade-off is stated openly in docs/BROWER_IOS_FEASIBILITY.md: these six
// values must be re-checked against the status document if it ever changes.
//
// What this file does NOT contain, on purpose:
//
//   - Any command builder. The probe cannot write to the timer at all — the native
//     transport boundary (`transport.ts`) declares no write operation, so there is no
//     code path through which a memory request, a New Athlete command, a channel or a
//     test command could be emitted.
//   - Any packet decoder. Gate C is partial (see the status document); a decoder
//     written today would put a guess on screen as a measurement.

/** Timing service. */
export const BROWER_TIMING_SERVICE_UUID = "11574949-d37a-4fd7-a171-f36fcdc3a461";

/** Athlete Data — results arrive here as notifications. */
export const BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID =
  "bb8722a4-3810-4fd3-9321-f6cbdcc1ea4e";

/** Time Base — documented readable, 4 bytes. */
export const BROWER_TIME_BASE_CHARACTERISTIC_UUID =
  "ee152c14-79a7-447d-b435-030880aa7d7d";

/** Power On Counter — documented readable, 16 bytes. */
export const BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID =
  "882c254a-d1f1-440f-8d08-4d0e5a9d4226";

/**
 * Serial Number service — a second, separate primary service, and an OPTIONAL one for
 * this probe's purposes. A timing connection that works without it is still a working
 * timing connection.
 */
export const BROWER_SERIAL_NUMBER_SERVICE_UUID = "ffae864c-ee9f-4f31-ad8a-9bcbac855a9f";

/** Serial Number characteristic. Its encoding is not documented. */
export const BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID =
  "beef94d7-4124-423d-82e0-5aa556bc722b";

export type ProbeServiceDescriptor = {
  uuid: string;
  label: string;
  /**
   * `false` means the probe reports its absence as an observation and carries on.
   * Only the timing service is required for a usable timing connection.
   */
  required: boolean;
};

export const BROWER_PROBE_SERVICES: readonly ProbeServiceDescriptor[] = [
  { uuid: BROWER_TIMING_SERVICE_UUID, label: "Timing", required: true },
  { uuid: BROWER_SERIAL_NUMBER_SERVICE_UUID, label: "Serial Number", required: false },
];

export type ProbeReadableCharacteristic = {
  serviceUuid: string;
  characteristicUuid: string;
  label: string;
  /** `true` for a characteristic whose absence must not invalidate the connection. */
  optional: boolean;
};

/**
 * The three characteristics this probe may read. Athlete Data is NOT here: the device
 * observed on 2026-09-25 advertised it as write+notify with no read property, and a
 * discovery instrument does not read a characteristic the device does not offer for
 * reading.
 */
export const BROWER_PROBE_READABLE_CHARACTERISTICS: readonly ProbeReadableCharacteristic[] =
  [
    {
      serviceUuid: BROWER_TIMING_SERVICE_UUID,
      characteristicUuid: BROWER_TIME_BASE_CHARACTERISTIC_UUID,
      label: "Time Base",
      optional: false,
    },
    {
      serviceUuid: BROWER_TIMING_SERVICE_UUID,
      characteristicUuid: BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID,
      label: "Power On Counter",
      optional: false,
    },
    {
      serviceUuid: BROWER_SERIAL_NUMBER_SERVICE_UUID,
      characteristicUuid: BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
      label: "Serial Number",
      optional: true,
    },
  ];

const KNOWN_LABELS = new Map<string, string>([
  [BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID, "Athlete Data"],
  [BROWER_TIME_BASE_CHARACTERISTIC_UUID, "Time Base"],
  [BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID, "Power On Counter"],
  [BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID, "Serial Number"],
]);

/** The documented name of a characteristic, or null for one the document does not name. */
export function browerCharacteristicLabel(uuid: string): string | null {
  return KNOWN_LABELS.get(uuid.toLowerCase()) ?? null;
}

const SERVICE_LABELS = new Map<string, string>([
  [BROWER_TIMING_SERVICE_UUID, "Timing"],
  [BROWER_SERIAL_NUMBER_SERVICE_UUID, "Serial Number"],
]);

export function browerServiceLabel(uuid: string): string | null {
  return SERVICE_LABELS.get(uuid.toLowerCase()) ?? null;
}

/** Uppercase space-separated hex — the one form this probe displays and exports. */
export function formatHexBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(
    " "
  );
}

/**
 * Copies a `DataView` handed over by the native bridge into an independent
 * `Uint8Array`, at receipt time.
 *
 * This is not defensive decoration. A `DataView` is a window onto a buffer the
 * producer still owns; if that buffer is reused for the next notification, a retained
 * view would silently rewrite an observation that has already been logged — the
 * failure would look like the timer sending the same bytes twice, which is exactly the
 * kind of claim this probe exists to get right.
 */
export function copyBytesFromDataView(view: DataView): Uint8Array {
  const bytes = new Uint8Array(view.byteLength);
  for (let index = 0; index < view.byteLength; index += 1) {
    bytes[index] = view.getUint8(index);
  }
  return bytes;
}
