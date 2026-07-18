"use client";

import { useState } from "react";
import { measurementModeLabel } from "../lib/trainingBlocks";
import { parseReleaseTime } from "../lib/timeInput";
import { MAX_PROFILE_NAME_LENGTH } from "../lib/smartRandomProfiles/profiles";
import type { SmartRandomProfile } from "../lib/smartRandomProfiles/persistence";
import { validateSmartRandomRange } from "../lib/variableTargets";

export type SmartRandomProfileFormValue = {
  name: string;
  min: number;
  max: number;
};

type SmartRandomProfileFormProps = {
  initialProfile?: SmartRandomProfile;
  onSave: (value: SmartRandomProfileFormValue) => void;
  onCancel: () => void;
};

/**
 * Create/edit form for one Smart Random Profile — reuses the exact same
 * `validateSmartRandomRange` rule as Training Block/Plan Step setup (see
 * src/lib/variableTargets.ts), so a profile can never be saved with a range
 * that wouldn't be accepted anywhere else in the app. Measurement Mode is
 * shown as a fixed, read-only "Backline – Hog" — Smart Random has no
 * validated range for any other Measurement Mode yet (see
 * isSmartRandomAvailable), so there is nothing to choose between.
 */
export default function SmartRandomProfileForm({
  initialProfile,
  onSave,
  onCancel,
}: SmartRandomProfileFormProps) {
  const [name, setName] = useState(initialProfile?.name ?? "");
  const [minInput, setMinInput] = useState((initialProfile?.min ?? 2.5).toFixed(2));
  const [maxInput, setMaxInput] = useState((initialProfile?.max ?? 4.5).toFixed(2));

  const rangeValidation = validateSmartRandomRange(
    parseReleaseTime(minInput) ?? NaN,
    parseReleaseTime(maxInput) ?? NaN
  );

  const trimmedName = name.trim();
  const nameError = !trimmedName
    ? "Give this profile a name."
    : trimmedName.length > MAX_PROFILE_NAME_LENGTH
      ? `Profile names must be ${MAX_PROFILE_NAME_LENGTH} characters or fewer.`
      : null;

  function handleSubmit() {
    if (nameError) {
      alert(nameError);
      return;
    }

    if (!rangeValidation.valid) {
      // The inline error below already explains why.
      return;
    }

    onSave({
      name: trimmedName,
      min: rangeValidation.min,
      max: rangeValidation.max,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-xl font-semibold text-slate-900">
          {initialProfile ? "Edit Profile" : "New Smart Random Profile"}
        </h2>

        <div className="mt-4">
          <label
            className="text-sm font-medium text-slate-700"
            htmlFor="smart-random-profile-name"
          >
            Profile Name
          </label>

          <input
            id="smart-random-profile-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Full Weight Range"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400"
          />
        </div>

        <div className="mt-4">
          <p className="text-xs text-slate-500">
            Measurement Mode: {measurementModeLabel("back-hog")}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Smart Random isn&apos;t available for Hog – Hog yet — see the
            Measurement Mode explanation in Training Setup.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div>
            <label
              className="text-xs text-slate-500"
              htmlFor="smart-random-profile-min"
            >
              Minimum Target Time
            </label>

            <input
              id="smart-random-profile-min"
              type="text"
              inputMode="decimal"
              value={minInput}
              onChange={(event) => {
                const value = event.target.value;
                if (/^[0-9.,]*$/.test(value)) setMinInput(value);
              }}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            />
          </div>

          <div>
            <label
              className="text-xs text-slate-500"
              htmlFor="smart-random-profile-max"
            >
              Maximum Target Time
            </label>

            <input
              id="smart-random-profile-max"
              type="text"
              inputMode="decimal"
              value={maxInput}
              onChange={(event) => {
                const value = event.target.value;
                if (/^[0-9.,]*$/.test(value)) setMaxInput(value);
              }}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            />
          </div>
        </div>

        {rangeValidation.valid === false && (
          <p className="mt-2 text-xs text-red-600">{rangeValidation.error}</p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl bg-slate-200 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-300"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            className="flex-1 rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
          >
            {initialProfile ? "Save Profile" : "Create Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}
