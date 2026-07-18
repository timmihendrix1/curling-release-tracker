"use client";

import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";

export const CUSTOM_FOR_THIS_EXERCISE_VALUE = "";

type AccuracyToleranceProfileSelectorProps = {
  profiles: AccuracyToleranceProfile[];
  /** `null` means "Custom for this exercise" — a one-off, unsaved value. */
  selectedProfileId: string | null;
  onSelectProfile: (profileId: string | null) => void;
  onTargetInput: string;
  acceptableInput: string;
  onChangeOnTargetInput: (value: string) => void;
  onChangeAcceptableInput: (value: string) => void;
  /** Only meaningful when no saved profile is selected (a one-off custom value). */
  errorMessages?: string[];
};

/**
 * Reusable "pick a saved Accuracy Tolerance Profile, or enter a one-off Custom
 * value" control — used wherever Custom Accuracy Tolerance is configured (Quick
 * Start, New Training Block, Training Plan Step Editor, all via TrainingSetup.tsx).
 * Selecting a profile copies its current numeric values into the fields the caller
 * already tracks (`onTargetInput`/`acceptableInput`) — nothing here persists a live
 * reference back to the profile; see docs/adr on Accuracy Tolerance Profiles.
 */
export default function AccuracyToleranceProfileSelector({
  profiles,
  selectedProfileId,
  onSelectProfile,
  onTargetInput,
  acceptableInput,
  onChangeOnTargetInput,
  onChangeAcceptableInput,
  errorMessages,
}: AccuracyToleranceProfileSelectorProps) {
  const selectedProfile =
    selectedProfileId !== null
      ? profiles.find((profile) => profile.id === selectedProfileId)
      : undefined;

  return (
    <div className="space-y-2">
      {profiles.length > 0 && (
        <div>
          <label
            className="text-xs text-slate-500"
            htmlFor="accuracy-tolerance-profile-select"
          >
            Accuracy Tolerance Profile
          </label>

          <select
            id="accuracy-tolerance-profile-select"
            value={selectedProfileId ?? CUSTOM_FOR_THIS_EXERCISE_VALUE}
            onChange={(event) =>
              onSelectProfile(event.target.value || null)
            }
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
          >
            <option value={CUSTOM_FOR_THIS_EXERCISE_VALUE}>
              Custom for this exercise
            </option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedProfile ? (
        <p className="text-xs text-slate-500">
          {selectedProfile.name}: On Target ±{selectedProfile.onTarget.toFixed(2)}s
          {" · "}Acceptable ±{selectedProfile.acceptable.toFixed(2)}s
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              className="text-xs text-slate-500"
              htmlFor="accuracy-tolerance-on-target-input"
            >
              On Target (±s)
            </label>
            <input
              id="accuracy-tolerance-on-target-input"
              type="text"
              inputMode="decimal"
              value={onTargetInput}
              onChange={(event) => {
                const value = event.target.value;
                if (/^[0-9.,]*$/.test(value)) onChangeOnTargetInput(value);
              }}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            />
          </div>

          <div>
            <label
              className="text-xs text-slate-500"
              htmlFor="accuracy-tolerance-acceptable-input"
            >
              Acceptable (±s)
            </label>
            <input
              id="accuracy-tolerance-acceptable-input"
              type="text"
              inputMode="decimal"
              value={acceptableInput}
              onChange={(event) => {
                const value = event.target.value;
                if (/^[0-9.,]*$/.test(value)) onChangeAcceptableInput(value);
              }}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            />
          </div>

          {errorMessages && errorMessages.length > 0 && (
            <p className="col-span-2 text-xs text-red-600">{errorMessages[0]}</p>
          )}
        </div>
      )}

      {profiles.length === 0 && (
        <p className="text-xs text-slate-400">
          Save an Accuracy Tolerance Profile in Settings to reuse these values next
          time.
        </p>
      )}
    </div>
  );
}
