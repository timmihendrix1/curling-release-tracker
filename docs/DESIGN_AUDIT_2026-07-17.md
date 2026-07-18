# Design Audit — Pre-Launch Review (2026-07-17)

> This is a point-in-time critical design audit, not a living specification. It was
> conducted as an incoming Principal Product Designer would run a pre-launch review:
> reading the full documentation set, then reviewing every major screen's actual
> implementation against it, without protecting existing decisions simply because they
> shipped. No code was changed in the course of this review. Treat findings as a snapshot
> against the codebase and documentation as they stood on the date above — re-verify
> before acting on anything here after significant changes to either.

**Method:** read every product, IA, visual-identity, mobile-UX, design-system,
UX-writing, coaching, and domain-specification document in `docs/` in full, then
reviewed each screen's actual source implementation against that documentation in
parallel, independent passes — one per screen cluster — before this synthesis was
written across all of them.

**Screens/states reviewed:** 15
**Average rating:** ★★★☆☆ (3.0 / 5)
**Verdict:** Not yet — but closer than it looks.

---

## Ratings at a glance

| Screen / state | Rating | Priority |
|---|---|---|
| Home | ★★★☆☆ | High |
| Train — Setup | ★★☆☆☆ | High |
| Train — New Training Block modal | ★★★☆☆ | Medium |
| Active Training — Manual & Auto Capture | ★★★☆☆ | High |
| Active Training — Blind Weight | ★★★☆☆ | High |
| Assess — Landing | ★★★½☆ | Medium |
| Assess — Guided Introduction | ★★★★☆ | Low |
| Assess — Overview & Setup Confirmation | ★★★☆☆ | High |
| Assess — Scored Execution | ★★★☆☆ | High |
| Assess — Completion Summary | ★★★½☆ | Medium |
| Assessment Result Screen | ★★★☆☆ | Medium |
| Analyze — Assessments | ★★☆☆☆ | Medium-High |
| Analyze — Training Analytics | ★★½☆☆ | High |
| Settings | ★★☆☆☆ | High |
| App Shell — Navigation & Headers | ★★★★☆ | Medium |

---

## Home

**Rating:** ★★★☆☆ · **Priority:** High

**Purpose.** Partially achieved. Home must immediately answer "Do I already have an
active Training or Assessment?" This works for Assessment — `hasActiveAssessmentRun`
correctly surfaces a "Resume Assessment" action (`TodayPlanCard.tsx:38-46`) — but not
for Training. `HomeScreen.tsx:41` computes `currentSessionHasShots` and then discards
it; `TodayPlanCard` shows the static "No scheduled session. Start whenever you're
ready." regardless of whether a Training Block is actually in progress. The button that
resumes that session is still labelled "Start Training." This is the one place Home
tells the athlete something false about their own current state, rather than merely
omitting a nice-to-have.

**Strengths**
- Correct header treatment — Home alone keeps the full `AppHeader` product identity;
  every other view gets the compact `PageHeader` (`TrackerApp.tsx:1509-1515`), exactly
  as Mobile UX §9 and Design System §9.1/9.2 require.
- Genuinely differentiated surface hierarchy: `TodayPlanCard.tsx:24` is the one
  `shadow-lg` hero; `TrainingOverview.tsx:32` and `DeviceStatusCard.tsx:14` step back
  with a plain border; `FutureCapabilitiesSection.tsx:27` correctly uses the dashed
  border reserved for future/unavailable content.
- Card density is restrained — four sections, well under the five-card review
  threshold — and three would-be "coming soon" cards are merged into one with
  dividers (`FutureCapabilitiesSection.tsx:20-38`), matching the Future Capability
  Pattern exactly.
- Copy is honest and near-verbatim to the guidelines: "No scheduled session. / Start
  whenever you're ready." matches UX Writing §27.1's own example; no fabricated
  recommendation, personalised name, or trend appears anywhere
  (`HomeScreen.test.tsx:128-140`).

**Weaknesses**
- `TodayPlanCard.tsx:27-28` shows "No scheduled session" even while a Training Block is
  genuinely active.
- No "Resume Training" affordance exists anywhere in the codebase, though UX Writing
  §27.2 names it explicitly, parallel to the implemented "Resume Assessment."
- `TrainingOverview.tsx:37-49` surfaces "Last Training" and "Total Sessions" only — no
  Assessment fact at all, though §27.3 names "Latest Assessment" directly and Assess is
  now a mature, first-class pillar.
- When an Assessment Run is active, "Resume Assessment" renders as the visually weaker
  secondary button beneath the generic "Start Training" default
  (`TodayPlanCard.tsx:33-45`) — inverting the IA doc's Information Priority ("1.
  Current activity" first).
- `DeviceStatusCard.tsx:15` uses an `h3` while every sibling section uses `h2` — a small
  heading-level inconsistency.

**Violations**
- Information Architecture — Home, "Should Immediately Answer": an active Training
  Block is not answered for.
- Information Architecture — Home, "Information Priority": current activity is
  subordinated to a generic default action.
- UX Writing Guidelines §27.2 / §27.3: "Resume Training" and "Latest Assessment" are
  documented, unimplemented.
- UX Writing Guidelines §9: "Start Training" doesn't describe the result of the action
  when it actually resumes a session.

**Quick wins**
- Thread an active-Training signal into `TodayPlanCard`, add "Resume Training"
  mirroring the existing Assessment pattern.
- Add a "Latest Assessment" fact to `TrainingOverview` from data the persistence layer
  already has.
- Promote "Resume Assessment" to the primary slot when a run is active.
- Normalise `DeviceStatusCard`'s heading to `h2`.

**Major opportunities**
- Replace the two independently-wired booleans (Assessment active, Training active)
  with one shared "Active Work" model, since more active-work types (Coach-assigned,
  Team sessions) are coming.
- Give "Recent Progress" a name and shape that covers both Train and Assess, rather
  than living inside a component still named `TrainingOverview`.

**Estimated user impact.** An athlete who steps away mid-block and returns to Home — an
explicitly frequent scenario per the Interruptions section — sees no sign that work is
waiting and reads copy telling them nothing is scheduled: the opposite of "recover
gracefully."

---

## Train — Setup

**Rating:** ★★☆☆☆ · **Priority:** High

**Purpose.** This is the only pre-execution screen on cold start: `SessionSettings`
stacked directly above `TrainingSetup` (`TrackerApp.tsx:1558-1581`). There is no
genuine confirmation step — pressing "Start Training" both finalises configuration and
immediately begins execution (`TrainingSetup.tsx:627-633`). It answers "What kind of
training am I about to do?" reasonably well, but never confirms "Am I ready to start?"
— the IA doc's explicit question for this screen — before commitment. Note also:
`TrainingOverview.tsx`, despite its name, is a Home-screen widget, not part of Train at
all — a naming trap worth fixing regardless of this audit.

**Strengths**
- Consistent domain terminology throughout — Training Mode, Measurement Mode, Target
  Source, Accuracy Tolerance.
- Deliberate progressive disclosure: Target Source only appears for Variable/Blind
  modes; Smart Random range only when applicable.
