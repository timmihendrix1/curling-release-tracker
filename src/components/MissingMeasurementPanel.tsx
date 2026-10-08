"use client";

import { useRef, useState } from "react";
import type { Handle, MeasuredQuantity, Shot } from "../types";
import {
  SPEED_INPUT_PATTERN,
  parseSpeedInput,
} from "../lib/measurement/speedInput";
import { parseReleaseTime } from "../lib/timeInput";
import { quantityLabel, quantityUnitLabel } from "../lib/measurement/tolerance";
import { formatMeasuredValue } from "../lib/measurement/format";
import { shotMeasuredValue } from "../lib/measurement/quantities";
import { surfaceClass } from "./Surface";

/** One stone that is still missing at least one of its block's measurements. */
export type IncompleteShotEntry = {
  shot: Shot;
  missing: MeasuredQuantity[];
  /** The block the stone belongs to — not necessarily the active one. */
  blockId: string;
  blockName: string;
  /**
   * Its 1-based place in this training.
   *
   * Block names default and repeat, so name, stone number, handle and the recorded
   * value together still do not guarantee two rows differ. The sequence does, without
   * requiring the athlete to have named anything or showing them an identifier that
   * means nothing at the rink.
   */
  blockPosition: number;
};

/**
 * The FULL identity a completion is addressed to.
 *
 * Every part is captured from what the athlete actually selected and is carried
 * through to execution unchanged. Nothing is re-derived from "whichever block happens
 * to be active" when the write finally runs, because by then it may be a different
 * block entirely.
 */
export type CompletionRequest = {
  sessionId: string;
  blockId: string;
  shotId: string;
  quantity: MeasuredQuantity;
  value: number;
};

export type CompletionOutcome =
  | { status: "persisted" }
  | { status: "failed"; message: string }
  | { status: "superseded"; message: string }
  | { status: "rejected"; message: string };

/**
 * A completion that has been accepted into the session but whose write has not (yet)
 * succeeded. It keeps the stone visible and retryable even though the domain no
 * longer reports it as incomplete.
 */
export type PendingCompletion = {
  key: string;
  sessionId: string;
  blockId: string;
  blockName: string;
  blockPosition: number;
  shotId: string;
  shotNumber: number;
  handle: Handle;
  quantity: MeasuredQuantity;
  value: number;
  status: "pending" | "failed";
  message?: string;
};

/** Which stone's editor is open, addressed by full identity. */
export type CompletionSelection = {
  sessionId: string;
  blockId: string;
  shotId: string;
  quantity: MeasuredQuantity;
};

/**
 * The one validation rule for a completion value, used by BOTH the live hint and the
 * submit path. They disagreed before: the hint only checked for an unparseable value,
 * so a typed `0` looked valid right up until submission silently refused it.
 *
 * Positive and finite is the same invariant the domain enforces
 * (`isValidQuantityValue`) — there is no sport-specific range here.
 */
