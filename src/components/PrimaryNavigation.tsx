"use client";

import {
  getVisibleNavigationItems,
  type ActiveView,
  type NavigationItem,
} from "../lib/navigation";

type PrimaryNavigationProps = {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
};

const items = getVisibleNavigationItems();

/**
 * The one platform-wide navigation surface: a static top bar on desktop, a
 * fixed bottom bar on mobile (same items, same order, same active state) —
 * see docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md and docs/DESIGN_SYSTEM.md.
 * Hidden items (none today — Assess became active in Phase B) are filtered
 * out by getVisibleNavigationItems and never reach this component. The two
 * bars carry distinct data-testid hooks
 * (rather than relying on Playwright's default single-match behavior) since
 * both exist in the DOM at once — only their CSS visibility differs by
 * viewport — and this suite's default project viewport is mobile-sized.
 */
export default function PrimaryNavigation({
  activeView,
  onNavigate,
}: PrimaryNavigationProps) {
  return (
    <nav aria-label="Primary">
      {/* Desktop / tablet: inline bar, part of normal document flow. */}
      <div
        data-testid="primary-nav-desktop"
        className="hidden gap-2 rounded-2xl bg-white p-2 shadow-lg sm:grid sm:grid-cols-5"
      >
        {items.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={activeView === item.id}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      {/* Mobile: fixed floating pill, inset from both side edges and
          elevated above the device edge/Home Indicator rather than five
          buttons flush to the screen edge (see DESIGN_SYSTEM.md's
          "Preferred Mobile Navigation Surface"). Sits below any modal/
          bottom-sheet layer (InfoButton's mobile sheet uses z-50/backdrop z-40). */}
      <div
        data-testid="primary-nav-mobile"
        className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 grid grid-cols-5 gap-1 rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-lg backdrop-blur sm:hidden"
      >
        {items.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={activeView === item.id}
            onNavigate={onNavigate}
            compact
          />
        ))}
      </div>
    </nav>
  );
}

function NavButton({
  item,
  isActive,
  onNavigate,
  compact = false,
}: {
  item: NavigationItem;
  isActive: boolean;
  onNavigate: (view: ActiveView) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      aria-current={isActive ? "page" : undefined}
      onClick={() => onNavigate(item.id as ActiveView)}
      className={`flex min-h-11 items-center justify-center rounded-xl font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 ${
        compact ? "px-2 py-2 text-xs" : "px-4 py-3 text-sm"
      } ${
        isActive
          ? "bg-slate-900 text-white"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {item.label}
    </button>
  );
}
