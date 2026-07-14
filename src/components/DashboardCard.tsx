"use client";

import type { AnalyticsExplanation } from "../lib/analyticsExplanations";
import InfoButton from "./InfoButton";

type DashboardCardProps = {
  label: string;
  value: string;
  // Small secondary line under the value, e.g. a tendency label or the
  // threshold a rate is measured against. Omitted entirely if not passed —
  // no layout change for any existing call site.
  sublabel?: string;
  // "highlight" is for the small set of metrics a screen wants to visually
  // prioritize (see docs/DOMAIN_GLOSSARY.md's Dashboard metrics ordering).
  // Defaults to the original, unchanged appearance.
  tone?: "default" | "highlight";
  /** Full interpretation content, shown via an Info button next to the label. */
  explanation?: AnalyticsExplanation;
};

export default function DashboardCard({
  label,
  value,
  sublabel,
  tone = "default",
  explanation,
}: DashboardCardProps) {
  const isHighlight = tone === "highlight";

  return (
    <div
      className={`rounded-xl p-4 ${isHighlight ? "bg-slate-900" : "bg-slate-100"}`}
    >
      <header
        className={`flex items-center text-sm ${isHighlight ? "text-slate-300" : "text-slate-500"}`}
      >
        <p>{label}</p>
        {explanation && <InfoButton explanation={explanation} />}
      </header>

      <p
        className={`mt-1 text-xl font-semibold ${isHighlight ? "text-white" : "text-slate-900"}`}
      >
        {value}
      </p>

      {sublabel && (
        <p
          className={`mt-1 text-xs ${isHighlight ? "text-slate-300" : "text-slate-500"}`}
        >
          {sublabel}
        </p>
      )}
    </div>
  );
}