- Explicit "no fabricated precision" compliance — Smart Random is disabled with an
  explanation when Hog-Hog is selected, rather than faking a range
  (`TrainingSetup.tsx:483-524`).
- One shared Info action per control group, not a cramped per-segment icon, with an
  intent comment citing Design System §13.1 directly.
- Inline validation near the affected field for Smart Random range and Custom
  thresholds.

**Weaknesses**
- **Information Priority is inverted** — Session Name/Notes ("optional details")
  render before Training Mode/target ("training objective"), the exact reverse of the
  IA doc's prescribed order (`TrackerApp.tsx:1558-1581`).
- **No confirmation/review step exists** — "Start Training" commits and starts in one
  action; nothing catches a mis-tap before a block is created.
- **Triple-layered, redundant framing** before a single field is touched: the compact
  header already says "Train — Set up a session...", then "Session Details," then "Set
  Up Training Block" restates the same framing again.
- **Undifferentiated card stacking** — `SessionSettings` and the Block wrapper are both
  full `shadow-lg` cards stacked directly on each other, the literal "Card ↓ Card ↓
  Card" anti-pattern.
- Only Target Configuration gets a labelled section divider; Block Name/Training
  Mode/Measurement Mode have none.
- Native `alert()` used for validation (`TrainingSetup.tsx:236`,
  `TargetTimeSettings.tsx:26`) — breaking the calm, in-app pattern used two fields over
  on the same screen.
- `InfoButton` renders `shortDescription` before Purpose, reversing the documented
  "Explain Purpose Before Mechanics" order at the point of display.

**Violations**
- Information Architecture — Train, Information Priority & "Am I ready to start?"
- Mobile UX Principles §1: "should not feel like a long administrative form."
- Design Review Checklist §3 — Rhythm: literal Card/Card stacking.
- Design System §15.5: only one of three documented form groups is visually marked.
- UX Writing Guidelines — Error Messages: validation must stay near the affected
  field; native `alert()` does not.

**Quick wins**
- Replace both `alert()` calls with the inline pattern already used elsewhere on the
  same screen.
- Add a section header for the Training Block fields, matching the existing Target
  Configuration divider.
- Collapse the redundant header/title/subtitle stack to one statement of purpose.
- Swap `InfoButton`'s render order so Purpose precedes the short description.

**Major opportunities**
- Add a genuine "ready to start" summary before commit.
- Reorder the screen so Training Mode/Target Configuration precede Session Name/Notes.
- Extract Train out of the 2,600+ line `TrackerApp.tsx` monolith into its own screen
  component — the root cause of the duplicated headings and ad-hoc `alert()` calls is
  that no single place enforces the page-shell rules here.

**Estimated user impact.** This is the highest-frequency screen in the product. The
reversed information order and redundant headers add a small, repeated scroll/skim tax
on every session; the missing confirmation step means a mis-configured block can only
be corrected by ending it and starting over.

---

## Train — New Training Block (mid-session modal)

**Rating:** ★★★☆☆ · **Priority:** Medium

**Purpose.** Triggered by "New Training Block" during Active Training, this
full-screen overlay shows an outgoing-block summary before reusing `TrainingSetup` for
the next block. It correctly models the domain rule that ending a block never edits
it — a new block is created, the old one closed out — but has real overlay-pattern
gaps.

**Strengths**
- Shows a meaningful outgoing-block summary before asking for the next configuration —
  a real "Action → Feedback → Understanding" moment.
- The summary sits in a lighter inset panel, distinct from the modal's own surface —
  correctly avoids nested full-strength cards.
- Uses an explicit "Not enough shots" guard rather than a false `0.000` metric.
- Reuses `TrainingSetup` exactly rather than a parallel form.

**Weaknesses**
- No visible close action, no `role="dialog"`/`aria-modal`, no
  backdrop-click-to-dismiss — the only way out is scrolling to "Cancel" at the bottom
  of a potentially long form.
- Inherits every Setup-screen weakness by composition, and the native `alert()`
  problem is worse here: one native interruption stacked on top of an already-modal
  interruption.

**Violations**
- Design System §17.1 — Overlay Requirements: missing close action, focus trap, dialog
  semantics.
- Mobile UX Principles §24 — Safe Areas: a fixed `max-h-[90vh]` overlay with no visible
  safe-area accommodation.

**Quick wins**
- Add a visible close (X) button and `role="dialog"`/`aria-modal`/`aria-labelledby`.
- The Setup-screen `alert()` fix applies here automatically once made upstream.

**Major opportunities**
- Reconsider whether a full interrupting modal is the right pattern at all, given
  Active Training's whole purpose is to "maintain flow."

**Estimated user impact.** Moderate — hit on every multi-block session, a common,
explicitly-supported use case, but not a severe blocking defect on its own.

---

## Active Training — Manual Entry & Auto Capture

**Rating:** ★★★☆☆ · **Priority:** High

**Purpose.** The screen where an athlete captures each shot's release time, by typing
it (`ShotEntry.tsx`) or via `AutoCapture`. Documented as "the most
interaction-sensitive area of the platform" — its whole job is "what do I need to do
right now," with everything else secondary.

**Strengths**
- Auto Capture correctly collapses its full configuration form into a compact status
  view once active (`AutoCapture.tsx:145-466`) — exactly as specified.
- Dev tooling (`TimingSimulatorPanel`) is properly gated behind `IS_DEV`, carries a
  "DEV TOOL" badge, and is never mentioned to normal users.
- Empty-state discipline is correct and tested — "Add a shot to begin the live
  summary" rather than a false `0.00s`.
- The Active Block Summary matches its spec, with an inline comment citing the source
  design-system section directly.

**Weaknesses**
- **The current target is not "one of the strongest visual elements on the screen."**
  It sits inside a `bg-slate-100` inset panel nested inside the same card as
  input/handle/shot-type controls, at `text-2xl` — smaller than the equivalent value in
  Assess's `AssessmentCurrentShot.tsx` (`text-3xl`) for the identical "Target" concept.
- No dedicated Current Target Panel exists at all for Training — Assess got this
  treatment; Training did not.
- **Severe card-stacking**: Active Block Summary → Shot Entry → Auto Capture → Filter →
  Dashboard → four charts → Current Shots list, at least seven using the identical
  `rounded-2xl bg-white p-6 shadow-lg` surface.
- Filter chips ("In Handle"/"Out Handle") are visually identical to the
  shot-classification Handle buttons a few components below — no visual cue
  distinguishes "classify this shot" from "filter what I'm viewing."
- Blocking `alert()` calls interrupt the between-shot rhythm in both `ShotEntry.tsx`
  and `AutoCapture.tsx`.
- No visible label on the primary release-time input — only a placeholder.

**Violations**
- Design System §19.2 — Current Target Panel / Mobile UX §17: target is not the
  strongest visual element.
- Mobile UX §12 — Card Density: more than five major cards with no grouping.
- Design System §23 — Filters: filters must remain visually distinct from actions.
- UX Writing Guidelines §11.4 / Design System §15.2: validation near the field,
  visible input labels.

