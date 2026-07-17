"use client";

import { useRef, useState } from "react";
import {
  DEFAULT_CAPTURE_SHOT_COUNT,
  MAX_CAPTURE_SHOT_COUNT,
} from "../lib/captureSequence";
import { parseReleaseTime } from "../lib/timeInput";
import type {
  CaptureHandleMode,
  CaptureSequence,
  Handle,
  ShotType,
  TrainingBlock,
} from "../types";
import { surfaceClass } from "./Surface";

export type AutoCaptureStartConfig = {
  expectedShotCount: number;
  handleMode: CaptureHandleMode;
  startHandle: Handle;
  shotType?: ShotType;
};

type AutoCaptureProps = {
  activeBlock: TrainingBlock;
  captureSequence?: CaptureSequence;
  currentTargetTime: number;
  manualHandle: Handle;
  onChangeManualHandle: (handle: Handle) => void;
  manualTargetInput: string;
  onChangeManualTargetInput: (value: string) => void;
  lastCaptureMessage?: string;
  onStart: (config: AutoCaptureStartConfig) => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onManualResult: (value: number) => void;
  /** Only true in development builds — the Simulator itself never renders
   * otherwise, so this description shouldn't mention it to production
   * users either (DESIGN_SYSTEM.md: no dev-only explanations in production). */
  isDevEnvironment?: boolean;
  /**
   * "hero" when a capture sequence is actively running (this is then the
   * current capture task), "primary" (default) while idle/configuring and
   * Shot Entry is the active hero — see TrackerApp.tsx's Active Training
   * surface hierarchy.
   */
  level?: "hero" | "primary";
};

const HANDLE_MODES: CaptureHandleMode[] = ["manual", "fixed-in", "fixed-out", "alternate"];

function handleModeLabel(mode: CaptureHandleMode): string {
  switch (mode) {
    case "manual":
      return "Manual";
    case "fixed-in":
      return "Fixed In";
    case "fixed-out":
      return "Fixed Out";
    case "alternate":
      return "Alternate";
  }
}

