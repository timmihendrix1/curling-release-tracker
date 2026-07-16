# Design System

## Purpose

This document defines the visual and interaction principles of the application.

Its goal is consistency, clarity and speed.

The interface should help athletes focus on training and analysis rather than navigating the software.

This document complements:

- PRODUCT_DIRECTION_AND_[PRINCIPLES.md](http://PRINCIPLES.md)

- SYSTEM_[ARCHITECTURE.md](http://ARCHITECTURE.md)

- UX_WRITING_[GUIDELINES.md](http://GUIDELINES.md)

---

# Core Principles

## Mobile first

The primary platform is a mobile phone used beside the curling sheet.

Every screen must remain fully usable on a small display.

Desktop is an enhancement, not the primary design target.

---

## Minimise interaction

Training should never be interrupted by the application.

Every unnecessary tap or decision reduces training flow.

Before introducing any interaction, ask:

&gt; Does this make training better or only the software more flexible?

---

## Data before decoration

The application exists to support better decisions.

Visual elements should highlight information rather than decorate the interface.

Avoid visual noise.

---

## Progressive disclosure

Show the most important information first.

Advanced information should appear only when needed.

Hierarchy:

1. Essential

2. Useful

3. Detailed

Never overwhelm the user.

---

## Consistency over novelty

Similar information should always look and behave similarly.

Users should not have to relearn patterns.

---

# Layout

## Information hierarchy

Every screen should follow this structure whenever applicable.

1. Current context

2. Primary action

3. Immediate feedback

4. Analytics

5. Details

6. Configuration

---

## Sections

Different responsibilities belong in different visual sections.

Typical sections:

- Context

- Input

- Dashboard

- Charts

- Details

- History

- Settings

Each section should have a clear visual boundary.

---

## Vertical rhythm

Prefer consistent spacing throughout the application.

Avoid dense layouts.

Whitespace improves readability.

---

# Cards

Cards are the primary building block.

Every card should have:

- clear title

- optional subtitle

- optional Info button

- body

- optional footer

Cards should never contain unrelated functionality.

---

## Dashboard Cards

Dashboard cards display one important metric.

Each card should contain:

- title

- value

- optional trend

- optional Info button

Do not overload cards with secondary information.

---

## Chart Cards

Every chart card should contain:

- title

- subtitle

- Info button

- chart

- contextual notices (when needed)

Charts should never appear without context.

---

## Filter Cards

Filters belong together.

Primary filters should remain visible.

Secondary filters may be collapsed.

---

# Navigation

Navigation should remain simple.

Users should always understand:

- where they are

- what they are analysing

- how to return

**Implemented:** `PrimaryNavigation.tsx` — one component, two renderings of the same
config-driven item list (`src/lib/navigation.ts`): a static top bar on desktop/tablet, a
fixed bottom bar on mobile (safe-area aware). The active item always carries
`aria-current="page"`. All five items (Home, Train, Assess, Analyze, Settings) are
active as of the Release Time Core Assessment v1 execution flow (Phase B); a hidden
item (`availability: "hidden"`) would still never reach this component if one existed.

## Future Capability Items

A reusable pattern for a platform capability that's described in the product vision but
doesn't exist yet (Home's Schedule, Coach, Team). **Implemented:**
`FutureCapabilityItem.tsx` — a title, a small "Coming soon" pill (kept on the same line
as the title, never wrapping to its own row), and a one-sentence description. Never
interactive (no button, no click handler, never focusable) and always visually secondary
(muted colors, no border/background of its own) to whatever real functionality is on the
same screen.

`FutureCapabilitiesSection.tsx` wraps every item in **one shared, dashed-border
container** under a single "Coming next" heading — not three individually-boxed cards.
Below the `sm` breakpoint, items stack as rows separated by a subtle divider line; at
`sm` and above, the same container becomes a three-column grid with vertical dividers.
This distinction matters: three separately-bordered boxes read as fragmented even when
stacked vertically, while one shared container with internal dividers reads as a single,
quieter section — keeping future platform capabilities visually secondary to Today's Plan
and Training Overview. See "Empty States" below for the related but distinct case of a
real feature with no data yet.

---

# Sticky Elements

Sticky UI should only be used when it reduces unnecessary scrolling.

Current examples:

- History filters

Avoid multiple competing sticky areas.

---

# Buttons

Buttons should communicate priority.

Hierarchy:

Primary

Used for the main action.

Secondary

Used for supporting actions.

Danger

Used only for destructive actions.

Avoid multiple primary buttons in the same section.

---

# Forms

Keep forms short.

Only request information that is required.

Show validation close to the relevant field.

Never rely on alert dialogs.

---

# Charts

Charts should answer questions.

Every chart should answer exactly one primary question.

If a chart answers multiple unrelated questions, split it.

---

## Reference lines

Reference lines should always be clearly explained.

Examples:

- Zero line

- Perfect match line

---

## Colour usage

Colour should support interpretation.

It should never be the only way to distinguish information.

Always combine colour with:

- labels

- markers

- icons

- patterns

---

## Empty charts

Never show an empty chart without explanation.

Instead explain:

- why no data is shown

- what the athlete needs to do

---

# Tables and Lists

Lists should prioritise scanning.

Important values should be immediately visible.

Avoid large dense tables on mobile.

---

# Icons

Icons support text.

They should never replace text completely.

Info icons should behave consistently throughout the application.

---

# Typography

Typography should create hierarchy.

Prefer:

Title

↓

Subtitle

↓

Body

↓

Supporting text

Avoid large blocks of text.

---

# Feedback

The application should always communicate:

- successful actions

- failed actions

- loading states

- unavailable features

Users should never wonder whether an action succeeded.

---

# Empty States

Every empty state should answer:

- Why is this empty?

- What should I do next?

Example:

Train at least one Variable Weight block to see this chart.

---

# Responsive Behaviour

The application should work comfortably on:

- phones

- tablets

- desktop browsers

Content should reflow vertically before horizontal scrolling is introduced.

Horizontal scrolling should generally be avoided.

---

# Accessibility

Interfaces should remain usable for all users.

Consider:

- keyboard navigation

- screen readers

- colour vision deficiencies

- touch interaction

- sufficient contrast

Accessibility should be part of every feature, not an afterthought.

---

# Future Components

New reusable components should follow existing patterns whenever possible.

Avoid introducing visually different components when an existing one can be extended.

## Assessment patterns (Implemented, Phase B and Phase C)

See `docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md` for the Assessment product
model these support, and `docs/SYSTEM_ARCHITECTURE.md`'s "Assessments" section for the
implementation snapshot. Implemented components (`src/components/Assessment*.tsx`):

- **`AssessmentSetupDiagram`** — a plain, provider-neutral inline SVG (hack, delivery
  direction, backline/Gate 1, hogline/Gate 2, stone path, measured segment
  highlighted). No manufacturer branding, no external asset.
- **`AssessmentProtocolSheet`** — the permanent "full protocol" overlay (purpose,
  blocks, warm-up sequence, setup, invalid-attempt/wrong-handle rules, pause/abandon
  rules), reachable from Overview, execution, and the Completion Summary — the
  Assessment-domain counterpart to `InfoButton`'s content sheets, but standalone since
  it needs to be triggered from multiple, unrelated screens.
- **`AssessmentProgress`** — a labeled progress bar with real `aria-valuenow`/
  `-valuemin`/`-valuemax` semantics, reused for warm-up, per-block, and overall (x of
  32) progress alike.
- **`AssessmentCurrentShot`** — target/handle/phase display plus the Executed Handle
  toggle (defaults to Expected Handle) and the most recent result, including the
  wrong-handle Protocol Deviation notice.
- **`AssessmentThresholdSelector`** / **`AssessmentSetupConfirmation`** — the
  threshold-preset and setup-confirmation sections shown on Overview before a Run can
  start.
- **`AssessmentInvalidAttemptDialog`** / **`AssessmentBlockTransition`** /
  **`AssessmentPausedView`** / **`AssessmentCompletionSummary`** — the remaining
  execution-lifecycle screens, each a single-purpose card following the same visual
  language (rounded-2xl white cards, `shadow-lg`) as the rest of the app.

Phase C added the Assessment Result Screen and its own component family
(`src/components/Assessment*.tsx`, see `docs/SYSTEM_ARCHITECTURE.md`'s "Assessments"
section for the full list) — `AssessmentResultScreen`, `AssessmentResultSummary`,
`AssessmentThresholdControl` (the Result-screen counterpart to
`AssessmentThresholdSelector`, with an added "Original" option and, in multi-run
contexts, `allowOriginal={false}`), `AssessmentCoreMetrics`, `AssessmentBlockResults`,
`AssessmentTargetResults`, `AssessmentHandleComparison`, `AssessmentVariableAdaptationResults`,
`AssessmentProtocolIntegrity`, `AssessmentShotDetails`, `AssessmentComparisonEligibilityNotice`
(maps `ComparisonIneligibilityReason` to plain-language copy — never a raw enum value),
`AssessmentRunComparison`, `AssessmentTrendChart`, `AssessmentAnalyze`, and
`AssessmentHistoryItem`. All follow the same visual language (rounded-2xl white cards,
`shadow-lg`, compact card/small-multiple breakdowns rather than dense tables on mobile)
and reuse `ChartCard`/`DashboardCard`/`InfoButton`/`chartTheme.ts` rather than
introducing parallel chart chrome.

---

# Design Review Checklist

Before completing a feature, verify:

- Is the primary action obvious?

- Is the current context clear?

- Is the screen understandable without explanation?

- Is information prioritised correctly?

- Does this match existing components?

- Does it work on mobile?

- Does it avoid unnecessary interaction?

- Does it improve training rather than software complexity?