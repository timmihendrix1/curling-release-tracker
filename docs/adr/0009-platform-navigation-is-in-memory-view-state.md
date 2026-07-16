# ADR-0009: Platform navigation is an in-memory view-state, not Next.js routes; leaving Train is the one guarded transition; Home is not persisted

## Status

Accepted. Implemented for Home/Train/Analyze/Settings — see
`docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md` for the product-level navigation model
this implements, and `docs/TECHNICAL_DEBT_AND_ROADMAP.md` for what's intentionally not
built yet (Assess as a real screen, scheduling data).

## Context

The app introduced a real top-level navigation (Home / Train / Analyze / Settings, with
Assess reserved for later) on top of what was previously a single client component
(`TrackerApp.tsx`) toggling between exactly two views ("current session" / "history")
via one `useState<"current" | "history">`. Three decisions had to be made that the
product doc (`PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md`) specifies the *model* for but
not the *mechanism*:

1. Should the four/five sections be real Next.js routes (`/train`, `/analyze`, ...) or
   stay an in-memory view-state switch?
2. What happens to an in-progress Blind Weight draft or a running/paused Auto Capture
   Sequence when the user taps a different top-level section?
3. Does the active section persist across a reload, and if so, how does an invalid/stale
   persisted value get handled?

## Decision

### 1. In-memory `ActiveView` state, not routing

The app stays a single client-rendered page (`src/app/page.tsx` → `TrackerApp`) with one
`activeView: ActiveView` state value, now driven by a central nav config
(`src/lib/navigation.ts`) instead of two hardcoded buttons. **No Next.js routes were
introduced.**

Why: there is exactly one route today (`/`), no deep-linking requirement, no
server-rendered content that would benefit from routes, and all state driving the four
screens (current session, session history, filters) is process-local, `localStorage`-
backed, and already read/derived in one place (`TrackerApp`). Introducing routes would
mean either (a) duplicating that state-loading logic per route, or (b) keeping a shared
layout/provider anyway and using routes as a thin wrapper around the same view-switch —
neither reduces real complexity today, and Next's App Router has meaningfully different
navigation/data-loading semantics that this project isn't otherwise using. This is a
"not yet" decision, not a "never": if Assess or a future module genuinely needs its own
URL (shareable link, browser back/forward between sections, server data per section),
routing is the natural next step, and the navigation config (`NavigationItem` with an
`id` per section) was deliberately kept independent of *how* a section is reached so that
migration wouldn't require redesigning the nav model itself.

### 2. Only leaving Train while work is unsaved is guarded — and it now applies to every top-level destination, not just one

Before this change, the Blind-draft-leave guard and the Capture-Sequence-leave guard
(`runOrConfirmBlindDraftDiscard`, `runOrConfirmCaptureLeave`, composed by
`guardLeavingActiveWork` — see ADR-0006/0007 for the Capture Sequence side) gated exactly
one button ("History"). `handleNavigate`, the one function `PrimaryNavigation` calls now,
applies the same composed guard whenever `activeView === "train"` and the destination is
anything else (Home, Analyze, or Settings) — navigating *into* Train, or moving between
Home/Analyze/Settings, is never guarded, since Session state itself is unaffected by
which screen currently renders it (it lives in `currentSession`/`localStorage`
regardless).

This reuses the existing guard mechanism and its existing semantics unchanged (confirming
still ends an active Capture Sequence, exactly as it always did leaving for History) — the
only change is *which navigations* route through it. No new "leave confirmation" concept
was invented for Home/Analyze/Settings specifically.

### 3. Home is the default view on load and is not persisted — except when a Capture Sequence is active

`activeView` is **not** written to `localStorage`. A normal reload always starts on Home.
Reasoning:

- Nothing about Session or Capture correctness depends on which screen is shown first —
  both are loaded, migrated, and rendered correctly from whichever screen the user
  navigates to.
- Home is meant to be the daily entry point ("what's relevant today"), not a resume point
  for whatever the user happened to be looking at last. Persisting the last tab would
  mean reopening the app days later can drop the user back into a stale Analyze filter
  view instead of the current, always-relevant Home screen.
- One fewer `localStorage` key and one fewer "what if the persisted value is now invalid"
  migration path to maintain (`sanitizeActiveView`/`isActiveView` exist and are unit
  tested in `src/lib/__tests__/navigation.test.ts`, ready to use the moment persistence is
  ever added, but nothing currently calls them from `TrackerApp`).

The one exception: if the session loaded from `localStorage` has an active Capture
Sequence (`isCaptureSequenceActive` — status `"ready"`, `"running"`, or `"paused"`), the
initial view is `"train"` instead of `"home"`. This is the "active training situation that
requires a different, safer flow" the product doc allows for — a sequence that survived
reload as `"paused"` (see ADR-0007's "Persistence and reload") is real, live progress; showing
it immediately (rather than behind an extra tap through Home) costs nothing and avoids
the appearance that in-progress work vanished. No other state (a Blind Weight draft, for
instance) survives a reload at all — it's ephemeral component state, not persisted — so
there is nothing else to special-case.

## Consequences

- Adding Assess as a real screen later is: flip its `availability` in
  `NAVIGATION_ITEMS`, add an `"assess"` `ActiveView` value and its screen component — not
  a navigation, layout, or state-model rewrite.
- `PrimaryNavigation` is the only thing that calls `setActiveView`; no navigation state is
  duplicated across components.
- Every pre-existing e2e test that asserted on the old "Current Session"/"History" button
  labels or assumed the Setup screen was the very first thing shown after a fresh load
  needed updating (see `tests/e2e/utils.ts`'s `freshLoad`/`goToTrain`/`goToAnalyze`/
  `goToSettings` helpers) — this was mechanical (label + one extra navigation step), not a
  behavior change to the flows themselves.
- **Known limitation, not solved by this pass:** there is no URL for any section, so a
  user cannot bookmark or share a link to Analyze/Settings, and browser back/forward does
  nothing useful within the app. Acceptable for this slice's scope (see
  `docs/TECHNICAL_DEBT_AND_ROADMAP.md`); revisit if/when a section needs to be
  deep-linkable.
