// The view model.
//
// Every "is this button usable, and if not, why not" decision lives here as a pure
// function of the snapshot. Two things follow: the disabled state and the reason shown
// next to it can never disagree, and the whole of the UI's decision-making is testable
// without a DOM.
//
// The copy follows the repository's UX writing discipline in the one respect that
// actually matters for an instrument like this: an observation and an interpretation
// are never stated in the same breath, and nothing the probe has not established is
// phrased as though it had been.
import type { ProbeSnapshot } from "../probe/probeController";

export type ProbeActionId =
  | "initialize"
  | "connect-filtered"
  | "connect-all"
  | "disconnect"
  | "start-listening"
  | "stop-listening"
  | "clear-log"
  | "export-log"
  | `read:${string}`;

export type ProbeActionView = {
  id: ProbeActionId;
  label: string;
  enabled: boolean;
  /** Why the action is unavailable. Null when it is available. */
  disabledReason: string | null;
  emphasis: "primary" | "secondary" | "destructive";
};

export type ProbeServiceView = {
  uuid: string;
  title: string;
  /** Exactly what discovery established. Never softened into "missing". */
  discoveryLabel: string;
  documented: boolean;
  characteristics: { uuid: string; title: string; properties: string }[];
};

export type ProbeObservationView = {
  id: string;
  title: string;
  hex: string;
  meta: string;
};

export type ProbeViewModel = {
  title: string;
  /** The one line that says what this app is. Always rendered. */
  identity: string;
  platformLine: string;
  bluetoothLine: string;
  connectionLine: string;
  failure: string | null;
  notices: string[];
  actions: ProbeActionView[];
  services: ProbeServiceView[];
  discoveryNotice: string | null;
  reads: ProbeObservationView[];
  notifications: ProbeObservationView[];
  notificationSummary: string;
  /** Present only when a native listener's release has not been confirmed. */
  listenerNotice: string | null;
  logSummary: string;
  exportLine: string | null;
};

function propertiesText(properties: {
  read: boolean;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
}): string {
  const present = [
    properties.read ? "read" : null,
    properties.write ? "write" : null,
    properties.writeWithoutResponse ? "writeWithoutResponse" : null,
    properties.notify ? "notify" : null,
    properties.indicate ? "indicate" : null,
  ].filter((value): value is string => value !== null);
  return present.length > 0 ? present.join(", ") : "no properties advertised";
}

function bluetoothLine(snapshot: ProbeSnapshot): string {
  switch (snapshot.bluetooth) {
    case "not_initialized":
      return "Bluetooth: not initialised. Nothing has been requested from iOS yet.";
    case "initializing":
      return "Bluetooth: asking iOS for access…";
    case "ready":
      return "Bluetooth: ready.";
    case "unavailable":
      return "Bluetooth: off or unavailable on this iPhone.";
    case "permission_denied":
      return "Bluetooth: permission refused for this app.";
    case "failed":
      return "Bluetooth: initialisation failed.";
  }
}

function connectionLine(snapshot: ProbeSnapshot): string {
  // Status is checked BEFORE the device handle. Teardown holds the handle until the
  // native disconnect has been asked for, so a snapshot taken mid-teardown still
  // carries a device while the probe has already stopped treating the session as
  // observed. Keying off the handle alone would print "Connected to …" at exactly the
  // moment that stopped being true.
  if (snapshot.status === "connected" && snapshot.device !== null) {
    const name = snapshot.device.name ?? "(no name reported)";
    return `Connected to ${name} — connection ${String(snapshot.connectionEpoch)}, peripheral ${snapshot.device.peripheralId}.`;
  }
  switch (snapshot.status) {
    case "selecting":
      return "Selecting a device…";
    case "connecting":
      return "Connecting…";
    case "disconnecting":
      return "Disconnecting…";
    case "disconnected":
      return "Not connected.";
    case "failed":
      return "Not connected. The last attempt failed.";
    default:
      return "Not connected.";
  }
}

function discoveryLabel(state: ProbeSnapshot["services"][number]["discovery"]): string {
  switch (state) {
    case "not_attempted":
      return "not inspected yet";
    case "found":
      return "found on this device";
    case "absent":
      return "not present (the enumeration succeeded and did not list it)";
    case "failed":
      return "unknown — the enumeration failed, which is not evidence either way";
  }
}

