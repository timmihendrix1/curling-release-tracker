import FutureCapabilityItem from "./FutureCapabilityItem";

const FUTURE_CAPABILITIES = [
  { title: "Schedule", description: "Plan and repeat training sessions." },
  { title: "Coach", description: "Assigned training and feedback." },
] as const;

/**
 * Keeps the implemented Team capability distinct from future Schedule and
 * Coach work, so Home never labels working functionality as "Coming soon".
 * One shared, dashed-border container — not three separate cards — so future
 * modules never outweigh Today's Plan or Training Overview, and never read
 * as three fragmented, individually-boxed tiles on narrow mobile widths.
 * Future rows stack vertically (divided by a subtle line) below the `sm`
 * breakpoint and become two columns (divided by a vertical line) at `sm` and above —
 * the same shared container either way, no separate mobile/desktop
 * components. See docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md.
 */
export default function FutureCapabilitiesSection({
  onManageTeams,
}: {
  onManageTeams(): void;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Available now
        </p>
        <div className="mt-1 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Teams</h2>
            <p className="mt-1 text-xs text-slate-600">
              Create a Team, invite athletes and manage shared training access.
            </p>
          </div>
          <button
            type="button"
            onClick={onManageTeams}
            className="min-h-11 shrink-0 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            Manage
          </button>
        </div>
      </section>

      <div className="space-y-2">
        <h2 className="px-1 text-sm font-semibold text-slate-500">
          Coming next
        </h2>

        <div className="divide-y divide-slate-200 rounded-xl border border-dashed border-slate-300 bg-slate-50 sm:grid sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          {FUTURE_CAPABILITIES.map((capability) => (
            <FutureCapabilityItem
              key={capability.title}
              title={capability.title}
              description={capability.description}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
