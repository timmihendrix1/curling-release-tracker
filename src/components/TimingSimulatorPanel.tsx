"use client";

import { useState } from "react";
import type { SimulatorTimingProvider } from "../lib/simulatorTimingProvider";
import { parseReleaseTime } from "../lib/timeInput";
import type { MeasurementMode, TimingResult } from "../types";

export type SimulatorDiagnosticEntry = {
  id: string;
  at: string;
  status: string;
  message: string;
};

type TimingSimulatorPanelProps = {
  provider: SimulatorTimingProvider;
  measurementMode: MeasurementMode;
  diagnostics: SimulatorDiagnosticEntry[];
};

const QUICK_VALUES = [3.5, 3.75, 4.0];

function otherMeasurementMode(mode: MeasurementMode): MeasurementMode {
  return mode === "back-hog" ? "hog-hog" : "back-hog";
}

// Development/test-only controls for exercising the Capture Sequence flow without real
// timing hardware. This panel never saves a shot itself — it only calls the shared
// `SimulatorTimingProvider`, which delivers a normalized TimingResult exactly like a
// future real device would (see docs/adr/0006). Not shown in production.
export default function TimingSimulatorPanel({
  provider,
  measurementMode,
  diagnostics,
}: TimingSimulatorPanelProps) {
  const [valueInput, setValueInput] = useState("3.75");
  const [lastResult, setLastResult] = useState<TimingResult | undefined>();

  function sendValue(value: number) {
    const result = provider.simulateResult(measurementMode, value);
    setLastResult(result);
  }

  function handleSendTyped() {
    const parsed = parseReleaseTime(valueInput);
    if (parsed === null) {
      alert("Enter a valid time to simulate.");
      return;
    }
    sendValue(parsed);
  }

  return (
    <div className="rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 p-6">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-amber-400 px-2 py-1 text-xs font-semibold text-amber-950">
          DEV TOOL
        </span>
        <h2 className="text-lg font-semibold text-slate-900">
          Timing Simulator
        </h2>
      </div>

      <p className="mt-1 text-xs text-slate-600">
        Stands in for real timing hardware during development and testing. Not shown in
        production.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={valueInput}
          onChange={(event) => {
            if (/^[0-9.,]*$/.test(event.target.value)) {
              setValueInput(event.target.value);
            }
          }}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
        />

        <button
          type="button"
          onClick={handleSendTyped}
          className="whitespace-nowrap rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
        >
          Send Result
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        {QUICK_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => sendValue(value)}
            className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow"
          >
            {value.toFixed(2)}s
          </button>
        ))}
      </div>

      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">
        Edge cases
      </p>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!lastResult}
          onClick={() => lastResult && provider.simulateDuplicate(lastResult)}
          className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow disabled:cursor-not-allowed disabled:opacity-50"
        >
          Duplicate Result
        </button>

        <button
          type="button"
          onClick={() => provider.simulateInvalidResult(-1)}
          className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow"
        >
          Invalid (Negative)
        </button>

        <button
          type="button"
          onClick={() => provider.simulateInvalidResult(0)}
          className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow"
        >
          Invalid (Zero)
        </button>

        <button
          type="button"
          onClick={() => provider.simulateMultiMeasurementResult([])}
          className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow"
        >
          Empty Measurements
        </button>

        <button
          type="button"
          onClick={() => {
            const parsed = parseReleaseTime(valueInput) ?? 3.75;
            const result = provider.simulateResult(
              otherMeasurementMode(measurementMode),
              parsed
            );
            setLastResult(result);
          }}
          className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow"
        >
          Wrong Measurement Mode
        </button>

        <button
          type="button"
          onClick={() => {
            const parsed = parseReleaseTime(valueInput) ?? 3.75;
            provider.simulateDelayed(measurementMode, parsed, 1500);
          }}
          className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow"
        >
          Delayed (1.5s)
        </button>

        <button
          type="button"
          onClick={() => {
            const parsed = parseReleaseTime(valueInput) ?? 3.75;
            const result = provider.simulateMultiMeasurementResult([
              { measurementMode, value: parsed },
              { measurementMode: otherMeasurementMode(measurementMode), value: parsed + 3 },
            ]);
            setLastResult(result);
          }}
          className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow"
        >
          Multi-Measurement
        </button>
      </div>

      {diagnostics.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Recent results (debug)
          </p>

          <div className="mt-2 space-y-1">
            {diagnostics.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow"
              >
                <span className="font-mono font-semibold text-slate-900">
                  {entry.status}
                </span>{" "}
                — {entry.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