export default function AutoCapture({
  activeBlock,
  captureSequence,
  currentTargetTime,
  manualHandle,
  onChangeManualHandle,
  manualTargetInput,
  onChangeManualTargetInput,
  lastCaptureMessage,
  onStart,
  onPause,
  onResume,
  onCancel,
  onUndo,
  onManualResult,
  isDevEnvironment = false,
  level = "primary",
}: AutoCaptureProps) {
  const [shotCountInput, setShotCountInput] = useState(
    String(DEFAULT_CAPTURE_SHOT_COUNT)
  );
  const [handleMode, setHandleMode] = useState<CaptureHandleMode>("alternate");
  const [startHandle, setStartHandle] = useState<Handle>("in");
  const [shotType, setShotType] = useState<ShotType>("draw");
  const [manualResultInput, setManualResultInput] = useState("");

  // Guards a literal double-click (two "click" events firing within the same
  // synchronous tick, before React has re-rendered to visually disable the button) from
  // submitting the same typed value as two separate manual results. A ref (not state)
  // because it must be checked and set synchronously, inside the click handler itself —
  // waiting for a state update to disable the button would still leave a window open.
  // Cleared on the next microtask so a genuine, deliberate second submission shortly
  // after still works normally; the actual dedup/serialization guarantee against real
  // races lives in the domain layer (captureQueueRef in TrackerApp.tsx), this is purely
  // a UX nicety against an accidental double-tap.
  const submittingManualResultRef = useRef(false);

  const isVariableManualTarget =
    activeBlock.mode === "variable" && activeBlock.variableTargetMode === "manual";

  const isActive =
    captureSequence !== undefined &&
    captureSequence.status !== "completed" &&
    captureSequence.status !== "cancelled";

  function handleStart() {
    const parsedCount = Number(shotCountInput);

    if (
      !Number.isInteger(parsedCount) ||
      parsedCount <= 0 ||
      parsedCount > MAX_CAPTURE_SHOT_COUNT
    ) {
      alert(
        `Number of shots must be a whole number between 1 and ${MAX_CAPTURE_SHOT_COUNT}.`
      );
      return;
    }

    onStart({
      expectedShotCount: parsedCount,
      handleMode,
      startHandle,
      shotType: activeBlock.mode === "fixed" ? shotType : undefined,
    });
  }

  function handleManualResultSubmit() {
    if (submittingManualResultRef.current) return;

    const parsed = parseReleaseTime(manualResultInput);

    if (parsed === null || parsed <= 0) {
      alert("Please enter a valid measured time.");
      return;
    }

    submittingManualResultRef.current = true;
    Promise.resolve().then(() => {
      submittingManualResultRef.current = false;
    });

    onManualResult(parsed);
    setManualResultInput("");
  }

  if (!isActive) {
    return (
      <div className={surfaceClass(level)}>
        <h2 className="text-xl font-semibold text-slate-900">Auto Capture</h2>

        <p className="mt-2 text-sm text-slate-600">
          {isDevEnvironment
            ? "Have a timing result (or the Simulator, in development mode) automatically save each shot as it comes in."
            : "Have a timing result automatically save each shot as it comes in."}
        </p>

        {captureSequence?.status === "completed" && (
          <>
            <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
              Previous capture complete: {captureSequence.capturedShotCount} /{" "}
              {captureSequence.expectedShotCount} shots captured.
            </p>

            <button
              type="button"
              onClick={onUndo}
              disabled={captureSequence.steps.length === 0}
              className="mt-2 w-full rounded-xl bg-slate-200 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Undo Last Captured Shot
            </button>
          </>
        )}

        {captureSequence?.status === "cancelled" && (
          <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
            Previous capture cancelled after {captureSequence.capturedShotCount} shot
            {captureSequence.capturedShotCount === 1 ? "" : "s"}.
          </p>
        )}

        <div className="mt-4">
          <label
            htmlFor="capture-shot-count"
            className="text-sm font-medium text-slate-700"
          >
            Number of Shots
          </label>

          <input
            id="capture-shot-count"
            type="text"
            inputMode="numeric"
            value={shotCountInput}
            onChange={(event) => {
              if (/^[0-9]*$/.test(event.target.value)) {
                setShotCountInput(event.target.value);
              }
            }}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900"
          />
        </div>

        <div className="mt-4">
          <label className="text-sm font-medium text-slate-700">
            Handle Strategy
          </label>

          <div className="mt-2 grid grid-cols-2 gap-2">
            {HANDLE_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setHandleMode(mode)}
                className={`rounded-xl px-3 py-3 text-sm font-medium transition ${
                  handleMode === mode
                    ? "bg-slate-900 text-white"
                    : "bg-slate-200 text-slate-700"
                }`}
              >
                {handleModeLabel(mode)}
              </button>
            ))}
          </div>

          {handleMode === "alternate" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setStartHandle("in")}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  startHandle === "in"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-200 text-slate-700"
                }`}
              >
                Start with In
              </button>

              <button
                type="button"
                onClick={() => setStartHandle("out")}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  startHandle === "out"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-200 text-slate-700"
                }`}
              >
                Start with Out
              </button>
            </div>
          )}
        </div>

        {activeBlock.mode === "fixed" && (
          <div className="mt-4">
            <label className="text-sm font-medium text-slate-700">Shot Type</label>

            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["draw", "takeout"] as ShotType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setShotType(type)}
                  className={`rounded-xl px-4 py-3 font-medium capitalize transition ${
                    shotType === type
                      ? "bg-slate-900 text-white"
                      : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleStart}
          className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
        >
          Start Auto Capture
        </button>
      </div>
    );
  }

  // Active: ready / running / paused
  return (
    <div className={surfaceClass(level)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-slate-900">Auto Capture</h2>

        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            captureSequence!.status === "paused"
              ? "bg-amber-100 text-amber-700"
              : "bg-slate-900 text-white"
          }`}
        >
          {captureSequence!.status === "paused" ? "Paused" : "Running"}
        </span>
      </div>

      <p className="mt-2 text-lg font-semibold text-slate-900">
        {captureSequence!.capturedShotCount} / {captureSequence!.expectedShotCount} shots
      </p>

      <div className={surfaceClass("inset", "mt-3")}>
        <p className="text-sm text-slate-500">Current Target</p>

        {isVariableManualTarget ? (
          <input
            type="text"
            inputMode="decimal"
            aria-label="Current target time"
            value={manualTargetInput}
            onChange={(event) => {
              if (/^[0-9.,]*$/.test(event.target.value)) {
                onChangeManualTargetInput(event.target.value);
              }
            }}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900"
          />
        ) : (
          <p className="mt-1 text-2xl font-semibold text-slate-900">
            {currentTargetTime.toFixed(2)}s
          </p>
        )}
      </div>

      {captureSequence!.handleMode === "manual" ? (
        <div className="mt-3">
          <p className="text-sm font-medium text-slate-700">Next Handle</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onChangeManualHandle("in")}
              className={`flex-1 rounded-xl px-4 py-3 font-medium transition ${
                manualHandle === "in"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              In Handle
            </button>
            <button
              type="button"
              onClick={() => onChangeManualHandle("out")}
              className={`flex-1 rounded-xl px-4 py-3 font-medium transition ${
                manualHandle === "out"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              Out Handle
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          Next Handle:{" "}
          <span className="font-medium text-slate-900">
            {captureSequence!.handleMode === "fixed-in"
              ? "In"
              : captureSequence!.handleMode === "fixed-out"
                ? "Out"
                : ""}
          </span>
        </p>
      )}

      <p className="mt-3 text-sm text-slate-500">
        {captureSequence!.status === "paused"
          ? captureSequence!.lastError
            ? "Paused after an unexpected error — resume to try again."
            : "Paused — resume to keep capturing."
          : "Waiting for timing result…"}
      </p>

      {captureSequence!.lastError && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {captureSequence!.lastError}
        </p>
      )}

      {lastCaptureMessage && (
        <p className="mt-2 text-sm font-medium text-slate-900">
          {lastCaptureMessage}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        {captureSequence!.status === "paused" ? (
          <button
            type="button"
            onClick={onResume}
            className="rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
          >
            Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={onPause}
            className="rounded-xl bg-slate-200 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-300"
          >
            Pause
          </button>
        )}

        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl bg-red-100 px-4 py-3 font-medium text-red-700 transition hover:bg-red-200"
        >
          Cancel
        </button>
      </div>

      <button
        type="button"
        onClick={onUndo}
        disabled={captureSequence!.steps.length === 0}
        className="mt-2 w-full rounded-xl bg-slate-200 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Undo Last Captured Shot
      </button>

      <div className={surfaceClass("inset", "mt-4")}>
        <p className="text-sm font-medium text-slate-700">Add Result Manually</p>
        <p className="mt-1 text-xs text-slate-500">
          {captureSequence!.status === "paused"
            ? "Resume the sequence to add a result manually."
            : isDevEnvironment
              ? "Works even if the simulator is off or a real device isn't connected."
              : "Works even if a real device isn't connected."}
        </p>

        <div className="mt-2 flex gap-2">
          <input
            type="text"
            inputMode="decimal"
            placeholder="3.75 or 375"
            disabled={captureSequence!.status === "paused"}
            value={manualResultInput}
            onChange={(event) => {
              if (/^[0-9.,]*$/.test(event.target.value)) {
                setManualResultInput(event.target.value);
              }
            }}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          />

          <button
            type="button"
            disabled={captureSequence!.status === "paused"}
            onClick={handleManualResultSubmit}
            className="whitespace-nowrap rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
