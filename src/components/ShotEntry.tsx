"use client";

import { useState } from "react";
import { parseReleaseTime } from "../lib/timeInput";
import type { Handle, ShotType } from "../types";

type ShotEntryProps = {
  onAddShot: (
    releaseTime: number,
    handle: Handle,
    shotType: ShotType
  ) => void;
};

export default function ShotEntry({ onAddShot }: ShotEntryProps) {
  const [inputValue, setInputValue] = useState("");
  const [handle, setHandle] = useState<Handle>("in");
  const [shotType, setShotType] = useState<ShotType>("draw");

  function handleAddShot() {
    const parsedValue = parseReleaseTime(inputValue);

    if (parsedValue === null) {
      alert("Please enter a valid release time.");
      return;
    }

    onAddShot(parsedValue, handle, shotType);
    setInputValue("");
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-lg">
      <h2 className="text-xl font-semibold text-slate-900">Add Shot</h2>

      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        placeholder="3.75 or 375"
        value={inputValue}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            handleAddShot();
          }
        }}
        onChange={(event) => {
          const value = event.target.value;
          const isValidInput = /^[0-9.,]*$/.test(value);

          if (isValidInput) {
            setInputValue(value);
          }
        }}
        className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900 placeholder:text-slate-400"
      />

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setHandle("in")}
          className={`flex-1 rounded-xl px-4 py-3 font-medium transition ${
            handle === "in"
              ? "bg-slate-900 text-white"
              : "bg-slate-200 text-slate-700"
          }`}
        >
          In Handle
        </button>

        <button
          type="button"
          onClick={() => setHandle("out")}
          className={`flex-1 rounded-xl px-4 py-3 font-medium transition ${
            handle === "out"
              ? "bg-slate-900 text-white"
              : "bg-slate-200 text-slate-700"
          }`}
        >
          Out Handle
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {(["draw", "guard", "takeout", "other"] as ShotType[]).map((type) => (
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

      <button
        type="button"
        onClick={handleAddShot}
        className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-white transition hover:bg-slate-700"
      >
        Add Shot
      </button>
    </div>
  );
}