function parseCompletionValue(
  raw: string,
  quantity: MeasuredQuantity
): number | null {
  const parsed =
    quantity === "speed" ? parseSpeedInput(raw) : parseReleaseTime(raw);
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function completionKey(selection: CompletionSelection): string {
  return `${selection.sessionId}:${selection.blockId}:${selection.shotId}:${selection.quantity}`;
}

type MissingMeasurementPanelProps = {
  /** Every stone of the CURRENT training still missing a measurement, any block. */
  entries: IncompleteShotEntry[];
  /** Accepted-but-not-yet-durable completions, kept visible and retryable. */
  pending?: PendingCompletion[];
  /**
   * Typed-but-unsaved values, keyed by `completionKey`. Owned by the parent so a
   * draft survives navigation, and so one stone's acknowledgement can never clear
   * another stone's typing.
   */
  drafts: Record<string, string>;
  onChangeDraft: (key: string, value: string) => void;
  selection: CompletionSelection | null;
  onChangeSelection: (selection: CompletionSelection | null) => void;
  onComplete: (request: CompletionRequest) => Promise<CompletionOutcome>;
  onRetry?: (key: string) => void;
  /**
   * The most recent completion whose write storage actually acknowledged. Keeps the
   * panel mounted long enough to say so: completing the LAST outstanding measurement
   * empties the list, and a control that vanishes the instant it succeeds gives no
   * confirmation that anything was written.
   */
  confirmation?: {
    blockName: string;
    blockPosition: number;
    shotNumber: number;
    quantity: MeasuredQuantity;
    value: number;
  } | null;
  disabled?: boolean;
};

/**
 * Adds a measurement that is still missing on ONE explicitly identified stone,
 * anywhere in the CURRENT training.
 *
 * Every property of this control exists to stop a value landing on the wrong stone.
 * The athlete selects the stone by its own identity — block, number, handle and the
 * measurement it already carries — and the request carries that full identity through
 * to execution. A device time arriving meanwhile appends a new stone and changes this
 * list, but it never moves, clears or re-points an open editor.
 *
 * Drafts are keyed per stone and held by the parent, so switching between stones
 * keeps each one's typed value, and an acknowledgement for one stone cannot clear
 * another's.
 *
 * This is deliberately not general editing of history. Only a genuinely missing
 * measurement can be added, only within the current training; archived sessions and
 * already-recorded quantities are out of scope.
 */
export default function MissingMeasurementPanel({
  entries,
  pending = [],
  drafts,
  onChangeDraft,
  selection,
  onChangeSelection,
  onComplete,
  onRetry,
  confirmation = null,
  disabled = false,
}: MissingMeasurementPanelProps) {
  // A single in-flight submission per key. The REF is the gate, not state: two taps
  // dispatched before React re-renders would both pass a state-only check.
  const submittingRef = useRef<Set<string>>(new Set());
  // A refusal that produced no operation: invalid input, or an execution-time
  // rejection. Shown beside the field, never as a pending write.
  const [localError, setLocalError] = useState<string | null>(null);

  const failed = pending.filter((entry) => entry.status === "failed");
  const inFlight = pending.filter((entry) => entry.status === "pending");

  if (entries.length === 0 && pending.length === 0 && !confirmation) return null;

  const selectedKey = selection ? completionKey(selection) : null;
  const selectedEntry = selection
    ? (entries.find(
        (entry) =>
          entry.shot.id === selection.shotId &&
          entry.blockId === selection.blockId &&
          entry.missing.includes(selection.quantity)
      ) ?? null)
    : null;

  function describe(entry: IncompleteShotEntry, quantity: MeasuredQuantity): string {
    const recordedQuantity: MeasuredQuantity =
      quantity === "time" ? "speed" : "time";
    const recorded = shotMeasuredValue(entry.shot, recordedQuantity);
    const handleLabel = entry.shot.handle === "in" ? "In" : "Out";
    const have =
      recorded !== null
        ? `${quantityLabel(recordedQuantity)} ${formatMeasuredValue(recorded, recordedQuantity)}`
        : "no measurement yet";

    // The exercise's POSITION leads, because the name alone does not distinguish two
    // default-named blocks; stone numbers also restart in every exercise, so "Stone 1"
    // on its own is ambiguous the moment a training has more than one.
    return `Exercise ${entry.blockPosition} · ${entry.blockName} · Stone ${entry.shot.shotNumber} · ${handleLabel} Handle · ${have}`;
  }

  async function handleSubmit() {
    if (disabled || !selection || !selectedEntry || !selectedKey) return;
    if (submittingRef.current.has(selectedKey)) return;

    const { quantity } = selection;
    const raw = drafts[selectedKey] ?? "";
    const parsed = parseCompletionValue(raw, quantity);

    if (parsed === null) {
      // Nothing was accepted, so this is not a pending/failed OPERATION — it is a
      // validation message beside the field, and the draft stays exactly as typed.
      setLocalError(
        `Enter a ${quantityLabel(quantity).toLowerCase()} greater than zero.`
      );
      return;
    }

    setLocalError(null);

    // Captured BEFORE awaiting, in full. The request must carry the stone the athlete
    // chose even if the selection, the list or the active block changes meanwhile.
    const request: CompletionRequest = {
      sessionId: selection.sessionId,
      blockId: selection.blockId,
      shotId: selection.shotId,
      quantity,
      value: parsed,
    };

    submittingRef.current.add(selectedKey);
    try {
      const outcome = await onComplete(request);
      // A REJECTION never becomes a pending operation, so the parent has nowhere to
      // show it — ignoring the outcome made execution-time refusals (a stone that
      // moved, a quantity already recorded, a training mid-transition) disappear
      // silently while the athlete waited for something to happen.
      if (outcome.status === "rejected") {
        setLocalError(outcome.message);
      }
    } finally {
      submittingRef.current.delete(selectedKey);
    }
  }

  const draftValue = selectedKey ? (drafts[selectedKey] ?? "") : "";
  const draftIsInvalid =
    selection !== null &&
    draftValue.trim() !== "" &&
    parseCompletionValue(draftValue, selection.quantity) === null;
  const selectedInFlight = selectedKey
    ? inFlight.some((entry) => entry.key === selectedKey)
    : false;

  return (
    <section className={surfaceClass("inset", "mt-4")}>
      <h3 className="text-sm font-semibold text-slate-900">
        Missing measurements
      </h3>

      {entries.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          {entries.length} stone{entries.length === 1 ? "" : "s"} in this training{" "}
          {entries.length === 1 ? "is" : "are"} still missing a measurement.
        </p>
      )}

      {/* Accepted but not yet durable, or failed. Kept visible so the athlete is never
          told a value was recorded while its write is outstanding, and so a failed one
          can be retried rather than silently lost. */}
      {pending.length > 0 && (
        <ul className="mt-3 space-y-2">
          {pending.map((entry) => (
            <li
              key={entry.key}
              className={`rounded-xl p-3 text-sm ${
                entry.status === "failed" ? "bg-red-50" : "bg-white"
              }`}
            >
              <p className="font-medium text-slate-900">
                Exercise {entry.blockPosition} · {entry.blockName} · Stone{" "}
                {entry.shotNumber} · {entry.handle === "in" ? "In" : "Out"} Handle
              </p>
              {entry.status === "pending" ? (
                <p role="status" className="mt-0.5 text-xs text-slate-500">
                  Saving {quantityLabel(entry.quantity).toLowerCase()}{" "}
                  {formatMeasuredValue(entry.value, entry.quantity)}…
                </p>
              ) : (
                <>
                  <p role="alert" className="mt-0.5 text-xs text-red-700">
                    {entry.message ?? "That measurement could not be saved yet."}
                  </p>

                  {/* The value stays on screen, in its own labelled field, so the
                      athlete can see exactly what is still outstanding. It is
                      read-only because the measurement is already on the stone in
                      this session — only its WRITE is missing, and a different
                      number here could not be applied without overwriting a recorded
                      measurement, which completion deliberately never does. */}
                  <label
                    className="mt-2 block text-xs font-medium text-slate-500"
                    htmlFor={`pending-completion-${entry.key}`}
                  >
                    {quantityLabel(entry.quantity)} for stone {entry.shotNumber} (
                    {quantityUnitLabel(entry.quantity)})
                  </label>
                  <input
                    id={`pending-completion-${entry.key}`}
                    type="text"
                    readOnly
                    value={String(entry.value)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-red-200 bg-white px-4 py-3 text-lg text-slate-900"
                  />

                  {onRetry && (
                    <button
                      type="button"
                      onClick={() => onRetry(entry.key)}
                      disabled={disabled}
                      className="mt-2 min-h-11 w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Retry Saving
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-3 space-y-2">
        {entries.flatMap((entry) =>
          entry.missing.map((quantity) => {
            const key = completionKey({
              sessionId: entry.shot.sessionId,
              blockId: entry.blockId,
              shotId: entry.shot.id,
              quantity,
            });
            const isSelected = key === selectedKey;
            const typed = (drafts[key] ?? "").trim() !== "";

            return (
              <li key={key}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() =>
                    // Selecting never clears anything: each stone keeps its own typed
                    // value, so moving between them cannot silently discard work.
                    onChangeSelection(
                      isSelected
                        ? null
                        : {
                            sessionId: entry.shot.sessionId,
                            blockId: entry.blockId,
                            shotId: entry.shot.id,
                            quantity,
                          }
                    )
                  }
                  className={`min-h-11 w-full rounded-xl px-3 py-2.5 text-left text-sm transition ${
                    isSelected
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span className="block font-medium">
                    {describe(entry, quantity)}
                  </span>
                  <span
                    className={`block text-xs ${isSelected ? "text-slate-300" : "text-slate-500"}`}
                  >
                    Missing {quantityLabel(quantity).toLowerCase()}
                    {typed && !isSelected && " · unsaved entry"}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      {selection && selectedEntry && selectedKey && (
        <div className="mt-3 rounded-xl bg-white p-3">
          <label
            className="text-xs font-medium text-slate-500"
            htmlFor="missing-measurement-value"
          >
            {quantityLabel(selection.quantity)} for stone{" "}
            {selectedEntry.shot.shotNumber} ({quantityUnitLabel(selection.quantity)})
          </label>

          <input
            id="missing-measurement-value"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            placeholder={selection.quantity === "speed" ? "2.40" : "3.75"}
            value={draftValue}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            onChange={(event) => {
              const value = event.target.value;
              const pattern =
                selection.quantity === "speed"
                  ? SPEED_INPUT_PATTERN
                  : /^[0-9.,]*$/;
              if (!pattern.test(value)) return;
              setLocalError(null);
              onChangeDraft(selectedKey, value);
            }}
            className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900 placeholder:text-slate-400"
          />

          {(draftIsInvalid || localError) && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {localError ??
                `Enter a ${quantityLabel(selection.quantity).toLowerCase()} greater than zero.`}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={disabled || selectedInFlight}
            className="mt-3 min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {selectedInFlight
              ? "Saving…"
              : `Add ${quantityLabel(selection.quantity)}`}
          </button>
        </div>
      )}

      {confirmation && (
        <p role="status" className="mt-3 text-sm text-slate-600">
          Saved {quantityLabel(confirmation.quantity).toLowerCase()}{" "}
          {formatMeasuredValue(confirmation.value, confirmation.quantity)} to{" "}
          Exercise {confirmation.blockPosition} · {confirmation.blockName} stone{" "}
          {confirmation.shotNumber}.
          {entries.length === 0 &&
            failed.length === 0 &&
            inFlight.length === 0 &&
            " Nothing else is missing in this training."}
        </p>
      )}
    </section>
  );
}