**Quick wins**
- Replace all `alert()` validation with inline, near-field error text.
- Add visible labels to the release-time and manual-target inputs.
- Restyle the Filter row as compact chips, visually distinct from Handle/Shot Type
  entry buttons.
- Bump the Current Target value to `text-3xl`, matching Assess.

**Major opportunities**
- Extract a genuine, elevated Current Target Panel for Training, mirroring
  `AssessmentCurrentShot.tsx`.
- Rework the post-entry stack (Dashboard → four charts → shot list) into tiered
  hierarchy or a dedicated Live Analysis view, as the Design System already permits.

**Estimated user impact.** Moderate-to-high — the domain logic is sound, but
`alert()` interruptions break flow at exactly the moment (cold hands, time pressure)
the docs identify as this screen's core risk.

---

## Active Training — Blind Weight

**Rating:** ★★★☆☆ · **Priority:** High

**Purpose.** `BlindShotEntry.tsx` runs the predict → measure → review flow unique to
Blind Weight, sharing the same page shell as Manual/Auto Capture.

**Strengths**
- Correctly honours the mandated real-world event order — the player cannot know the
  actual release time before reading the external timing system — a faithful
  implementation of a deliberate, documented principle.
- No forced shot-type classification, matching the Domain Glossary's rule that Shot
  Type is genuinely absent for Blind Weight.
- Review phase separates facts cleanly — Target, Prediction, Actual and Target Error
  as four distinct tiles, with Prediction Error's directional description kept
  visually separate.
- Edit Prediction / Edit Measured Time allow pre-save correction without silently
  rewriting a saved shot.

**Weaknesses**
- Inherits every shared-shell issue from Manual/Auto Capture (embedded target
  treatment, card stacking).
- **Validation interruptions are tripled**: `alert()` fires at three separate points
  across the three phases — up to three interruptions before a single shot saves, more
  than any other entry mode.
- No visible field label on the Handle toggle in either phase.
- The "Auto Capture unavailable in Blind Weight" notice is a plain informational card
  shown every session — not the muted, compact Future Capability treatment used
  elsewhere.
- Review phase surfaces six interactive/scan elements at once with no per-shot
  progress cue, unlike Assess's "Warm-up shot 3 of 6."

**Violations**
- UX Writing Guidelines §11.4: three separate `alert()` interruptions per shot.
- Design System §27 — Future Capability Pattern: the Auto Capture unavailability
  notice doesn't use the prescribed muted treatment.

**Quick wins**
- Replace all three `alert()` calls with inline validation.
- Restyle the Auto-Capture-unavailable notice with the shared muted treatment, or
  collapse it by default.

**Major opportunities**
- Add a lightweight, non-blocking per-shot progress cue inside the Blind Weight card.

**Estimated user impact.** Moderate — the tripled `alert()` interruptions erode the
"calm performance instrument" feel more here than anywhere else in Training, precisely
because Blind Weight requires more sequential input per shot than any other mode.

---

## Assess — Landing

**Rating:** ★★★½☆ · **Priority:** Medium

**Purpose.** Entry point into Assess. Must answer "What Assessment is this? What will
be measured? How long?" without becoming "a comparison tool" or "a report."

**Strengths**
- A single, unambiguous primary action when no run is in progress — one dark "View
  Assessment" button, with a comment explicitly crediting the Mobile UX doc's "Assess
  Landing Balance" priority for removing a redundant heading.
- The template card teases stone counts, block count, measurement mode and duration as
  a compact stat grid, not a wall of text.
- The "Latest Completed Assessment" card surfaces one metric plus a "View Results"
  link and explicitly defers full history/comparison to Analyze — correctly avoiding
  the "comparison tool" the IA doc says Assessment must not become.

**Weaknesses**
- **A large fraction of this file is unreachable dead code.** `AssessmentLanding`
  implements a whole "Active Assessment Run" banner path with a "Resume Assessment"
  button, but `AssessScreen.tsx:484-493` hardcodes `currentRun={null}`, and
  structurally `AssessScreen.tsx:468` only routes here when no run is active — an
  active run goes straight to Execution or Paused instead. None of this file's "active
  run" UI can ever render.
- The primary button's label, "View Assessment," doesn't describe what happens — it
  reads as passive, but tapping it begins a multi-step commitment toward Guided
  Introduction → Overview → Warm-up.

**Violations**
- UX Writing Guidelines §9: button labels must describe the result of the action.
- Design Review Checklist §3 / Feature Philosophy — Complexity Budget: a structurally
  unreachable UI branch with no disclosure that it's dead code.

**Quick wins**
- Rename "View Assessment" to something outcome-oriented, e.g. "Continue to Setup."
- Delete the unreachable active-run banner machinery, or comment why it's
  intentionally unreachable.

**Major opportunities**
- If a genuine "resume from Landing" affordance is ever wanted, wire the currently-dead
  code up for real rather than leaving two parallel, inconsistent resume concepts.

**Estimated user impact.** Low for the live experience; medium for product
trustworthiness and maintainability, since the dead code misrepresents what this
screen does.

---

## Assess — Guided Introduction

**Rating:** ★★★★☆ · **Priority:** Low

**Purpose.** A short, optional-to-show explanation of the four assessment blocks,
satisfying the domain spec's rule that explanation is "optional in presentation, but
permanently available in content."

**Strengths**
- Faithfully implements the rule that skipping this screen must never skip threshold
  selection, setup confirmation, or the warm-up itself — cited directly in the
  component's own comment.
- "Do not show automatically again" is an honest, unchecked-by-default checkbox that
  persists without removing permanent access.
- Content is pulled entirely from the centralised copy source, not re-authored inline.
- Four blocks render as one lightweight list, not four separate elevated cards.

**Weaknesses**
- The "Why this structure" paragraph is the exact same string, verbatim, shown again
  moments later inside Overview's accordion — a direct instance of the content-reuse
  anti-pattern the guidelines warn against.
- No way back to Landing — only "Continue" and "Skip," both advancing forward.

**Violations**
- UX Writing Guidelines §33 — Content Reuse: identical sentence shown twice
  back-to-back.
- Mobile UX Principles §8 — Navigation: no return path without going forward first.

**Quick wins**
- Remove the duplicated paragraph from one of the two locations.
- Add a lightweight back/close affordance.

**Major opportunities**
- None significant — small, well-scoped, largely compliant.

**Estimated user impact.** Low — limited to first-time use; a small, avoidable dent in
tone rather than a comprehension blocker.

---

## Assess — Overview (Threshold Selection & Setup Confirmation)

**Rating:** ★★★☆☆ · **Priority:** High

**Purpose.** The last screen before "Start Warm-up" activates: must restate the
assessment's identity, force a threshold decision, force setup confirmation, and
surface any conflict with an active Training capture.

**Strengths**
- Domain-content fidelity is excellent — the threshold explanation matches the domain
  spec almost verbatim, with exact values shown.
- The threshold selector is a proper `role="radiogroup"` with `aria-checked` and a
  visible focus ring; Custom-threshold validation maps issue codes to the guideline's
  own example copy rather than a raw enum.
