// Central configuration for the platform's top-level navigation. See
// docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md and docs/adr/0009 for the
// long-term navigation model (Home / Train / Assess / Analyze / Settings) and
// why this app uses an in-memory view-state model rather than Next.js routes.
//
// Assess became a real, active navigation item in Phase B (see
// docs/adr/0011-assessment-execution-shares-the-app-shells-capture-navigation-guard-and-persistence-patterns.md)
// once a functional Release Time Core Assessment v1 flow existed to render —
// flipping `availability` here plus adding the "assess" ActiveView value was
// the entire navigation-side change; PrimaryNavigation needed no changes.
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
  { id: "assess", label: "Assess", availability: "active" },
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
