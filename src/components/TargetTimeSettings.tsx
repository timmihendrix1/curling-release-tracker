"use client";

import { useState } from "react";
import { parseReleaseTime } from "../lib/timeInput";
import { surfaceClass } from "./Surface";

type TargetTimeSettingsProps = {
  targetTime: number;
  onChangeTargetTime: (targetTime: number) => void;
  /** "bare" strips the outer surface for use inside another container
   * (the collapsible Edit Details section) so it never nests a card inside
   * a card — see SessionSettings' equivalent variant. */
  variant?: "card" | "bare";
  /**
   * True while the Session domain isn't "ready" (see
   * docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.10). Defaults to false so
   * existing call sites/tests keep today's always-enabled behavior.
   */
  disabled?: boolean;
};

export default function TargetTimeSettings({
  targetTime,
  onChangeTargetTime,
  variant = "card",
  disabled = false,
}: TargetTimeSettingsProps) {
  const [inputValue, setInputValue] = useState(targetTime.toFixed(2));

  function handleSave() {
    const parsedValue = parseReleaseTime(inputValue);

    if (parsedValue === null) {
      alert("Please enter a valid target time.");
      return;
    }

    onChangeTargetTime(parsedValue);
    setInputValue(parsedValue.toFixed(2));
  }

  return (
    <div className={variant === "card" ? surfaceClass("hero") : ""}>
      {variant === "card" && (
        <h2 className="text-xl font-semibold text-slate-900">
          Target Time
        </h2>
      )}

      <p className="mt-2 text-sm text-slate-600">
        Set the target release time for the active training block.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={inputValue}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            const isValidInput = /^[0-9.,]*$/.test(value);

            if (isValidInput) {
              setInputValue(value);
            }
          }}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100"
        />

        <button
          type="button"
          onClick={handleSave}
          disabled={disabled}
          className="rounded-xl bg-slate-900 px-5 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Save
        </button>
      </div>

      <p className="mt-3 text-sm text-slate-500">
        Current target: {targetTime.toFixed(2)}s
      </p>
    </div>
  );
}