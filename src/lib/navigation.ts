// Primary navigation: Home / Train / Analyze / Settings. Assessments is reached
// within Train; its internal view and shared leaving-active-work guards remain intact.
// See docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md (House refinement, 2026-10-09).
export type NavigationItemId =
  | "home"
  | "train"
  | "assess"
  | "analyze"
  | "settings";

export type NavigationAvailability = "active" | "hidden";

export type NavigationItem = {
  id: NavigationItemId;
  label: string;
  availability: NavigationAvailability;
};

export const NAVIGATION_ITEMS: NavigationItem[] = [
  { id: "home", label: "Home", availability: "active" },
  { id: "train", label: "Train", availability: "active" },
  { id: "assess", label: "Assess", availability: "hidden" },
  { id: "analyze", label: "Analyze", availability: "active" },
  { id: "settings", label: "Settings", availability: "active" },
];

export function getVisibleNavigationItems(): NavigationItem[] {
  return NAVIGATION_ITEMS.filter((item) => item.availability === "active");
}

// The set of navigation ids TrackerApp actually knows how to render a screen
// for. Kept separate from NavigationItemId so a future "assess" screen is a
// type-level addition here, not a rename of the existing union.
export type ActiveView = "home" | "train" | "assess" | "analyze" | "settings";

const ACTIVE_VIEWS: readonly ActiveView[] = [
  "home",
  "train",
  "assess",
  "analyze",
  "settings",
];

export const DEFAULT_ACTIVE_VIEW: ActiveView = "home";

export function isActiveView(value: unknown): value is ActiveView {
  return (
    typeof value === "string" &&
    (ACTIVE_VIEWS as readonly string[]).includes(value)
  );
}

/** Resolves any persisted/unknown value to a valid ActiveView, defaulting to
 * Home — never throws, never silently renders a blank screen for a stale or
 * corrupted value (e.g. an old "current"/"history" value, or a future
 * "assess" value persisted by a newer build being opened by this one). */
export function sanitizeActiveView(value: unknown): ActiveView {
  return isActiveView(value) ? value : DEFAULT_ACTIVE_VIEW;
}
