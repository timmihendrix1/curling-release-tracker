"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  BROWER_MAX_DISPLAYED_NOTIFICATIONS,
  BROWER_OBSERVATION_WINDOW_MS,
  createBrowerBleDiagnosticController,
  isBrowerDiagnosticEnvironment,
  type BrowerBleDiagnosticController,
  type BrowerControllerOptions,
  type BrowerDiagnosticSnapshot,
  type BrowerObservedCharacteristic,
  type BrowerObservedService,
  type BrowerRawObservation,
} from "../lib/brower/browerBleDiagnosticController";
import {
  downloadDiagnosticLog,
  serializeDiagnosticLog,
} from "../lib/brower/diagnosticLog";
import {
  BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
  BROWER_BYTE_ORDER_HYPOTHESES,
  BROWER_DIAGNOSTIC_MAX_ADDRESS_SPAN,
  BROWER_MAX_MEMORY_ADDRESS,
  BROWER_MIN_MEMORY_ADDRESS,
  BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID,
  BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
  BROWER_TIME_BASE_CHARACTERISTIC_UUID,
  browerByteOrderLabel,
  buildAthleteDataRequestCommand,
  formatHexBytes,
  parseAthleteDataRequestRange,
  parseMemoryAddressInput,
  type BrowerMultiByteOrderHypothesis,
} from "../lib/brower/protocol";
import { surfaceClass } from "./Surface";

type BrowerBleDiagnosticScreenProps = {
  onClose: () => void;
  /** Test-only injection point. Production usage passes nothing. */
  controllerOptions?: BrowerControllerOptions;
};

const PROPERTY_LABELS: { key: keyof BrowerObservedCharacteristic["properties"]; label: string }[] = [
  { key: "read", label: "read" },
  { key: "write", label: "write" },
  { key: "writeWithoutResponse", label: "writeWithoutResponse" },
  { key: "notify", label: "notify" },
  { key: "indicate", label: "indicate" },
];

/**
 * "not found" is reserved for a confirmed absence. A query that failed is reported as
 * unknown, so a failed enumeration is never read as evidence about the device.
 */
function serviceDiscoveryLabel(service: BrowerObservedService): string {
  if (service.discovery === "found") return "found";
  if (service.discovery === "absent") return "not found";
  if (service.discovery === "failed") return "lookup failed — unknown";
  return "not inspected";
}

function propertySummary(characteristic: BrowerObservedCharacteristic): string {
  const active = PROPERTY_LABELS.filter(({ key }) => characteristic.properties[key]).map(
    ({ label }) => label
  );
  return active.length === 0 ? "no properties advertised" : active.join(", ");
}

