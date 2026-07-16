type FutureCapabilityItemProps = {
  title: string;
  description: string;
};

/**
 * One row inside FutureCapabilitiesSection's shared "Coming next" container —
 * a platform capability described in the product vision but not built yet
 * (Schedule, Coach, Team). Never interactive (no button, no link, no click
 * handler) and never focusable, so it can never be mistaken for a working
 * feature. Renders no border or background of its own — the section around
 * it is the one shared container, so three of these never read as three
 * separate cards, even stacked on narrow mobile widths. Title and the
 * "Coming soon" badge sit in a non-wrapping row so the badge never breaks
 * onto its own line. See docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md and
 * docs/DESIGN_SYSTEM.md's "Future Capability Items".
 */
export default function FutureCapabilityItem({
  title,
  description,
}: FutureCapabilityItemProps) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-600">{title}</h3>
        <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Coming soon
        </span>
      </div>

      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>
  );
}
