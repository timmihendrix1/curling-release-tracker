"use client";

import { useEffect, useId, useRef } from "react";

type ConfirmModalProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isDanger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { previous?.focus(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-describedby={descriptionId}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onCancel(); }
          if (event.key !== "Tab") return;
          const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button");
          if (!buttons?.length) return;
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
        aria-modal="true"
        aria-labelledby={titleId}
        className="house-confirm max-h-[calc(100dvh-3rem)] overflow-y-auto w-full max-w-sm rounded-[2rem] bg-white p-6 shadow-2xl"
      >
        <h2 id={titleId} className="text-2xl font-medium tracking-tight text-[var(--house-ink)]">{title}</h2>

        <p id={descriptionId} className="mt-3 text-sm leading-6 text-slate-600">{message}</p>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-2xl bg-[var(--house-tint)] px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-200"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-2xl px-4 py-3 font-medium text-white transition ${
              isDanger
                ? "bg-red-600 hover:bg-red-700"
                : "bg-[var(--house-deep)] hover:bg-[var(--house-accent)]"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
