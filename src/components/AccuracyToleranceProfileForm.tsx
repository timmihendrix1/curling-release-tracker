"use client";

import { useState } from "react";
import { MAX_PROFILE_NAME_LENGTH } from "../lib/accuracyToleranceProfiles/profiles";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import type { MeasuredQuantity, QuantityTolerance } from "../types";
import {
  defaultToleranceDraft,
  draftFromTolerance,
  parseToleranceDraft,
  type QuantityToleranceDraft,
} from "../lib/measurement/toleranceDraft";
import { quantityLabel } from "../lib/measurement/tolerance";
import QuantityToleranceEditor from "./QuantityToleranceEditor";

export type AccuracyToleranceProfileFormValue = {
  name: string;
  /**
   * Carried through explicitly so a save is self-describing. When EDITING, it is
   * always the stored template's own quantity — this form cannot change what unit a
   * template is in, because doing so would silently reinterpret its numbers rather
   * than convert them (there is no conversion between seconds and m/s).
   */
  quantity: MeasuredQuantity;
  /** The full per-side tolerance. A symmetric template simply carries equal sides. */
  tolerance: QuantityTolerance;
};

type AccuracyToleranceProfileFormProps = {
  initialProfile?: AccuracyToleranceProfile;
  onSave: (value: AccuracyToleranceProfileFormValue) => void;
  onCancel: () => void;
};

/**
 * Create/edit form for one Accuracy Tolerance Profile.
 *
 * Stage B completes it: every template shape this app can store — seconds or metres
 * per second, symmetric or per-side — can now be created and edited here, through the
 * same `QuantityToleranceEditor` and the same `validateQuantityTolerance` rule that
 * Training Block and Plan Step setup use (ADR-0008, ADR-0051). Before this stage a
 * speed or asymmetric template was shown read-only, because the form had one seconds
 * field per band and saving through it would have flattened or re-unitted the value.
 *
 * The one thing still deliberately immutable is a template's QUANTITY. Blocks, plan
 * steps and history already copied this template's numbers; letting an edit relabel
 * 0.05s as 0.05 m/s would change what every one of those copies was judged against.
 */
export default function AccuracyToleranceProfileForm({
  initialProfile,
  onSave,
  onCancel,
}: AccuracyToleranceProfileFormProps) {
  const [name, setName] = useState(initialProfile?.name ?? "");
  const [quantity, setQuantity] = useState<MeasuredQuantity>(
    initialProfile?.quantity ?? "time"
  );
  const [draft, setDraft] = useState<QuantityToleranceDraft>(() =>
    initialProfile
      ? draftFromTolerance(initialProfile.tolerance, initialProfile.quantity)
      : defaultToleranceDraft("time")
  );

  // Editing never offers the quantity control at all, so there is no state in which a
  // stored template's unit can be changed from this screen.
  const quantityIsFixed = initialProfile !== undefined;

  function handleSelectQuantity(next: MeasuredQuantity) {
    if (quantityIsFixed || next === quantity) return;
    setQuantity(next);
    // The NUMBERS are not carried across units — 0.10s and 0.10 m/s are unrelated
    // values, and reusing the digits is exactly the silent reinterpretation this form
    // refuses to perform. The new quantity's own starting values are used instead.
    setDraft(defaultToleranceDraft(next));
  }

  const validation = parseToleranceDraft(draft);

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

    if (!validation.valid) {
      // The inline error inside the editor already explains why.
      return;
    }

    onSave({
      name: trimmedName,
      quantity,
      tolerance: validation.tolerance,
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
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400"
          />
        </div>

        <div className="mt-4">
          <span className="text-sm font-medium text-slate-700">Measurement</span>

          {quantityIsFixed ? (
            <p className="mt-1 text-xs text-slate-500">
              {quantityLabel(quantity)} — a saved profile keeps its measurement.
              Create a new profile for the other one.
            </p>
          ) : (
            <div
              role="radiogroup"
              aria-label="Measurement"
              className="mt-2 grid grid-cols-2 gap-2"
            >
              {(["time", "speed"] as MeasuredQuantity[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={quantity === option}
                  onClick={() => handleSelectQuantity(option)}
                  className={`min-h-11 rounded-xl px-3 py-3 text-sm font-medium transition ${
                    quantity === option
                      ? "bg-slate-900 text-white"
                      : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {option === "speed" ? "Speed (m/s)" : "Time (s)"}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4">
          <QuantityToleranceEditor
            idPrefix="accuracy-tolerance-profile"
            draft={draft}
            onChange={setDraft}
            // A template is itself the thing other screens pick from, so it offers no
            // "start from a saved template" list of its own — only the app's built-in
            // starting values, which the editor supplies.
            profiles={[]}
          />
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-xl bg-slate-200 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-300"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!validation.valid}
            className="min-h-11 flex-1 rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {initialProfile ? "Save Profile" : "Create Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}
