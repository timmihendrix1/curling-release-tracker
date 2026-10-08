"use client";

import type { FileExportStatus } from "./useFileExport";

/**
 * The one visible result of an export attempt.
 *
 * Follows the inline `role="status"` pill this application already uses for
 * transient feedback, so an export reports itself the same way everything else
 * does. A failure is visible and the button stays available, which is what
 * makes retry possible without a dialog.
 */
export default function FileExportStatusNotice({ status }: { status: FileExportStatus }) {
  if (status.state === "idle") return null;

  if (status.state === "working") {
    return (
      <p role="status" className="mt-2 rounded-xl bg-slate-100 p-3 text-xs text-slate-700">
        Preparing export…
      </p>
    );
  }

  return (
    <p
      role="status"
      className={
        status.tone === "error"
          ? "mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800"
          : "mt-2 rounded-xl bg-slate-100 p-3 text-xs text-slate-700"
      }
    >
      {status.message}
    </p>
  );
}
