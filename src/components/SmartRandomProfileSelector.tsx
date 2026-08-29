"use client";

import type { MeasurementMode } from "../types";
import type { SmartRandomProfile } from "../lib/smartRandomProfiles/persistence";

export const CUSTOM_FOR_THIS_EXERCISE_VALUE = "";

type SmartRandomProfileSelectorProps = {
  profiles: SmartRandomProfile[];
  /** Only profiles matching this Measurement Mode are ever offered — a
   * profile can never be applied in the wrong measurement context. */
  measurementMode: MeasurementMode;
  /** `null` means "Custom for this exercise" — a one-off, unsaved range. */
  selectedProfileId: string | null;
  onSelectProfile: (profileId: string | null) => void;
  minInput: string;
  maxInput: string;
  onChangeMinInput: (value: string) => void;
  onChangeMaxInput: (value: string) => void;
  /** Only meaningful when no saved profile is selected (a one-off custom range). */
  errorMessages?: string[];
};

/**
 * Reusable "pick a saved Smart Random Profile, or enter a one-off Custom
 * range" control — used wherever Smart Random is configured (Variable Weight
 * and Blind Weight Release Time setup, New Training Block, Training Plan Step Editor,
 * all via TrainingSetup.tsx). Selecting a profile copies its current
 * min/max into the fields the caller already tracks (`minInput`/`maxInput`) —
 * nothing here persists a live reference back to the profile.
 */
export default function SmartRandomProfileSelector({
  profiles,
  measurementMode,
  selectedProfileId,
  onSelectProfile,
  minInput,
  maxInput,
  onChangeMinInput,
  onChangeMaxInput,
  errorMessages,
}: SmartRandomProfileSelectorProps) {
  const applicableProfiles = profiles.filter(
    (profile) => profile.measurementMode === measurementMode
  );

  const selectedProfile =
    selectedProfileId !== null
      ? applicableProfiles.find((profile) => profile.id === selectedProfileId)
      : undefined;

  return (
    <div className="space-y-2">
      {applicableProfiles.length > 0 && (
        <div>
          <label
            className="text-xs text-slate-500"
            htmlFor="smart-random-profile-select"
          >
            Smart Random Profile
          </label>

          <select
            id="smart-random-profile-select"
            value={selectedProfileId ?? CUSTOM_FOR_THIS_EXERCISE_VALUE}
            onChange={(event) => onSelectProfile(event.target.value || null)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
          >
            <option value={CUSTOM_FOR_THIS_EXERCISE_VALUE}>
              Custom for this exercise
            </option>
            {applicableProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedProfile ? (
        <p className="text-xs text-slate-500">
          {selectedProfile.name}: {selectedProfile.min.toFixed(2)}s–
          {selectedProfile.max.toFixed(2)}s
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              className="text-xs text-slate-500"
              htmlFor="smart-random-min-input"
            >
              Minimum Target Time
            </label>

            <input
              id="smart-random-min-input"
              type="text"
              inputMode="decimal"
              value={minInput}
              onChange={(event) => {
                const value = event.target.value;
                if (/^[0-9.,]*$/.test(value)) onChangeMinInput(value);
              }}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400"
            />
          </div>

          <div>
            <label
              className="text-xs text-slate-500"
              htmlFor="smart-random-max-input"
            >
              Maximum Target Time
            </label>

            <input
              id="smart-random-max-input"
              type="text"
              inputMode="decimal"
              value={maxInput}
              onChange={(event) => {
                const value = event.target.value;
                if (/^[0-9.,]*$/.test(value)) onChangeMaxInput(value);
              }}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400"
            />
          </div>

          {errorMessages && errorMessages.length > 0 ? (
            <p className="col-span-2 text-xs text-red-600">{errorMessages[0]}</p>
          ) : (
            <p className="col-span-2 text-xs text-slate-500">
              Targets vary within this range. The app usually avoids large
              jumps between consecutive shots.
            </p>
          )}
        </div>
      )}

      {applicableProfiles.length === 0 && (
        <p className="text-xs text-slate-400">
          Save a Smart Random Profile in Settings to reuse this range next
          time.
        </p>
      )}
    </div>
  );
}
