/**
 * The full "Curling Performance" product identity — rendered by TrackerApp
 * only when activeView is "home" (see DESIGN_SYSTEM.md §9.1/§32 Priority 2).
 * Functional screens (Train/Assess/Analyze/Settings) use PageHeader's compact
 * contextual header instead, so this large product title is never repeated
 * as a card on every screen. "Curling Performance" is a provisional,
 * visible-only product name — not a final branding decision, and not
 * reflected in package/PWA metadata or export files. The subtitle only names
 * capabilities that are actually available today — Assess joined Train and
 * Analyze here once the Release Time Core Assessment v1 execution flow
 * (Phase B) made it a real, usable capability, not before.
 */
export default function AppHeader() {
  return (
    <div className="mb-3 rounded-2xl bg-white px-4 py-3 shadow-lg sm:px-5">
      <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">
        Curling Performance
      </h1>
      <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">
        Train, assess and understand your performance.
      </p>
    </div>
  );
}