function ObservationList({
  observations,
  emptyMessage,
}: {
  observations: BrowerRawObservation[];
  emptyMessage: string;
}) {
  if (observations.length === 0) {
    return <p className="mt-2 text-sm text-slate-500">{emptyMessage}</p>;
  }
  return (
    <ul className="mt-2 space-y-2">
      {observations.map((observation) => (
        <li key={observation.id} className={surfaceClass("inset")}>
          <p className="text-xs font-medium text-slate-600">
            {observation.label ?? "Undocumented characteristic"} · {observation.byteLength} byte
            {observation.byteLength === 1 ? "" : "s"} · {observation.at}
          </p>
          <p className="mt-1 font-mono text-xs break-all text-slate-900">{observation.hex}</p>
          <p className="mt-1 font-mono text-[10px] break-all text-slate-400">{observation.uuid}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Development-only Brower TCi BLE diagnostic.
 *
 * Its purpose is evidence, not capture: connect to one real timer, see which documented
 * services and characteristics actually exist, record raw bytes, and export them. It
 * produces no `TimingResult`, saves no Shot, Session, Assessment or Exercise result, and
 * persists nothing — see `src/lib/brower/browerBleDiagnosticController.ts` and
 * `docs/BROWER_INTEGRATION_STATUS.md`.
 *
 * Every value it shows is raw. Nothing here decodes a packet field, because the
 * manufacturer document does not state the byte or nibble ordering those fields use —
 * an unverified interpretation displayed as a session number or an elapsed time would be
 * exactly the "looks real but isn't" value this project's principles forbid.
 */
export default function BrowerBleDiagnosticScreen({
  onClose,
  controllerOptions,
}: BrowerBleDiagnosticScreenProps) {
  // Runtime production exclusion, evaluated before any controller or Bluetooth access.
  // `process.env.NODE_ENV` is inlined at build time, so a production bundle takes the
  // branch below and never reaches `createBrowerBleDiagnosticController`.
  const available = isBrowerDiagnosticEnvironment(controllerOptions?.nodeEnv);

  const [controller] = useState<BrowerBleDiagnosticController | null>(() =>
    available ? createBrowerBleDiagnosticController(controllerOptions) : null
  );
  const [snapshot, setSnapshot] = useState<BrowerDiagnosticSnapshot | null>(() =>
    controller === null ? null : controller.getSnapshot()
  );

  const [startAddressInput, setStartAddressInput] = useState("1");
  const [stopAddressInput, setStopAddressInput] = useState("3");
  const [byteOrder, setByteOrder] = useState<BrowerMultiByteOrderHypothesis | null>(null);
  const [requestRejection, setRequestRejection] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  // The modal effect must not re-run (and so must not re-take focus) merely because the
  // parent re-created its onClose callback. Synced through a ref instead — this project
  // syncs refs in an effect, never by mutating `.current` during render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (controller === null) return;
    // Subscribed inside the effect, with setState called only from the subscription's
    // callback — never synchronously in the effect body (the sanctioned pattern in this
    // codebase, see CLAUDE.md's Working rules).
    const unsubscribe = controller.subscribe((next) => setSnapshot(next));
    return () => {
      // Order matters: stop observing first, so a teardown-triggered update can never
      // reach an unmounting component, then release the connection itself. `release` is
      // idempotent and leaves the controller usable, so React Strict Mode's
      // mount → cleanup → mount double-invoke reconnects cleanly instead of leaving a
      // dead controller behind.
      unsubscribe();
      controller.release();
    };
  }, [controller]);

  // --- Modal behaviour -------------------------------------------------------------
  // Deliberately local to this overlay. The application has no shared modal primitive
  // yet, and introducing one would mean rewriting every existing overlay — out of scope
  // for a hardware-discovery correction. What is NOT optional is that a full-screen
  // overlay must not leave the screen behind it keyboard-operable: without containment,
  // Shift+Tab reaches the primary navigation and the athlete can change page while a
  // live GATT connection is still owned by a now-invisible view.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    // Remembered so focus can go back where it came from on close. Captured in the
    // effect rather than during render, since the trigger is only the active element
    // until this dialog takes focus.
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Everything focusable inside this dialog is unconditionally rendered — React
    // removes controls from the DOM rather than hiding them with CSS — so the selector
    // plus the explicit hidden/aria-hidden exclusions below are sufficient. Deliberately
    // NOT filtered on `offsetParent`, which is always null under jsdom and would make
    // the containment untestable as well as needlessly fragile.
    function focusableElements(): HTMLElement[] {
      if (dialog === null) return [];
      return Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(
        (element) => !element.hasAttribute("hidden") && element.closest('[aria-hidden="true"]') === null
      );
    }

    // Initial focus goes to the dialog container, not the first control, so a screen
    // reader announces what this is before the first action is offered.
    dialog.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (dialog === null) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements();
      if (focusable.length === 0) {
        // Nothing to move to — keep focus inside rather than letting it escape to the
        // background document.
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // `active === dialog` must be treated exactly like "focus is outside", NOT as
      // "focus is inside". `Node.contains` reports a node as containing itself, so the
      // container — which holds focus from the moment the dialog opens, and again
      // whenever a focused control is removed or disabled — matched neither the
      // outside branch nor the first/last branches below, and Shift+Tab fell through to
      // the browser default straight out to the page behind.
      const isOnInnerControl =
        active instanceof HTMLElement && active !== dialog && dialog.contains(active);

      if (!isOnInnerControl) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    // Capture phase, so containment applies before any background handler can react.
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Only restore focus if the trigger still exists. When this overlay unmounts
      // because the athlete navigated away, the Settings button is gone and forcing
      // focus onto a detached node would strand it.
      if (previouslyFocused !== null && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  // ONE parse of the raw input, shared by the validation message, the preview and the
  // bytes actually written. Deliberately not `Number.parseInt`, which accepts a numeric
  // prefix and would silently turn "1.9" or "1e2" into address 1 — see
  // `parseMemoryAddressInput` in protocol.ts.
  const requestedRange = parseAthleteDataRequestRange(startAddressInput, stopAddressInput);
  // Per-field, so `aria-invalid` marks only the field that is actually malformed. A
  // range-level problem (reversed, too wide) is not a fault of either field on its own.
  const startFieldValid = parseMemoryAddressInput(startAddressInput).ok;
  const stopFieldValid = parseMemoryAddressInput(stopAddressInput).ok;

  const previewBytes = useMemo(() => {
    if (!requestedRange.valid || byteOrder === null) return null;
    try {
      return buildAthleteDataRequestCommand({
        startAddress: requestedRange.startAddress,
        stopAddress: requestedRange.stopAddress,
        byteOrder,
      });
    } catch {
      return null;
    }
  }, [requestedRange, byteOrder]);

  if (!available || controller === null || snapshot === null) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 px-4 py-6">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl focus:outline-none"
        >
          <h2 id={titleId} className="text-xl font-semibold text-slate-900">
            BLE Diagnostic
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            This diagnostic is a development tool and is not available in this build.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const connected = snapshot.status === "connected";
  const canSelect =
    snapshot.support.supported &&
    !snapshot.busy &&
    (snapshot.status === "idle" ||
      snapshot.status === "disconnected" ||
      snapshot.status === "failed");

  // Taken from the controller's explicit discovery state, NOT inferred from the absence
  // of an entry in the services list: after a failed enumeration that list is empty
  // because the question could not be answered, not because the characteristic is
  // missing. Only "found" may offer a subscription.
  const athleteDataDiscovery = snapshot.athleteDataDiscovery;
  const athleteDataCharacteristic = snapshot.services
    .flatMap((service) => service.characteristics)
    .find((characteristic) => characteristic.uuid === BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID);
  const notificationsSupported =
    athleteDataDiscovery === "found" &&
    athleteDataCharacteristic !== undefined &&
    (athleteDataCharacteristic.properties.notify ||
      athleteDataCharacteristic.properties.indicate);

  const sendEnabled =
    connected &&
    !snapshot.busy &&
    snapshot.notificationsActive &&
    !snapshot.observationWindowActive &&
    byteOrder !== null &&
    requestedRange.valid;

  // Declared as consts (not hoisted function declarations) so TypeScript keeps the
  // narrowing established by the unavailable-build guard above.
  const readableCharacteristic = (uuid: string): BrowerObservedCharacteristic | undefined => {
    return snapshot.services
      .flatMap((service) => service.characteristics)
      .find((characteristic) => characteristic.uuid === uuid);
  };

  const handleSend = async () => {
    // Re-checked here rather than trusting the disabled state alone: the exact values
    // sent must be the ones that were parsed and previewed, never a re-derivation.
    if (byteOrder === null || !requestedRange.valid) return;
    setRequestRejection(null);
    const outcome = await controller.sendAthleteDataRequest({
      startAddress: requestedRange.startAddress,
      stopAddress: requestedRange.stopAddress,
      byteOrder,
    });
    if (!outcome.accepted) setRequestRejection(outcome.reason);
  };

  const handleExportLog = () => {
    const exportedAt = new Date().toISOString();
    downloadDiagnosticLog(
      serializeDiagnosticLog(snapshot.log, exportedAt),
      "brower_tci_ble_diagnostic_log.json"
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 px-4 py-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="mx-auto w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-xl font-semibold text-slate-900">
            Brower TCi BLE Diagnostic
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close BLE Diagnostic"
            className="rounded-lg px-2 py-1 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            Close
          </button>
        </div>

        <p className="text-sm text-slate-600">
          A development tool for inspecting a real Brower TCi Timer over Bluetooth. It reads
          and records raw bytes so the protocol can be established from evidence.
        </p>
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          Nothing here records training. No shot, session, assessment or exercise result is
          created or changed, and nothing is saved to this device or your cloud account.
        </p>

        {/* Browser capability */}
        {!snapshot.support.supported && (
          <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
            {snapshot.support.reason === "insecure-context"
              ? "Web Bluetooth needs a secure context. Open the app over the localhost development URL or HTTPS."
              : "This browser does not support Web Bluetooth. Use Chrome on macOS for this diagnostic."}
          </p>
        )}

        {/* Connection */}
        <section className={surfaceClass("primary")}>
          <h3 className="text-sm font-semibold text-slate-700">Connection</h3>
          <p className="mt-1 text-sm text-slate-900" data-testid="brower-status">
            Status: {snapshot.status}
            {snapshot.statusMessage === null ? "" : ` — ${snapshot.statusMessage}`}
          </p>

          {snapshot.failure !== null && (
            <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {snapshot.failure}
            </p>
          )}

          {snapshot.device !== null && (
            <div className="mt-3 text-sm text-slate-700">
              <p>Selected device: {snapshot.device.name ?? "(no name reported)"}</p>
              <p className="mt-1 font-mono text-xs break-all text-slate-500">
                Browser device identifier: {snapshot.device.browserDeviceId}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                This identifier is generated by the browser for this site. It is not the
                manufacturer serial number, and a plausible-looking device name does not
                confirm the unit is a TCi Timer.
              </p>
            </div>
          )}

          <div className="mt-4 space-y-2">
            <button
              type="button"
              onClick={() => void controller.connect("timing-service-filter")}
              disabled={!canSelect}
              className="w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Select Device (timing service filter)
            </button>
            <button
              type="button"
              onClick={() => void controller.connect("all-devices")}
              disabled={!canSelect}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Select Device (show all nearby devices)
            </button>
            <p className="text-xs text-slate-500">
              The manufacturer document&apos;s advertising example carries a different service
              identifier from the timing service it declares, so the filtered chooser may show
              nothing even when the timer is on. Use the second chooser in that case.
            </p>
            <button
              type="button"
              onClick={() => void controller.disconnect()}
              disabled={!connected && snapshot.status !== "connecting"}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Disconnect
            </button>
          </div>
        </section>

        {/* Services and characteristics */}
        <section className={surfaceClass("primary")}>
          <h3 className="text-sm font-semibold text-slate-700">Services and characteristics</h3>
          <p className="mt-1 text-xs text-slate-500">
            Properties shown are the ones the device actually advertises, not the ones the
            document predicts.
          </p>
          {snapshot.discoveryIncomplete && (
            <p
              role="status"
              data-testid="brower-discovery-incomplete"
              className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
            >
              Discovery is incomplete. At least one query failed, so the list below is a
              partial picture of this device — not evidence that anything is missing from it.
            </p>
          )}
          <ul className="mt-3 space-y-3">
            {snapshot.services.map((service) => (
              <li key={service.uuid}>
                <p className="text-sm font-medium text-slate-900">
                  {service.label} — {serviceDiscoveryLabel(service)}
                  {service.required ? "" : " (optional)"}
                </p>
                <p className="font-mono text-[10px] break-all text-slate-400">{service.uuid}</p>
                {service.discovery === "failed" && (
                  <p className="mt-1 text-sm text-amber-800">
                    The lookup failed, so whether this device exposes this service is unknown.
                  </p>
                )}
                {service.discovery === "found" && !service.characteristicsEnumerated && (
                  <p className="mt-1 text-sm text-amber-800">
                    The service was found, but listing its characteristics failed. Which
                    characteristics it exposes is unknown, not empty.
                  </p>
                )}
                {service.discovery === "found" &&
                  service.characteristicsEnumerated &&
                  service.characteristics.length === 0 && (
                    <p className="mt-1 text-sm text-slate-500">
                      This service exposes no characteristics.
                    </p>
                  )}
                <ul className="mt-1 space-y-1">
                  {service.characteristics.map((characteristic) => (
                    <li key={characteristic.uuid} className="text-sm text-slate-700">
                      <span className="font-medium">
                        {characteristic.label ?? "Undocumented characteristic"}
                      </span>{" "}
                      — {propertySummary(characteristic)}
                      <span className="block font-mono text-[10px] break-all text-slate-400">
                        {characteristic.uuid}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            The document also lists a &ldquo;Current Memory Location&rdquo; characteristic but
            never states its identifier, so any characteristic above shown as undocumented is
            left unnamed rather than guessed at.
          </p>
        </section>

        {/* Reads */}
        <section className={surfaceClass("primary")}>
          <h3 className="text-sm font-semibold text-slate-700">Characteristic reads</h3>
          <p className="mt-1 text-xs text-slate-500">
            Raw bytes only. The byte order of these values is not documented, so no number is
            derived from them here.
          </p>
          <div className="mt-3 space-y-2">
            {[
              { uuid: BROWER_TIME_BASE_CHARACTERISTIC_UUID, label: "Read Time Base" },
              { uuid: BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID, label: "Read Power On Counter" },
              { uuid: BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID, label: "Read Serial Number" },
            ].map((entry) => {
              const characteristic = readableCharacteristic(entry.uuid);
              const readable = characteristic?.properties.read === true;
              return (
                <div key={entry.uuid}>
                  <button
                    type="button"
                    onClick={() => void controller.readCharacteristic(entry.uuid)}
                    disabled={!connected || snapshot.busy || !readable}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    {entry.label}
                  </button>
                  {connected && characteristic === undefined && (
                    <p className="mt-1 text-xs text-slate-500">
                      Not exposed by this device. The rest of the diagnostic still works.
                    </p>
                  )}
                  {connected && characteristic !== undefined && !readable && (
                    <p className="mt-1 text-xs text-slate-500">
                      This device does not advertise the read property for this characteristic.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <ObservationList
            observations={snapshot.reads}
            emptyMessage="No characteristic has been read yet."
          />
        </section>

        {/* Notifications */}
        <section className={surfaceClass("primary")}>
          <h3 className="text-sm font-semibold text-slate-700">Athlete Data notifications</h3>
          <p className="mt-1 text-xs text-slate-500">
            Each notification is kept as its own byte sequence. Whether a packet is a complete
            record, and whether the timer sends anything at all without being asked, are both
            open questions this diagnostic exists to answer.
          </p>
          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={() => void controller.startNotifications()}
              disabled={
                !connected ||
                snapshot.busy ||
                snapshot.notificationsActive ||
                !notificationsSupported
              }
              className="w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Start Listening
            </button>
            <button
              type="button"
              onClick={() => void controller.stopNotifications()}
              disabled={!connected || snapshot.busy || !snapshot.notificationsActive}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Stop Listening
            </button>
          </div>
          {connected && athleteDataDiscovery === "failed" && (
            <p className="mt-2 text-sm text-amber-800" data-testid="brower-athlete-data-unknown">
              Whether this device exposes the Athlete Data characteristic is unknown — the
              lookup failed. Subscribing is unavailable until discovery succeeds. Reconnect
              to try again.
            </p>
          )}
          {connected && athleteDataDiscovery === "absent" && (
            <p className="mt-2 text-sm text-slate-600">
              The Athlete Data characteristic was not found on this device, so no
              subscription is possible. The reads above are unaffected.
            </p>
          )}
          {connected && athleteDataDiscovery === "found" && !notificationsSupported && (
            <p className="mt-2 text-sm text-slate-600">
              This device does not advertise notify or indicate for Athlete Data, so no
              subscription was attempted.
            </p>
          )}
          <p className="mt-2 text-sm text-slate-700" data-testid="brower-notification-count">
            {snapshot.notificationCount} notification
            {snapshot.notificationCount === 1 ? "" : "s"} received
            {snapshot.notificationCount > BROWER_MAX_DISPLAYED_NOTIFICATIONS
              ? ` · showing the most recent ${BROWER_MAX_DISPLAYED_NOTIFICATIONS}`
              : ""}
          </p>
          <ObservationList
            observations={snapshot.notifications}
            emptyMessage="No notification received yet. Silence does not by itself mean the connection failed."
          />
        </section>

        {/* Memory read experiment */}
        <section className={surfaceClass("primary")}>
          <h3 className="text-sm font-semibold text-slate-700">Memory read experiment</h3>
          <p className="mt-1 text-sm text-slate-600">
            Sends one documented athlete-data request (command type 0x01) for a small memory
            range. No other command is available here — in particular, this diagnostic never
            sends New Athlete, and never clears or resets the timer.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-sm text-slate-700">
              Start address
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={startAddressInput}
                onChange={(event) => setStartAddressInput(event.target.value)}
                aria-invalid={!startFieldValid}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm text-slate-700">
              Stop address
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={stopAddressInput}
                onChange={(event) => setStopAddressInput(event.target.value)}
                aria-invalid={!stopFieldValid}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </label>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Addresses {BROWER_MIN_MEMORY_ADDRESS}–{BROWER_MAX_MEMORY_ADDRESS}, at most{" "}
            {BROWER_DIAGNOSTIC_MAX_ADDRESS_SPAN} at a time.
          </p>
          {!requestedRange.valid && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {requestedRange.reason}
            </p>
          )}

          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-slate-700">
              Byte-order hypothesis
            </legend>
            <p className="mt-1 text-xs text-slate-500">
              The document does not state how the two-byte addresses are ordered on the wire.
              Both options below are experimental hypotheses; neither is a confirmed default.
              If the hypothesis is wrong, the timer may return a different range than the one
              you asked for.
            </p>
            <div className="mt-2 space-y-2">
              {BROWER_BYTE_ORDER_HYPOTHESES.map((hypothesis) => (
                <label key={hypothesis} className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="brower-byte-order"
                    value={hypothesis}
                    checked={byteOrder === hypothesis}
                    onChange={() => setByteOrder(hypothesis)}
                    className="mt-1"
                  />
                  <span>{browerByteOrderLabel(hypothesis)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-3">
            <p className="text-sm font-medium text-slate-700">Command to be sent</p>
            <p className="mt-1 font-mono text-sm text-slate-900" data-testid="brower-command-preview">
              {previewBytes === null
                ? "Select a byte-order hypothesis and a valid range."
                : formatHexBytes(previewBytes)}
            </p>
          </div>

          {connected && !snapshot.notificationsActive && (
            <p className="mt-3 text-sm text-slate-600">
              Start listening for Athlete Data notifications first — replies arrive only
              through that subscription.
            </p>
          )}
          {snapshot.observationWindowActive && (
            <p className="mt-3 text-sm text-slate-600" data-testid="brower-observation-window">
              Observation window open for {BROWER_OBSERVATION_WINDOW_MS / 1000} seconds. This is
              a fixed timeout, not proof that every reply has arrived — later notifications are
              still recorded as uncorrelated observations.
            </p>
          )}
          {requestRejection !== null && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {requestRejection}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!sendEnabled}
            className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Send Request
          </button>
        </section>

        {/* Log */}
        <section className={surfaceClass("primary")}>
          <h3 className="text-sm font-semibold text-slate-700">Diagnostic log</h3>
          <p className="mt-1 text-sm text-slate-700" data-testid="brower-log-summary">
            {snapshot.log.entries.length} entr
            {snapshot.log.entries.length === 1 ? "y" : "ies"}
            {snapshot.log.droppedEntryCount > 0
              ? ` · ${snapshot.log.droppedEntryCount} older entr${
                  snapshot.log.droppedEntryCount === 1 ? "y" : "ies"
                } dropped`
              : ""}
            {snapshot.log.truncatedPayloadCount > 0
              ? ` · ${snapshot.log.truncatedPayloadCount} payload${
                  snapshot.log.truncatedPayloadCount === 1 ? "" : "s"
                } truncated`
              : ""}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Held in memory for as long as this view is open. An exported file can contain the
            browser&apos;s device identifier and raw athlete records read from the timer, so
            treat it accordingly. Clearing the log here does not clear the timer&apos;s memory.
          </p>

          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={handleExportLog}
              disabled={snapshot.log.entries.length === 0}
              className="w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Export Log
            </button>
            <button
              type="button"
              onClick={() => controller.clearLog()}
              disabled={snapshot.log.entries.length === 0}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Clear Log
            </button>
          </div>

          <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
            {snapshot.log.entries
              .slice()
              .reverse()
              .map((entry) => (
                <li key={entry.sequence} className={surfaceClass("inset")}>
                  <p className="text-xs font-medium text-slate-600">
                    #{entry.sequence} · {entry.direction.toUpperCase()} · {entry.kind} ·{" "}
                    {entry.at}
                  </p>
                  <p className="mt-1 text-sm text-slate-800">{entry.message}</p>
                  {entry.payload !== undefined && (
                    <p className="mt-1 font-mono text-xs break-all text-slate-900">
                      {entry.payload.hex}
                      {entry.payload.truncatedByteCount === undefined
                        ? ""
                        : ` … (+${entry.payload.truncatedByteCount} bytes not retained)`}
                    </p>
                  )}
                </li>
              ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
