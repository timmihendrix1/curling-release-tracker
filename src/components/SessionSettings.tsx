"use client";

type SessionSettingsProps = {
  title: string;
  notes?: string;
  onChangeTitle: (title: string) => void;
  onChangeNotes: (notes: string) => void;
};

export default function SessionSettings({
  title,
  notes = "",
  onChangeTitle,
  onChangeNotes,
}: SessionSettingsProps) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-lg">
      <h2 className="text-xl font-semibold text-slate-900">
        Session Details
      </h2>

      <div className="mt-4 space-y-4">
        <div>
          <label className="text-sm font-medium text-slate-700">
            Session Name
          </label>

          <input
            type="text"
            value={title}
            onChange={(event) => onChangeTitle(event.target.value)}
            placeholder="e.g. Draw Training"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700">
            Notes
          </label>

          <textarea
            value={notes}
            onChange={(event) => onChangeNotes(event.target.value)}
            placeholder="e.g. slow ice, focus on In Handle..."
            rows={3}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400"
          />
        </div>
      </div>
    </div>
  );
}