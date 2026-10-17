"use client";

import {
  getVisibleNavigationItems,
  type ActiveView,
  type NavigationItem,
} from "../lib/navigation";
import NavigationIcon from "./NavigationIcon";

type PrimaryNavigationProps = {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
};

const items = getVisibleNavigationItems();

/**
 * The one platform-wide navigation surface: a static top bar on desktop, a
 * fixed bottom bar on mobile (same items, same order, same active state) —
 * see docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md and docs/DESIGN_SYSTEM.md.
 * Assess is nested under Train; hidden primary items are filtered
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
        className="house-nav hidden gap-1 rounded-3xl bg-white p-1.5 sm:grid sm:grid-cols-4"
      >
        {items.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={activeView === item.id || (activeView === "assess" && item.id === "train")}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      {/* Mobile: fixed floating pill, inset from both side edges and
          elevated above the device edge/Home Indicator rather than a row of
          buttons flush to the screen edge (see DESIGN_SYSTEM.md's
          "Preferred Mobile Navigation Surface"). Sits below any modal/
          bottom-sheet layer (InfoButton's mobile sheet uses z-50/backdrop z-40). */}
      <div
        data-testid="primary-nav-mobile"
        className="house-nav fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mx-auto grid max-w-md grid-cols-4 gap-0.5 rounded-3xl bg-white p-1 sm:hidden"
      >
        {items.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={activeView === item.id || (activeView === "assess" && item.id === "train")}
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
      className={`flex min-h-11 min-w-0 items-center justify-center rounded-[1.25rem] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--house-accent)] focus-visible:ring-offset-2 ${
        compact ? "flex-col gap-1 px-0.5 py-2 text-[10px] leading-4" : "gap-2 px-2 py-3 text-sm"
      } ${
        isActive
          ? "house-nav-active"
          : "house-nav-inactive"
      }`}
    >
      <NavigationIcon view={item.id as ActiveView} />
      <span>{item.label}</span>
    </button>
  );
}