export function buildProbeViewModel(snapshot: ProbeSnapshot): ProbeViewModel {
  const supported = snapshot.platform.supported;
  const notices: string[] = [];

  if (!supported) {
    notices.push(
      snapshot.platform.reason === "not_native"
        ? "This build is running in a browser, not as a native iOS app. The probe does not fall back to browser Bluetooth, and it shows no sample data."
        : `This build is running on "${snapshot.platform.platform}". The probe is scoped to native iOS only.`
    );
  }
  notices.push(
    "Raw bytes only. No packet field is decoded: the manufacturer document does not state the byte and nibble ordering, and the encoding is not established."
  );
  notices.push(
    "This probe never writes to the timer. It cannot send a memory request, New Athlete, clear, channel or test command."
  );
  notices.push(
    "Foreground only. Leaving the app ends active observation; nothing is captured in the background."
  );
  notices.push(
    "The log is held in memory. Closing the app loses it — export before you finish."
  );
  notices.push(
    "An exported file contains the iOS-assigned peripheral identifier and the raw bytes the timer sent, which can include real athlete records. Share it only where that is acceptable."
  );
  if (!snapshot.appActive) {
    notices.push("The app is in the background. Nothing is being observed.");
  }

  const actions: ProbeActionView[] = [];

  actions.push({
    id: "initialize",
    label: snapshot.bluetooth === "ready" ? "Bluetooth ready" : "Initialise Bluetooth",
    enabled:
      supported && !snapshot.released && !snapshot.busy && snapshot.bluetooth !== "ready",
    disabledReason: !supported
      ? "Native iOS Bluetooth is not available here."
      : snapshot.released
        ? "This probe session has ended."
        : snapshot.bluetooth === "ready"
          ? "Bluetooth is already initialised."
          : snapshot.busy
            ? "Another operation is still running."
            : null,
    emphasis: "primary",
  });

  // Availability is taken from the controller rather than re-derived here. Two
  // versions of "may this be pressed?" is exactly how a control ends up enabled in the
  // view and refused by the controller, or the reverse.
  actions.push({
    id: "connect-filtered",
    label: "Select timer (timing service filter)",
    enabled: snapshot.controls.connect.available,
    disabledReason: snapshot.controls.connect.unavailableReason,
    emphasis: "primary",
  });
  actions.push({
    id: "connect-all",
    label: "Select from all nearby devices",
    enabled: snapshot.controls.connect.available,
    disabledReason: snapshot.controls.connect.unavailableReason,
    emphasis: "secondary",
  });
  // Disconnect stays usable while an established connection has a read, a discovery or
  // a subscription still in flight. That is the controller's deliberate behaviour —
  // gating this on `busy` would take the operator's way out away at the one moment
  // they are most likely to want it.
  actions.push({
    id: "disconnect",
    label: "Disconnect",
    enabled: snapshot.controls.disconnect.available,
    disabledReason: snapshot.controls.disconnect.unavailableReason,
    emphasis: "secondary",
  });

  for (const readable of snapshot.readableCharacteristics) {
    actions.push({
      id: `read:${readable.uuid}`,
      label: `Read ${readable.label}`,
      enabled: readable.available && !snapshot.busy,
      disabledReason: readable.available
        ? snapshot.busy
          ? "Another operation is still running."
          : null
        : readable.unavailableReason,
      emphasis: "secondary",
    });
  }

  actions.push({
    id: "start-listening",
    label: "Start listening",
    enabled: snapshot.controls.startListening.available,
    disabledReason: snapshot.controls.startListening.unavailableReason,
    emphasis: "primary",
  });
  actions.push({
    id: "stop-listening",
    label: "Stop listening",
    enabled: snapshot.controls.stopListening.available,
    disabledReason: snapshot.controls.stopListening.unavailableReason,
    emphasis: "secondary",
  });

  actions.push({
    id: "export-log",
    label: "Export log",
    enabled: snapshot.log.entries.length > 0 && !snapshot.busy,
    disabledReason:
      snapshot.log.entries.length === 0 ? "There is nothing to export yet." : null,
    emphasis: "primary",
  });
  actions.push({
    id: "clear-log",
    label: "Clear log",
    enabled: snapshot.log.entries.length > 0,
    disabledReason:
      snapshot.log.entries.length === 0 ? "There is nothing to clear." : null,
    emphasis: "destructive",
  });

  const services: ProbeServiceView[] = snapshot.services.map((service) => ({
    uuid: service.uuid,
    title: `${service.label ?? "Undocumented service"}${service.required ? "" : " (optional)"}`,
    discoveryLabel: discoveryLabel(service.discovery),
    documented: service.documented,
    characteristics: service.characteristics.map((characteristic) => ({
      uuid: characteristic.uuid,
      title: characteristic.label ?? "Not named in the manufacturer document",
      properties: propertiesText(characteristic.properties),
    })),
  }));

  const droppedNote =
    snapshot.log.droppedEntryCount > 0
      ? ` ${String(snapshot.log.droppedEntryCount)} older entries were dropped to stay within the retention limit.`
      : "";
  const truncatedNote =
    snapshot.log.truncatedPayloadCount > 0
      ? ` ${String(snapshot.log.truncatedPayloadCount)} payloads were truncated.`
      : "";

  const capabilityNotice =
    snapshot.athleteDataNotifyCapability === "unsupported"
      ? "Observed: the Athlete Data characteristic advertises neither notify nor indicate on this device, so it cannot push values to the probe."
      : null;

  return {
    title: "Brower TCi — native iOS BLE probe",
    identity:
      "Development instrument. Raw BLE data only — no training, assessment or exercise record is created, read or changed.",
    platformLine: supported
      ? "Platform: native iOS."
      : `Platform: ${snapshot.platform.platform} — unsupported.`,
    bluetoothLine: bluetoothLine(snapshot),
    connectionLine: connectionLine(snapshot),
    failure: snapshot.failure?.message ?? null,
    notices,
    actions,
    services,
    discoveryNotice: snapshot.discoveryIncomplete
      ? "Discovery did not complete. What is listed below is a partial picture of this device, not a complete inspection of it."
      : capabilityNotice,
    reads: snapshot.reads.map((read) => ({
      id: read.id,
      title: read.label ?? read.uuid,
      hex: read.hex,
      meta: `${String(read.byteLength)} bytes · entry ${String(read.sequence)} · connection ${String(read.connectionEpoch)} · ${read.at}`,
    })),
    notifications: snapshot.notifications.map((notification) => ({
      id: notification.id,
      title: notification.label ?? notification.uuid,
      hex: notification.hex,
      meta: `${String(notification.byteLength)} bytes · entry ${String(notification.sequence)} · connection ${String(notification.connectionEpoch)} · ${notification.at}`,
    })),
    notificationSummary: snapshot.notificationsActive
      ? `Listening. ${String(snapshot.notificationCount)} notifications received on this connection.`
      : `Not listening. ${String(snapshot.notificationCount)} notifications received on this connection.`,
    // Stated as an observation about native resources, and deliberately NOT as a claim
    // that anything definitely leaked. When a stop fails, the probe cannot tell
    // whether the plugin removed its callback before the failure, so "could not be
    // confirmed" is the strongest honest wording.
    listenerNotice:
      snapshot.ownedNativeListenerCount > 0 && !snapshot.notificationsActive
        ? `${String(snapshot.ownedNativeListenerCount)} notification subscription(s) could not be confirmed as stopped.`
        : null,
    logSummary: `${String(snapshot.log.entries.length)} log entries.${droppedNote}${truncatedNote}${
      snapshot.hasUnexportedObservations ? " Not yet exported." : " All entries exported."
    }`,
    exportLine:
      snapshot.lastExport === null
        ? null
        : snapshot.lastExport.outcome === "shared"
          ? `Last export: shared as ${snapshot.lastExport.fileName ?? "the exported file"}.`
          : snapshot.lastExport.outcome === "cancelled"
            ? "Last export: cancelled. Nothing was saved."
            : `Last export: failed. ${snapshot.lastExport.reason ?? ""}`.trim(),
  };
}
