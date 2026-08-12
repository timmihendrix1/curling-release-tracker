"use client";

import { surfaceClass } from "./Surface";

type SessionSettingsProps = {
  title: string;
  notes?: string;
  onChangeTitle: (title: string) => void;
  onChangeNotes: (notes: string) => void;
  /**
   * "card" (default) is the standalone Session setup card shown before a
   * block exists. "bare" strips the outer surface for use inside another
   * container — e.g. the collapsible Edit Details section shown during
   * active Training (DESIGN_SYSTEM.md §19.6) — so it never nests a card
   * inside a card.
   */
  variant?: "card" | "bare";
  /**
   * True while the Session domain isn't "ready" (see
   * docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.10) — disables both fields
   * without hiding the currently-displayed values. Defaults to false so
   * existing call sites/tests keep today's always-enabled behavior.
   */
  disabled?: boolean;
};

export default function SessionSettings({
  title,
  notes = "",
  onChangeTitle,
  onChangeNotes,
  variant = "card",
  disabled = false,
}: SessionSettingsProps) {
  return (
    <div className={variant === "card" ? surfaceClass("hero") : ""}>
      {variant === "card" && (
        <h2 className="text-xl font-semibold text-slate-900">
          Session Details
        </h2>
      )}

      <div className={variant === "card" ? "mt-4 space-y-4" : "space-y-4"}>
        <div>
          <label className="text-sm font-medium text-slate-700">
            Session Name
          </label>

          <input
            type="text"
            value={title}
            disabled={disabled}
            onChange={(event) => onChangeTitle(event.target.value)}
            placeholder="e.g. Draw Training"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </div>

        <div>
          {/* Optional and kept visually secondary — smaller/muted label,
              shorter default height — so it never competes with Session
              Name during setup (DESIGN_SYSTEM.md §15.4). */}
          <label className="text-xs font-medium text-slate-500">
            Notes (optional)
          </label>

          <textarea
            value={notes}
            disabled={disabled}
            onChange={(event) => onChangeNotes(event.target.value)}
            placeholder="e.g. slow ice, focus on In Handle..."
            rows={2}
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </div>
      </div>
    </div>
  );
}