- Setup Confirmation's sentence changes meaningfully by timing method — it never
  claims physical gates exist under Manual Timing.
- The setup diagram is provider-neutral, accessible, and tucked behind a details
  disclosure rather than occupying permanent space.

**Weaknesses**
- **Selection controls are visually identical to the primary action.** The selected
  Threshold preset and the selected Timing-method button use the exact same solid dark
  treatment as "Start Warm-up" itself — up to three visually identical dark buttons
  can appear on screen at once.
- **The disabled primary action gives no on-screen reason** why "Start Warm-up" won't
  activate — no "Confirm setup to continue" nearby.
- Undifferentiated card stacking — the identity/stats card, Threshold card, and Setup
  Confirmation card all use the identical elevated treatment despite two being
  required, blocking gates and one being pure context.
- No progress affordance ("2 of 2 required") for the two sequential gated decisions
  bundled into one screen.

**Violations**
- Design System §13.1 / §12: selected-option styling must not resemble the primary
  action button.
- Design System §12.5: disabled controls must communicate the missing requirement
  nearby.
- Design System §8.4 / Design Review Checklist §3: uniform elevated treatment
  regardless of whether content is context or a required gate.

**Quick wins**
- Restyle selected options with a distinct treatment (light fill + check icon) instead
  of the primary button's solid dark fill.
- Add a short helper line beneath the disabled Start Warm-up button.
- Downgrade the identity/stats card to a lighter, non-shadowed surface.

**Major opportunities**
- Consolidate Threshold Selection and Setup Confirmation into one "Before you start"
  surface with two sub-sections that visibly check off as completed.

**Estimated user impact.** Medium-high — this is the last screen before a 25–35 minute,
protocol-governed execution; a confused, stuck moment here has outsized cost
mid-ice-session.

---

## Assess — Scored Execution

**Rating:** ★★★☆☆ · **Priority:** High

**Purpose.** Carry the athlete through warm-up and all scored stones, one Planned Shot
at a time, so the athlete "thinks only about the next stone, never about the software"
— while quietly enforcing invalid-attempt, wrong-handle, pause and block-transition
rules underneath.

**Strengths**
- The whole surface is a pure function of run status and the current Planned Shot — no
  separate UI-only counters.
- Invalid-attempt reasons are strictly objective/technical, with no "bad shot" escape
  hatch; wrong-handle notice text is the exact required copy.
- The per-shot invalid-attempt cap is visibly counted, disabling with an explanation
  rather than silently blocking.
- Progress uses a real `role="progressbar"` with visible `x / y` text.
- Pause is a single unconfirmed tap (correctly non-destructive); Abandon always routes
  through a confirm dialog with the exact required consequence copy.
- Leaving Assess mid-run pauses rather than silently losing or abandoning progress;
  reload recovery force-pauses an in-flight run instead of silently resuming capture.

**Weaknesses**
- **Software stays on screen the entire time.** The generic functional header and the
  full five-item bottom navigation remain visible throughout warm-up and all scored
  stones — never suppressed for execution, on exactly the one screen the product's own
  philosophy singles out as needing to disappear behind the task.
- **Three consecutive equal-weight cards, no Hero** — the status card, Current Shot,
  and Attempt Entry all share identical elevation.
- **Secondary controls are undersized** — Protocol and Pause sit around 24–28px tall;
  the Handle toggle and "Mark attempt invalid" are also below the 44×44px minimum, in
  exactly the cold-hands, one-handed context the docs call out by name.
- **A destructive link is permanently present on every shot** — "Abandon Assessment"
  renders on all ~38 shots, not only when paused, an ambient decision repeated dozens
  of times.
- No per-block progress bar, only per-run — the athlete has no compact answer to "how
  much of this block is left."
- Hardcoded protocol constants (block count) will silently go stale under a future
  template version, even though a sibling component already derives the same value
  correctly from the template.

**Violations**
- Information Architecture — Assessment, "During Execution": "never about the
  software," violated by persistent chrome and undersized controls.
- Mobile UX Principles §23 / Design System §29.1: touch targets below 44×44px.
- Visual Language — Hero / Design System §8: three equal-elevation cards, no dominant
  surface.
- Design System §20.2: `AssessmentProgress` is meant to cover block progress too; it
  doesn't here.

**Quick wins**
- Increase touch-target height on Protocol, Pause, handle-toggle and "Mark attempt
  invalid."
- Derive block/stone counts from the template instead of hardcoding.
- Demote the header/status card to an inline, borderless strip.
- Move "Abandon Assessment" out of the persistent per-shot flow into the Protocol
  sheet.

**Major opportunities**
- Suppress or meaningfully compact header and navigation during warm-up/scored
  execution — a distinct "execution mode" chrome.
- Give external timing capture a first-class, visually distinct active-capture state,
  mirroring Active Training's Auto Capture.
- Add a compact per-block progress indicator alongside the whole-run counter.

**Estimated user impact.** Medium-high — functionally correct and domain-safe, but the
persistent chrome and small controls add friction repeated dozens of times per run,
over a 25–35 minute protocol performed at the rink.

---

## Assess — Completion Summary

**Rating:** ★★★½☆ · **Priority:** Medium

**Purpose.** An immediate, calm confirmation that the run finished, plus the minimum
transparent numbers needed to decide whether to look deeper — deliberately deferring
charts, trends and comparisons to the full Result screen.

**Strengths**
- Correctly and deliberately minimal, per the component's own header comment.
- Uses the exact required completion language and avoids any forbidden judgement terms
  (Passed/Failed/Excellent/Poor).
- Cleanly separates threshold-independent metrics from threshold-dependent category
  metrics into two distinct cards, mirroring the domain model's own distinction.
- "View Full Results" is unambiguously the dominant, full-width primary action.

**Weaknesses**
- Same equal-weight-card stacking as Execution — header, "Raw summary" and "Category
  summary" share identical elevation, with nothing signalling which to read first.
- Measurement mode is never shown, though the domain spec's Summary list requires it.
- A hardcoded stone-count total will silently mis-report the moment a second template
  version exists.
