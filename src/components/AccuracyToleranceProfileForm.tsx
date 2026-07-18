"use client";

import { useState } from "react";
import { validateAccuracyThresholds } from "../lib/accuracyThresholds";
import { MAX_PROFILE_NAME_LENGTH } from "../lib/accuracyToleranceProfiles/profiles";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import { parseReleaseTime } from "../lib/timeInput";

export type AccuracyToleranceProfileFormValue = {
  name: string;
  onTarget: number;
  acceptable: number;
};

type AccuracyToleranceProfileFormProps = {
  initialProfile?: AccuracyToleranceProfile;
  onSave: (value: AccuracyToleranceProfileFormValue) => void;
  onCancel: () => void;
};

/**
 * Create/edit form for one Accuracy Tolerance Profile — reuses the exact same
 * `validateAccuracyThresholds` rule as Training Block/Plan Step setup (see
 * src/lib/accuracyThresholds.ts, ADR-0008), so a profile can never be saved with
 * values that wouldn't be accepted anywhere else in the app.
 */
export default function AccuracyToleranceProfileForm({
  initialProfile,
  onSave,
  onCancel,
}: AccuracyToleranceProfileFormProps) {
  const [name, setName] = useState(initialProfile?.name ?? "");
  const [onTargetInput, setOnTargetInput] = useState(
    (initialProfile?.onTarget ?? 0.1).toFixed(2)
  );
  const [acceptableInput, setAcceptableInput] = useState(
    (initialProfile?.acceptable ?? 0.2).toFixed(2)
  );

  const thresholdsValidation = validateAccuracyThresholds(
    parseReleaseTime(onTargetInput) ?? NaN,
    parseReleaseTime(acceptableInput) ?? NaN
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

    if (!thresholdsValidation.valid) {
      // The inline error below already explains why.
      return;
    }

    onSave({
      name: trimmedName,
      onTarget: thresholdsValidation.onTarget,
      acceptable: thresholdsValidation.acceptable,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-xl font-semibold text-slate-900">
          {initialProfile ? "Edit Profile" : "New Accuracy Tolerance Profile"}
        </h2>

        <div className="mt-4">
          <label
            className="text-sm font-medium text-slate-700"
            htmlFor="accuracy-tolerance-profile-name"
          >
            Profile Name
          </label>

          <input
            id="accuracy-tolerance-profile-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Elite"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400"
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div>
            <label
              className="text-xs text-slate-500"
              htmlFor="accuracy-tolerance-profile-on-target"
            >
              On Target (±s)
            </label>

            <input
              id="accuracy-tolerance-profile-on-target"
              type="text"
              inputMode="decimal"
              value={onTargetInput}
              onChange={(event) => {
                const value = event.target.value;
                if (/^[0-9.,]*$/.test(value)) setOnTargetInput(value);
              }}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            />
          </div>

          <div>
            <label
              className="text-xs text-slate-500"
              htmlFor="accuracy-tolerance-profile-acceptable"
            >
              Acceptable (±s)
            </label>

            <input
              id="accuracy-tolerance-profile-acceptable"
              type="text"
              inputMode="decimal"
              value={acceptableInput}
              onChange={(event) => {
                const value = event.target.value;
                if (/^[0-9.,]*$/.test(value)) setAcceptableInput(value);
              }}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            />
          </div>
        </div>

        {thresholdsValidation.valid === false && (
          <p className="mt-2 text-xs text-red-600">
            {thresholdsValidation.error}
          </p>
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
