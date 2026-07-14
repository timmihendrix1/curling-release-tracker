"use client";

import type { ReactNode } from "react";
import type { AnalyticsExplanation } from "../lib/analyticsExplanations";
import InfoButton from "./InfoButton";

type ChartCardProps = {
  title: string;
  /** Short line naming the training question this chart answers. */
  subtitle?: string;
  /** Full interpretation content, shown via the title's Info button. */
  explanation?: AnalyticsExplanation;
  /**
   * Short, context-specific notices (small sample, single handle available,
   * thresholds vary, ...) — shown between the subtitle and the chart itself.
   * Keep this list short; this project deliberately avoids warning overload.
   */
  notices?: string[];
  isEmpty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
};

/**
 * Shared chart shell — title (+ optional Info popover), subtitle (the
 * training question answered), contextual notices, and a consistent empty
 * state — so no chart component reinvents its own card chrome, help text, or
 * empty-state copy.
 */
export default function ChartCard({
  title,
  subtitle,
  explanation,
  notices,
  isEmpty = false,
  emptyMessage = "Not enough shots yet.",
  children,
}: ChartCardProps) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-lg">
      {/* A <header>, not a <div> — several existing tests scope a card by
          "the innermost div containing this title", and a <div> wrapper here
          would shadow that with a title-only div that doesn't contain the
          chart itself. */}
      <header className="flex items-center">
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        {explanation && <InfoButton explanation={explanation} />}
      </header>

      {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}

      {notices && notices.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-slate-500">
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}

      {isEmpty ? (
        <p className="mt-4 text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="mt-4">{children}</div>
      )}
    </div>
  );
}
