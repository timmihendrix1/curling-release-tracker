import FutureCapabilityItem from "./FutureCapabilityItem";

const FUTURE_CAPABILITIES = [
  { title: "Schedule", description: "Plan and repeat training sessions." },
  { title: "Coach", description: "Assigned training and feedback." },
  { title: "Team", description: "Shared training and performance." },
] as const;

/**
 * Home's grouped, visually secondary preview of platform capabilities that
 * exist in the product vision but not in this slice (Schedule, Coach, Team).
 * One shared, dashed-border container — not three separate cards — so future
 * modules never outweigh Today's Plan or Training Overview, and never read
 * as three fragmented, individually-boxed tiles on narrow mobile widths.
 * Rows stack vertically (divided by a subtle line) below the `sm` breakpoint
 * and become three columns (divided by a vertical line) at `sm` and above —
 * the same shared container either way, no separate mobile/desktop
 * components. See docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md.
 */
export default function FutureCapabilitiesSection() {
  return (
    <div className="space-y-2">
      <h2 className="px-1 text-sm font-semibold text-slate-500">
        Coming next
      </h2>

      <div className="divide-y divide-slate-200 rounded-xl border border-dashed border-slate-300 bg-slate-50 sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {FUTURE_CAPABILITIES.map((capability) => (
          <FutureCapabilityItem
            key={capability.title}
            title={capability.title}
            description={capability.description}
          />
        ))}
      </div>
    </div>
  );
}
