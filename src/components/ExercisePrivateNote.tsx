import { useId, useState } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  prominent: boolean;
  onBackToRecording?: () => void;
  onOpenChange?: (open: boolean) => void;
};

/** Native disclosure keeps the editor mounted and never creates another save step. */
export default function ExercisePrivateNote({ value, onChange, disabled, prominent, onBackToRecording, onOpenChange }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const editor = (
    <div className="space-y-3">
      <label className={prominent ? "house-flow-section-title" : "sr-only"} htmlFor={id}>Private athlete note</label>
      <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}
        rows={prominent ? 3 : 2} className="house-note-editor" placeholder="Add your observation…" />
      <p className="text-xs text-slate-500">Only you can read or edit this note. It is not shared with a Team or coach.</p>
      {!prominent && onBackToRecording && (
        <button type="button" className="house-flow-primary" onClick={() => { setOpen(false); onOpenChange?.(false); onBackToRecording(); }}>
          Back to recording
        </button>
      )}
    </div>
  );
  if (prominent) return <section>{editor}</section>;
  return (
    <details open={open} onToggle={(event) => { setOpen(event.currentTarget.open); onOpenChange?.(event.currentTarget.open); }} className="house-training-disclosure house-private-note">
      <summary>Private athlete note{value.trim() && <span className="ml-2 text-xs font-normal text-slate-500">· Added</span>}
        {open && <span className="ml-auto text-sm text-[var(--house-accent)]">Done</span>}
      </summary>
      {editor}
    </details>
  );
}