- Three buttons of differing consequence ("Done," "View Protocol," "Start New
  Assessment") share identical styling in one equal-width row.

**Violations**
- Assessment Domain Specification §21 — Result Presentation: measurement mode required
  in the summary, absent.
- Mobile UX Principles §14 — Action Hierarchy: secondary vs. tertiary actions must use
  different visual treatment.

**Quick wins**
- Replace the literal stone count with the template's own value.
- Add measurement mode to the header card's metadata line.
- Give "View Protocol" and "Start New Assessment" distinct, lower-emphasis treatments.

**Major opportunities**
- Visually subordinate the Category summary beneath Raw summary, reflecting that
  threshold-dependent metrics are secondary.

**Estimated user impact.** Low-medium today given a single protocol version, but the
hardcoded count and missing measurement mode become real defects the moment a second
template version or Custom Assessment exists — which the domain spec explicitly plans
for.

---

## Assessment Result Screen

**Rating:** ★★★☆☆ · **Priority:** Medium

**Purpose.** Present the full derived result of one completed run — the "how good am I
under standardised conditions" answer — as a transparent, threshold-aware,
non-diagnostic breakdown the athlete can trust and later compare.

**Strengths**
- Reading order matches the documented hierarchy almost exactly — summary → threshold
  context → core metrics → block → target → handle → Variable Adaptation → protocol
  integrity → shot details → trends/comparisons.
- **No fabricated overall score, ranking or athlete classification anywhere**,
  confirmed by explicit self-documenting comments ("deliberately no block score or
  ranking"; "never a synthetic winner or overall score").
- Copy consistently separates observation from interpretation and hedges
  appropriately, matching the Coaching Principles' "never diagnose technique directly"
  almost verbatim.
- Threshold semantics are correctly modelled — changing the Analysis Threshold never
  rewrites recorded times, and this is stated explicitly to the user.
- Comparison eligibility is translated to plain language, never raw enum codes.

**Weaknesses**
- **Card density is more than double the documented limit**, with almost no
  progressive disclosure — 11 always-rendered major cards plus 2 conditional ones;
  only Shot Details is actually collapsible.
- **Six separate Hero-weight surfaces on one screen** — Summary, the threshold
  wrapper, both Core Metrics cards, Run Comparison and the Trend Chart all use the
  same strong elevation, so the headline and a secondary comparison tool command
  identical visual authority.
- The same "is this run comparable?" fact is stated three separate times with three
  different phrasings.
- The full Comparison Threshold selector renders even when there is nothing to compare
  against, e.g. an athlete's very first assessment.
- "pp" (percentage points) is used unexplained, with no Info-button path, unlike Core
  Metrics elsewhere on the same screen.
- Two governing documents disagree on whether threshold context or core metrics comes
  first — the implementation silently follows one without reconciling the conflict.

**Violations**
- Mobile UX Principles §12 — Card Density: more than 5 major cards without grouping.
- Visual Language — Hero: "only one Hero should exist per screen," violated by six
  `shadow-lg` cards.
- Design System §20.6: "do not present all subsections with equal visual weight."
- UX Writing Guidelines §23.3: "pp" deviates from the documented spelled-out pattern,
  unexplained.

**Quick wins**
- Give delta rows an Info-button explanation and spell out "percentage points" on
  first use.
- Collapse Block/Target/Handle/Variable Adaptation behind a single "Full Breakdown"
  disclosure.
- Remove duplicate "not comparable" messaging, keeping it in one place only.
- Hide the Comparison Threshold selector until there's something to compare.

**Major opportunities**
- Restructure the whole screen around 2–3 tiers of disclosure: always-visible (Summary
  + Core Metrics + Threshold), one-tap (Block/Target/Handle/Variable
  Adaptation/Protocol Integrity), separate action (Compare/Trend).
- Reconcile the Mobile UX vs. Design System ordering conflict in the documentation
  itself.

**Estimated user impact.** Not broken, but noticeably more effortful and less premium
than the rest of the product's mobile discipline would suggest — the domain
correctness and language discipline (the things most likely to erode trust if wrong)
are solid.

---

## Analyze — Assessments

**Rating:** ★★☆☆☆ · **Priority:** Medium-High

**Purpose.** The home for completed/incomplete Assessment Runs under Analyze — meant
to offer a path from "latest result" to "comparable history" to "development over
time," kept structurally distinct from Training Session history.

**Strengths**
- Domain separation is respected exactly as specified — never merges Assessment Runs
  into Training history, and has its own export path.
- The empty state genuinely explains why nothing is shown and offers one clear action.
- Completed vs. incomplete runs are kept visibly distinct, supporting the rule that
  incomplete runs aren't silently conflated with completed ones.

**Weaknesses**
- **No trend, target, handle, or block-level analysis at all** — it is a "latest
  snapshot + list," not the analytical surface the domain spec anticipates. An athlete
  with five completed assessments gets six raw numbers from the latest run and a
  scrollable list, no cross-run pattern until they drill into one specific run.
- **The Analyze information hierarchy skips two tiers** — the prescribed order is key
  takeaway → summary metrics → supporting charts → detailed analysis → raw history;
  this screen jumps straight from summary metrics to raw history.
- **History gets the exact same visual weight as the "what matters most" card** — both
  use the identical elevated surface, though historical context is explicitly
  documented as a Secondary Surface that "should visually step back."

**Violations**
- Assessment Domain Specification §26 — Analyze Integration: trend/target/handle
  analysis is unimplemented, not deferred with a documented rationale.
- Information Architecture — Analyze, Information Hierarchy: key takeaway, supporting
  charts, and detailed analysis tiers are absent.
- Visual Language — Secondary Surface: history uses Hero-tier treatment identical to
  the primary summary card.

**Quick wins**
- Visually demote "Assessment History" from the elevated treatment to a
  bordered/lighter surface.
- Add a one-line, fact-only "key takeaway" (e.g. run count) above the Latest Completed
  Assessment card.

**Major opportunities**
- Bring a scaled-down trend chart up to the Analyze → Assessments tab itself, so
  "primary trend" exists without a drill-down.

**Estimated user impact.** An athlete who has completed several assessments and visits
Analyze specifically to see whether they're improving cannot answer that question
without opening the most recent run's full Result Screen — Analyze's own stated job is
only partially fulfilled here.

---

## Analyze — Training Analytics

**Rating:** ★★½☆☆ · **Priority:** High

**Purpose.** Turn recorded shots into understanding — "What did I learn?" — via a
prescribed hierarchy of context/filters → key summary → primary trend →
accuracy/bias → target → handle → raw history. The implementation gets the macro
reading order right but repeatedly violates the philosophy at the card and copy
level — most damagingly through wholesale duplication of charts once a session is
expanded.

**Strengths**
- Reading order genuinely matches the documented hierarchy, with inline comments
  citing the intended sequence.
- One group-level empty state rather than five empty charts when there's no data.
- No false zero metrics — a single "Not enough shots" card instead of misleading
  tiles.
- Bias and Average Error kept distinct with per-metric explanations that separate
  observation from interpretation and hedge small samples correctly.
- Chart-level empty states are compact, not blank axes.

**Weaknesses**
- **Session expansion duplicates the entire aggregate analysis, per block.** Expanding
  a session re-renders a full 7-tile dashboard plus two charts for every block inside
  it — on top of the same metrics already shown in aggregate above. Expanding two
  sessions of three blocks each produces roughly a dozen extra chart cards restating
  information the top of the screen already gave.
- **No hierarchy of surface weight anywhere on the screen** — every section, from the
  filter bar to every chart card, uses the identical elevated treatment.
- **No "key takeaway" is ever rendered** — the screen starts directly at "summary
  metrics," with no synthesised sentence anywhere ("your consistency improved"). The
  coaching hierarchy's higher levels ("is this improving," "what should I
  investigate") are never reached.
- A chart subtitle ("Can I hit different targets correctly?") is verbatim the
  anti-pattern the style guide names as the example to replace, while the correct
  wording already exists one tap away in the same file's own Info-button content.
- Two charts communicate the same on-target/major-miss pattern immediately adjacent to
  each other.
- The filter bar reads as a generic admin form — five native dropdowns in a row rather
  than the chips/segmented controls prescribed elsewhere.
- A handle comparison chart's selectable columns have no keyboard/focus/ARIA support.

**Violations**
- Mobile UX Principles §12 / Design System §21.1: session-expansion duplication
  produces far more than five equally-weighted major cards.
- Design System §22.6 — Chart Economy: multiple charts showing the same pattern.
- Information Architecture — Analyze, Information Hierarchy: no key-takeaway sentence
  exists anywhere on the screen.
- UX Writing Guidelines §20.6: "the chart reports data; it does not ask or judge the
  athlete" — violated verbatim by one chart subtitle.
- Design System §29 / Mobile UX Principles §26 — Accessibility: no keyboard/focus/ARIA
  support on a clickable chart.

**Quick wins**
- Fix the one mis-worded chart subtitle using text that already exists in the same
  file.
- Give the screen any tiered elevation at all, rather than uniform cards throughout.
- Remove the per-block duplicate charts from session expansion; replace with a compact
  stat row.
- Add keyboard/focus/ARIA support to the handle-comparison chart.

**Major opportunities**
- Add an explicit "key takeaway" element — one short, fact-then-hedge sentence,
  sourced only from data already computed on-screen.
- Redesign "Blocks and Sessions" as compact rows with on-demand detail, instead of a
  second full dashboard per block.
- Consolidate the two rate-trend charts, or clearly differentiate their questions in
  copy.

**Estimated user impact.** Moderate-to-high — power users who expand session history
hit real scroll fatigue and redundant information quickly; lighter users get a screen
that reports numbers competently but never says whether they're improving, for a
product whose differentiator is supposed to be coaching-quality interpretation.

---

## Settings

**Rating:** ★★☆☆☆ · **Priority:** High

**Purpose.** Must answer "Can I rely on this platform?" and leave the athlete feeling
"my data is safe," through four responsibilities in priority order: manage data,
manage devices, manage preferences, advanced functionality.

**Strengths**
- Correct card hierarchy for a destructive action — Clear Data is isolated in its own
  red-bordered section, separated from non-destructive Data Management.
- The local-storage disclosure copy is a near-verbatim match for the documented
  example — a rare case of a doc's example copy shipping unchanged.
- Disabled-state messaging explains why Export/Clear are disabled, rather than just
  greying out buttons.

**Weaknesses**
- **No path to "Can I restore it?" at all.** The docs script exact copy for a Backup
  action distinct from CSV Export, and for a Restore flow — none of this exists
  anywhere in the codebase. For a local-first app whose entire value proposition is
  that the athlete's only copy of years of training data lives on one device, shipping
  "Clear History" with no corresponding Backup or Restore is close to the opposite of
  "my data is safe."
- **"Devices" is entirely missing from Settings**, despite the documented Information
  Priority listing it second.
- **"Preferences" is entirely missing** — yet the page-header description itself
  promises "Manage local data and app preferences," over-promising relative to actual
  content.
- The Clear History confirmation uses "This cannot be undone" with no further specific
  consequence — the exact vague phrasing the guidelines call out to avoid — and its
  Cancel button uses the generic label rather than a safe, specific alternative like
  "Keep History."

**Violations**
- Information Architecture — Settings, "Should Immediately Answer": "Can I restore
  it?" is unanswered.
- Feature Philosophy — Data Ownership: "always support export, backup, migration,
  transparency" — backup and migration are absent.
- UX Writing Guidelines §17.1 / §9.4: unspecific "cannot be undone" phrasing; a
  destructive label that doesn't name the object.

**Quick wins**
- Rename "Clear All" to "Clear History," and give the confirm dialog a specific "Keep
  History" cancel label.
- Expand the Clear History dialog to state exactly what's deleted.
- Stop promising "app preferences" in the header until a preference exists.

**Major opportunities**
- Ship a genuine local Backup/Restore flow — the wording for it is already pre-written
  in the guidelines.
- Introduce a Settings-side Devices section, even a read-only "Manual Timing only,
  more coming" card.

**Estimated user impact.** An athlete who clears history, upgrades phones, or has app
data cleared by the OS has no recovery path today — for a local-first app with no
cloud fallback, that is a real risk to years of training data, not a cosmetic gap.

---

## App Shell — Navigation & Headers

**Rating:** ★★★★☆ · **Priority:** Medium

**Purpose.** The one piece of UI present on every screen — header, bottom navigation,
and the shared Info-button/confirmation-dialog primitives every feature reuses. A
defect here is a defect on every screen.

**Strengths**
- **Safe-area math is genuinely correct, not just gestured at** — centralised in one
  utility class rather than duplicated per screen, with `viewportFit: "cover"`
  correctly set.
- The mobile nav is a floating, inset pill, not five edge-flush buttons, matching the
  preferred navigation surface precisely.
- Touch targets are verified by test at 44px, and `aria-current="page"` is applied to
  exactly the active item.
- The Home-header vs. compact-functional-header split is real and correctly gated —
  the single most explicitly-mandated shell rule in the docs, fully implemented and
  covered by comments citing the exact sections.
- Navigation guards compose three independent guards (Blind draft, Training capture,
  Assessment) through one shared mechanism, correctly distinguishing "pause" from
  "cancel" consequences.
- The Info-button pattern is single and consistent — an anchored popover on desktop, a
  bottom sheet on mobile, via CSS breakpoints alone, with real focus-restoring Escape
  behaviour.

**Weaknesses**
- **The confirmation dialog — the app's one destructive-confirmation primitive — has
  materially weaker accessibility than the Info button right next to it.** No dialog
  role, no `aria-modal`, no focus trap, no focus restoration, and no test file at all —
  despite guarding every genuinely consequential action in the app (Clear History,
  Abandon Assessment, Delete Run).
- The one piece of Devices copy that does exist directly contradicts the writing
  guidelines' own named example of what to avoid, verbatim.
- Two full-screen overlay layers (the Info sheet and the confirmation dialog) share
  the same stacking layer with no documented precedence if both were ever open at
  once.

**Violations**
- Design System §17.1 — Overlay Requirements: the confirmation dialog lacks dialog
  semantics, a focus trap, and focus restoration.
- UX Writing Guidelines §29.2: the Devices copy is the guideline's own named "avoid"
  example, verbatim.

**Quick wins**
- Add dialog semantics and focus-restore-to-trigger to the confirmation modal,
  mirroring the pattern already proven in the Info button.
- Replace the Devices copy with the guideline's own suggested alternative.

**Major opportunities**
- Give the confirmation dialog a real focus trap and its own test file — it deserves
  at least parity with the informational popover, given it guards the most
  consequential actions in the app.

**Estimated user impact.** Low for most users in normal use — the shell is the
strongest-executed part of this whole audit. The confirmation-dialog gap matters most
for keyboard/screen-reader users at exactly the highest-stakes moments in the app.

---

## Cross-screen review

Individually, most of these screens are defensible — some are genuinely strong. Looked
at together, a handful of patterns repeat so consistently that they stop being fifteen
separate findings and become three or four platform-level ones.

### Navigation

Navigation itself supports the athlete's journey well: five stable destinations, a
config-driven model rather than routed pages, and a genuinely sophisticated guard
system that composes three independent "don't lose active work" rules into one
mechanism. An athlete who steps away from a Training Block, a Blind Weight prediction,
or an Assessment mid-run is protected by the same infrastructure everywhere. This is
not a small thing to get right, and it's already right.

What the navigation does *not* yet do is reflect Home's own promise back at the
athlete. Home is supposed to answer "do I have something in progress?" for both
pillars of the product; it currently only does so for Assess. That's a content gap
sitting on top of excellent navigation infrastructure, not a navigation defect.

### Consistency

The product does not yet feel like one hand designed it — it feels like two. The
shell (header, navigation, safe areas, the Info-button pattern) is executed to a
genuinely premium, consistent standard everywhere it appears. The screens layered on
top of that shell are not consistent with each other: Assess has a dedicated
hero-treatment "Current Target" component, threshold-aware inline validation, and
accessible custom controls; Train — the founding, most-used feature — validates with
native browser `alert()` dialogs and has never received an equivalent hero treatment
for its own current target. Two features that are meant to feel like stages of one
cycle currently read as though they came from different design maturity levels, and
the newer feature (Assess) is the more disciplined one.

### Visual identity

The identity documents ask for a small, restrained, high-conviction visual language:
one Hero per screen, a five-level surface hierarchy, deliberate rhythm between open
space and grouped content. Almost none of the screens reviewed here actually produce
that rhythm. The dominant pattern, repeated across Home, Train, Active Training, every
Assess phase, the Result screen, and both Analyze tabs, is a long, evenly-weighted
stack of white, `shadow-lg` cards — the exact "Card ↓ Card ↓ Card ↓ Card" anti-pattern
the Design Review Checklist names by name as the failure mode to watch for. Nothing
here reads as generic-admin-dashboard ugly; the type, spacing, and copy are all
considered. But nothing reads as having one clear focal point either, and the identity
documents are explicit that visual hierarchy — not decoration — is what separates
"premium" from "assembled." Today the product is closer to assembled.

### Information flow

Prepare → Train → Measure → Understand → Improve holds up structurally end to end — an
athlete really can move Home → Train → Active Training → Analyze, or Home → Assess →
Result → Analyze, without hitting a dead end or an unexplained screen. The weak link is
the last stage: Understand. Both Analyze surfaces (Training Analytics and the
Assessments tab) reliably deliver facts and stop there. Neither ever states a
synthesized takeaway — "your consistency improved," "your bias moved toward zero" —
even though the product's own Coaching Principles document describes exactly this kind
of hedged, fact-first interpretive sentence as the desired output, and even ships the
vocabulary for it. The flow reaches "Measure" reliably and stalls before "Understand"
becomes real.

### Cognitive load

The places where the platform asks an athlete to think about the software instead of
curling are concentrated and identifiable, not scattered everywhere: native `alert()`
interruptions during Training capture (up to three per shot in Blind Weight); a
disabled "Start Warm-up" button with no visible reason; selection buttons in Assess
Overview that are indistinguishable from the actual "go" button; an "Abandon
Assessment" link visible on every one of ~38 shots. Each is small in isolation.
Together, they are the concrete, fixable answer to "where does this app currently fail
its own 'the athlete should think only about the next stone' standard."

### Feature integration

Train, Assess and Analyze do not yet feel like one coherent platform so much as three
modules built to three different bars, loosely reusing the same domain layer
underneath. The domain reuse itself is real and well done — Assessments genuinely sit
on Sessions/Blocks/Shots/Targets rather than a parallel model, exactly as the Feature
Philosophy demands. But the *experience* layer hasn't converged the same way: Assess
got a bespoke, more accessible, more disciplined execution surface; Train got the
MVP's original, rougher one; Analyze got two structurally different tabs (Training vs.
Assessments) that don't share a visual or informational grammar with each other, let
alone with the rest of the app. The underlying architecture is coherent; the surfaces
built on it are not, yet.

### Design system application

Where the Design System's component-level rules are simple and binary (safe-area
padding, touch-target minimums on shell chrome, the Home/functional header split,
empty-state copy, no-fabricated-metrics), they are followed with real discipline
almost everywhere. Where they require a genuine design judgment call — surface
hierarchy, card economy, disabled-state explanation, selection vs. action styling —
compliance drops sharply and unevenly. The Design System is not insufficient as
written; the gap is in application, and it is uneven in a way that tracks almost
exactly with which feature was built when (Assess, built later and against a much more
detailed domain spec, complies noticeably more often than Train).

