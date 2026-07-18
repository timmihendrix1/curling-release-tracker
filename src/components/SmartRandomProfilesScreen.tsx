"use client";

import { useState } from "react";
import { measurementModeLabel } from "../lib/trainingBlocks";
import type { SmartRandomProfile } from "../lib/smartRandomProfiles/persistence";
import SmartRandomProfileForm, {
  type SmartRandomProfileFormValue,
} from "./SmartRandomProfileForm";
import ConfirmModal from "./ConfirmModal";

type SmartRandomProfilesScreenProps = {
  profiles: SmartRandomProfile[];
  defaultProfileId: string | null;
  onCreate: (value: SmartRandomProfileFormValue) => void;
  onUpdate: (profileId: string, value: SmartRandomProfileFormValue) => void;
  onDuplicate: (profileId: string) => void;
  onDelete: (profileId: string) => void;
  onSetDefault: (profileId: string | null) => void;
  onClose: () => void;
};

/**
 * Settings > Smart Random Profiles — the main management location for Smart
 * Random Profiles (create/edit/duplicate/delete/set default). A profile is a
 * reusable configuration aid only: editing or deleting one here never changes
 * an already-configured Training Block, Training Plan Step, active Session,
 * or historical analytics — those always hold the actual Smart Random range
 * that was copied from a profile at selection time, never a live reference
 * back to it. Follows the same management pattern as
 * AccuracyToleranceProfilesScreen.tsx where the domains align (list + form +
 * delete confirmation); Measurement Mode is shown per profile rather than
 * offered as a create-time choice, since Smart Random has no validated range
 * for anything but Back-Hog today.
 */
export default function SmartRandomProfilesScreen({
  profiles,
  defaultProfileId,
  onCreate,
  onUpdate,
  onDuplicate,
  onDelete,
  onSetDefault,
  onClose,
}: SmartRandomProfilesScreenProps) {
  const [editingProfileId, setEditingProfileId] = useState<string | "new" | null>(
    null
  );
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);

  const editingProfile =
    editingProfileId && editingProfileId !== "new"
      ? profiles.find((profile) => profile.id === editingProfileId)
      : undefined;

  function handleSaveForm(value: SmartRandomProfileFormValue) {
    if (editingProfileId && editingProfileId !== "new") {
      onUpdate(editingProfileId, value);
    } else {
      onCreate(value);
    }
    setEditingProfileId(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">
            Smart Random Profiles
          </h2>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Smart Random Profiles"
            className="rounded-lg px-2 py-1 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            Close
          </button>
        </div>

        <p className="mt-2 text-sm text-slate-600">
          Save reusable Smart Random ranges you can select instead of
          re-entering them for every Variable Weight or Blind Weight exercise.
        </p>

        {profiles.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-100 p-4 text-sm text-slate-600">
            No profiles saved yet. Create one to reuse it wherever Smart Random
            is configured.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200">
            {profiles.map((profile) => {
              const isDefault = profile.id === defaultProfileId;

              return (
                <li key={profile.id} className="bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">{profile.name}</p>
                      <p className="mt-0.5 text-sm text-slate-600">
                        {profile.min.toFixed(2)}s–{profile.max.toFixed(2)}s ·{" "}
                        {measurementModeLabel(profile.measurementMode)}
                      </p>
                    </div>

                    {isDefault && (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        Default
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onSetDefault(isDefault ? null : profile.id)}
                      className="min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                    >
                      {isDefault ? "Remove Default" : "Set as Default"}
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditingProfileId(profile.id)}
                      className="min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => onDuplicate(profile.id)}
                      className="min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                    >
                      Duplicate
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeletingProfileId(profile.id)}
                      className="min-h-11 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <button
          type="button"
          onClick={() => setEditingProfileId("new")}
          className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
        >
          New Profile
        </button>
      </div>

      {editingProfileId && (
        <SmartRandomProfileForm
          initialProfile={editingProfile}
          onSave={handleSaveForm}
          onCancel={() => setEditingProfileId(null)}
        />
      )}

      {deletingProfileId && (
        <ConfirmModal
          title="Delete Profile?"
          message="This profile will be removed. Training Blocks, Training Plan Steps, and Sessions that already used its range keep that range unchanged."
          confirmLabel="Delete Profile"
          isDanger
          onCancel={() => setDeletingProfileId(null)}
          onConfirm={() => {
            onDelete(deletingProfileId);
            setDeletingProfileId(null);
          }}
        />
      )}
    </div>
  );
}