---

## Documentation review

The documentation set is unusually thorough for a product at this stage — most teams
this size have nothing like it. That thoroughness is also, in a few specific places,
working against the product rather than for it.

### A real, citable contradiction

**Mobile UX and Design Principles §18** ("Assessment Experience → Results") lists the
required reading order as *core metrics, then active threshold context, then block
results…*. **Design System §20.6** ("Assessment Results") lists the same screen's
order as *threshold context, then core metrics…*. The implementation follows the
Design System's order — which means it necessarily disagrees with the Mobile UX
document, and neither document flags the other. This is a small thing to fix but a
useful canary: two documents that are both supposed to be authoritative for the same
screen currently disagree, and nobody has reconciled it.

### Five documents, one hierarchy model, four names for it

Visual Language defines a five-level hierarchy (Hero / Primary / Secondary / Tertiary
/ Utility). Visual Product Identity defines a four-level hierarchy for what is
substantively the same idea (Primary / Secondary / Context / Advanced). Mobile UX and
Design Principles defines a three-level hierarchy (Primary / Secondary / Tertiary) for
the same idea again, at the component level. None of the three is wrong on its own,
and each is internally consistent — but a contributor implementing one screen has no
way to know which of three vocabularies is the one to reach for, and this audit's own
reviewers cited whichever one happened to fit best case by case. One canonical
hierarchy, referenced by the other four documents rather than re-derived in each,
would remove an entire class of "which doc wins" ambiguity.

### Duplicated refactor-priority lists

Both **Mobile UX and Design Principles** (§29, "Current Mobile Refactor Priorities")
and **Design System** (§32, "Current Refactor Priorities") independently enumerate an
almost identical seven-item punch list — bottom navigation/safe area, compact headers,
card density, active training focus, empty analytics, form density, Analyze reading
order. **Technical Debt and Roadmap** already exists as the canonical place for
exactly this kind of list. Maintaining the same priority list in three documents
guarantees they will eventually drift, and this audit is itself evidence that some of
these "priorities" were written some time ago and are still open — which is fine, but
is easier to track from one list than three.

### An asymmetry in documentation depth that appears to explain an asymmetry in implementation quality

The Assessment Product and Domain Specification is, by a wide margin, the single most
detailed document in the repository — 2,486 lines covering protocol rules,
invalid-attempt semantics, warm-up rules, comparison eligibility, and versioning, for
one of five navigation destinations. Training — the founding feature the entire
product was originally built around — has no equivalent document; its rules live only
as scattered principles inside the Product Direction document and as implementation
notes in System Architecture. This is very likely not a coincidence: Assess is, screen
for screen, the more disciplined, more accessible, more consistently-executed part of
this product, and it is also the only feature with a document of this depth behind it.
If the redesign wants Train to reach the same bar, writing a Training Product and
Domain Specification with comparable rigor — even a shorter one — is plausibly the
single highest-leverage documentation change available, because it appears to be the
actual mechanism by which rigor reaches the screen.

### Implementation-status discipline is inconsistent across documents

System Architecture is disciplined about marking every capability `(Implemented)`,
`(Planned)`, or `(Prepared)` — CLAUDE.md holds every other document to this same
standard explicitly ("keep current implementation and future vision clearly
separated"). Visual Language, Visual Product Identity, Mobile UX and Design
Principles, and UX Writing Guidelines mostly do not follow this discipline: they
describe the product prescriptively, in the present tense, without flagging which
described states are actually built. Two concrete costs of this surfaced directly in
the screen reviews: UX Writing Guidelines §27.2 fully scripts a "Resume Training"
state that doesn't exist in the app, and §28.2–28.3 fully scripts a Backup/Restore flow
that also doesn't exist — both read, on the page, as though they describe shipped
behaviour. A reader (or a design-review agent) has no way to tell "this is the target"
from "this already works" without cross-referencing the codebase directly, which is
the exact failure mode CLAUDE.md's instruction exists to prevent.

### Where the documentation is genuinely excellent and should be the model for the rest

Coaching Principles and the Assessment-specific sections of UX Writing Guidelines are
the strongest documents in the set: specific, opinionated, backed with real example
copy, and — as the screen reviews above confirm repeatedly — actually followed in the
areas they govern. They are also proof that when a document is this concrete,
implementers comply with it far more reliably than with the more abstract,
principle-only documents. That argues for investing further documentation effort in
concreteness (example copy, example component states, explicit implementation-status
tags) rather than in additional principles.

---

## Final assessment

### Is the application consistent with our documented vision?

Partially, and unevenly. The parts of the vision that are architecturally hard —
domain modelling, data-integrity guarantees, device independence, no fabricated
precision, explainable and non-diagnostic analytics language — are honoured with real
discipline almost everywhere they apply. The parts of the vision that are about
restraint and hierarchy — one Hero per screen, progressive disclosure, calm over
card-stacking — are the most consistently violated principles in the entire product.
The platform currently earns trust through its data model and loses composure through
its layout. Both are fixable, but they are not the same fix, and the second one is the
one standing between this product and the WHOOP/Linear/Flighty tier it explicitly
wants to sit in.

### The three biggest design problems

1. **No visual hierarchy discipline.** "Card ↓ Card ↓ Card," with no single dominant
   surface, recurs on Home, both Train screens, both Active Training modes, all four
   Assess phases reviewed, the Assessment Result screen, and both Analyze tabs. This
   is the single most repeated, most citable, and most fixable-at-scale problem in the
   audit.
2. **Train and Assess are built to two different bars.** Assess has a dedicated hero
   component for its current target, accessible custom controls, and no native
   browser alerts. Train — the original, most-used feature — has none of these. The
   platform does not yet read as one product because, screen for screen, it currently
   isn't one.
3. **Analyze never says whether the athlete is improving.** Both Analyze surfaces
   report facts competently and stop; neither ever produces the hedged, fact-first
   interpretive sentence the Coaching Principles document itself specifies. The screen
   athletes visit to be convinced the platform is worth trusting currently functions
   as a statistics viewer — the one thing the product's own philosophy says it must
   never become.

### The three biggest product strengths

1. **Domain and data-integrity rigor.** Immutable shot data, no fabricated Smart
   Random ranges, threshold changes that never rewrite recorded times, honest empty
   states everywhere, and — in the entire Assessment Result surface — not one instance
   of a fabricated overall score or ranking. This is executed with real discipline and
   is a genuine differentiator against generic fitness apps.
2. **Assessment copy and coaching-language discipline.** Fact/interpretation
   separation, correctly hedged small-sample language, provider-neutral setup copy,
   and no diagnosis of technique from timing data alone — among the best-executed
   writing anywhere in the product.
3. **Shell and navigation infrastructure.** Correct safe-area math, a genuinely
   sophisticated three-way navigation guard, verified 44px touch targets, and a
   consistently-applied Home-vs-functional header split. The "boring" infrastructure
   is executed to a higher bar than most of the "exciting" screens sitting on top of
   it.

### What should absolutely not change during the redesign

- The domain model and its guarantees — immutable shot data, the Timing
  Provider/Capture Sequence boundary, Assessment's deliberate separation from Training
  Session semantics. These are architecturally sound and hard-won; a redesign should
  restyle what sits on top of them, not re-architect underneath.
- The navigation, safe-area, and guard infrastructure — it already meets the bar the
  documentation sets and should be the reference standard the rest of the product is
  brought up to, not a thing being redesigned itself.
- The no-fabrication, no-diagnosis, explainability copy discipline. This is a real
  competitive differentiator; extend it into Analyze rather than diluting it anywhere
  in the name of a punchier redesign.
- The Train–Assess–Analyze mental model and information architecture itself. Nearly
  every problem found here is about hierarchy, density, and consistency *within*
  screens — not about the conceptual shape of the product. Don't fix a density problem
  by rethinking the IA.

### Four-week roadmap, ordered by impact

**Week 1 — Enforce one Hero per screen.** Apply the already-documented surface
hierarchy across the four worst offenders — Active Training, Assess Execution, the
Assessment Result screen, and Analyze — so exactly one surface per screen carries the
strongest elevation and everything else visibly steps back. This is "apply an existing
rule consistently," not new design work, and it is the single highest-leverage change
available: it touches every screen in the audit and directly targets Problem 1.

**Week 2 — Close the Train/Assess parity gap.** Replace every native `alert()` in
Training (Shot Entry, Blind Weight, Auto Capture, Training Setup) with the inline
validation pattern Assess already uses correctly, and give Training a dedicated
Current Target hero component matching Assess's treatment. This directly targets
Problem 2 and is the fastest way to make the founding feature feel as considered as
the newer one.

**Week 3 — Give Analyze a synthesis layer.** Add one fact-then-hedge "key takeaway"
sentence to both Analyze surfaces, sourced only from data already computed on-screen;
consolidate the two rate-trend charts that currently repeat the same pattern; and
remove the per-block chart duplication in Training History. This directly targets
Problem 3 and turns Analyze from a statistics viewer back into the coaching surface the
product claims to be.

**Week 4 — Close the trust-critical gaps.** Ship Settings' Backup/Restore flow (the
copy is already written), fix Home's "no scheduled session" message when Training is
actually active, bring the confirmation dialog's accessibility up to the Info button's
standard, and reconcile the Mobile UX vs. Design System ordering contradiction plus the
duplicated refactor-priority lists in the documentation itself. None of these are
large builds; all of them are places where the product currently tells the athlete
something false, or asks them to trust it with data it can't yet help them recover.
