# ADR-0046: Discovery has two categories, and source diagrams are corrected at the source

## Status

Accepted and implemented for the 2026-09-10 Exercise Library correction. Supersedes
ADR-0043 Decision 2 and ADR-0044 Decision 6 on the number and naming of Library
categories, and ADR-0045 Decision 6 on how an embedded German label is replaced.
Everything else in ADR-0043, ADR-0044 and ADR-0045 stands.

## Context

Two problems surfaced once the complete Swiss Curling corpus was in the Library.

**Discovery had three categories.** *Technique*, *Shotmaking* and *Measured Exercises*
came directly from `ExercisePrimaryFocus`, the value that also decides which runner an
Exercise uses and how a recorded result is validated. Using one value for both meant the
athlete's mental model was pinned to an execution detail: Release Time and Rotation Count
are technique work in a curler's terms, but sat in a third group because the application
measures something during them. Two of the collection's Draw entries — Draw Split Time
and Draw Split-Time Ladder — also stood in the Library as separate Exercises, although
they are variations of how a draw is practised against a target split time rather than
distinct exercises.

**The diagrams were wrong in a way that written instructions cannot compensate for.** The
published images retained the source's German labels, and an English replacement was
painted over each one as an opaque, hand-positioned box. Many boxes did not land on the
label they were meant to cover: Guard 2–6 and Draw 1–4 sat clear of it, Draw 8–12 and
Guard 11 were displaced, and the Softshot series sat above its label — leaving German
fragments, doubled text and, on Draw 12, obscured diagram content. Even a correctly
placed patch was unsafe: on Draw 1 and Draw 3 the German label is *white text straddling
the twelve-foot ring boundary*, so any opaque rectangle there would erase part of a ring
arc and move a visible target-zone edge. Hand-tuning coordinates could not fix that
class of defect, and reusing one guessed rectangle across differently positioned labels
is what produced most of the misses in the first place.

Separately, the inline diagram was capped at `max-h-[70vh]` with `overflow-hidden`, so a
tall setup diagram was silently cropped — the worst possible failure for setup
information, because nothing tells the athlete that something is missing.

## Decision

1. **Discovery is a projection, not a rename.** `src/lib/exercises/discovery.ts`
   introduces `ExerciseDiscoveryCategory` with exactly two values, **Technique** and
   **Shotmaking**, derived from the existing immutable `primaryFocus`: `shotmaking` maps
   to Shotmaking, everything else to Technique. `primaryFocus` keeps its full execution
   meaning — runner selection, required protocols, attempt and completion rules,
   validation, and every snapshot already written. A result recorded as `measured` stays
   `measured` in persistence and in cloud validation; it merely displays under Technique.
   No persistence migration is introduced to rename a visible category.
2. **One category source for every discovery surface.** Library grouping, the category
   filter, Exercise badges, detail and setup copy, the Training Plan picker and the plan
   step summary all use `exerciseDiscoveryCategory` and
   `exerciseDiscoveryCategoryLabel`. `exerciseFocusLabel` is removed, so "Measured"
   cannot reappear as a visible category through a stray call site.
3. **Release Time and Rotation Count are discovered under Technique** and keep their
   existing execution exactly: Release Time opens the Fixed/Variable/Blind timing runner,
   Rotation Count keeps its required Rotation Count protocol, actual measurement entry,
   validation and completion rules in both Solo and Team. Release Point and Release Gates
   remain unscored observation Exercises. No technique score and no new runner is added.
4. **Draw Split Time and Draw Split-Time Ladder are retired from discovery, not deleted.**
   `RETIRED_DISCOVERY_EXERCISE_IDS` removes them from the Library and from new plan-step
   selection only. Their Exercise identities, every published Version, their diagram
   assets, any saved plan step, any active run and any recorded or cloud-restored result
   remain fully resolvable and executable. Resolving a *stored* version id goes through
   `findExerciseVersion`, which knows nothing about discovery. No plan step is silently
   replaced or stripped, and no variation-selection subsystem is introduced here.
5. **The active catalog offers 39 choices** — 4 Technique and 35 Shotmaking — from 41
   current Exercise identities.
6. **A German source label is removed from the image, not covered.**
   `scripts/generate_swiss_curling_diagrams.py` redacts the source PDF's text objects
   without touching any line art, then renders the exercise panel at the established
   crop. The published image therefore contains no foreign-language text at all, and the
   English label is drawn on top with **no background**, so a label can no longer hide a
   stone, an arrow or a target-zone boundary.
7. **Label geometry is measured, never estimated.** The same script emits the exact
   normalised box each removed label occupied into the generated
   `src/lib/exercises/swissCurlingDiagramLabels.ts`, together with the callout rectangle
   the source drew around it where there is one. Content modules supply only the English
   wording; `sourceDiagramLabel` composes position, type size and text colour from the
   measurement and **throws** for an unknown asset or label rather than guessing. One
   rectangle can no longer be reused across two differently positioned labels.

   A framed label is centred in its **callout**, not on the German glyph run. English
   wording is rarely the same length as the German it replaces, and centring on the glyph
   run pushes that difference outward: on Draw Exercise 12 it put "Stone 2: Come-around"
   a fraction of a pixel past the left edge of the image, where the diagram wrapper clips
   it. The label is also painted in the source's own typeface (Arial, with
   metric-compatible fallbacks), because a measured box only means what it says if the
   text is set in the metrics it was measured from.
8. **A corrected diagram is new content, and nothing cached is ever thrown away.** Every
   diagram that carried German text is republished under the next version of its asset id,
   inside a new immutable Exercise Version with a new diagram id. Previously published
   bytes and Versions are never rewritten. Superseded asset ids stay registered and
   fetchable, because a historical Exercise Version snapshot — held by a saved Training
   Plan step or a recorded result — references exactly those bytes.

   Preload therefore fetches the current ids and **evicts nothing**. An earlier draft of
   this decision released superseded entries to keep the cached corpus small; that was an
   unapproved trade of saved-plan availability for cache size, and it was wrong: deleting
   a superseded entry takes a diagram the athlete already had offline and makes it
   unavailable at the rink, which is the exact failure the cache exists to prevent.
   Preload is additive and idempotent, so repeated mounts, an offline mount and a failed
   fetch all leave what is already cached untouched. Regenerating an asset that already
   exists on disk is refused by the script.
9. **The inline diagram is never cropped, and the enlargement is genuinely modal.**
   `ExerciseRestrictedSourceImage` shows the whole image scaled to the column, and offers
   an *Enlarge Diagram* action that opens the same diagram in a dialog at twice the column
   width, scrollable on both axes, with a close control that sits outside the scrolling
   area. Readability comes from the enlargement, not from asking the athlete to read
   microscopic text.

   Because the dialog declares `aria-modal`, it behaves like one: Tab and Shift+Tab cycle
   between the close control and the scroll area instead of walking into the page beneath
   — which, when the diagram is previewed inside the Training Plan step editor, otherwise
   reached that editor's own controls while the overlay still covered them. The scroll
   area is a focus stop so the diagram can be panned from the keyboard, Escape closes only
   the enlargement and leaves the parent editor and its draft intact, and closing returns
   focus to the *Enlarge Diagram* control that opened it. This is scoped to this dialog;
   no application-wide modal behaviour changed.
10. **Release Gates keeps its setup and gains a legible diagram.** In Version 2,
    "Direction of travel" came from the travel arrow, which places its label at the
    arrow's midpoint — exactly between and across the two gate lines. Version 3 makes it
    an authored label above the sheet, moves both gate labels clear, and annotates the
    stated ≈30 cm separation between the gates instead of folding it into a gate's name.
    The setup and the diagram's schematic nature are unchanged.

## Consequences

- The Library reads in curling terms rather than in implementation terms, and Release
  Time is reachable both under Technique and through search.
- Historical data is untouched by design: the projection is computed, never stored, so
  there is nothing to migrate and nothing that can be corrupted by presenting an old
  snapshot under a new category.
- The catalog now carries 80 Exercise Versions for 41 identities. That is the cost of
  never rewriting a released Version, and it is what keeps an existing plan step or
  result resolving to the content it actually recorded.
- The published diagram corpus roughly doubles on disk (about 2.0 MB for both revisions);
  static hosting affords that. A browser upgrading from the previous release keeps its
  cached copy of the old corpus *and* gains the new one, because both are genuinely
  referenced — the old by whatever historical snapshots that athlete has saved. A fresh
  install caches only the current set, roughly 890 KB before Data URL encoding, against
  about 1.28 MB for the previous corpus, because a redacted, palette-quantised render is
  smaller than the original crop. A cache write that hits a quota limit is already a
  normal, visible, non-fatal outcome, and it never removes anything already stored.
- Regenerating a diagram requires the licensed source PDF, which is deliberately not
  committed. The script takes its path as an argument and asserts the German text it
  expects to find, so a changed source fails loudly instead of moving a label silently.
- A future variation model (practising an existing Draw against a target split time) is
  still needed to give the two retired entries a home in discovery. Until then they are
  reachable only through content an athlete already saved.

## Rejected alternatives

- **Rename `primaryFocus` to the new categories.** It is snapshotted into results, plan
  steps and cloud records, and it drives runner selection and validation. Renaming it
  would either rewrite history or require a broad persistence migration to change a
  visible label.
- **Keep three categories and just move Release Time.** Leaves the athlete's grouping tied
  to an execution detail and keeps a category whose name describes the application rather
  than the sport.
- **Delete the two retired Exercises.** Discards user data and would break a saved plan.
- **Re-tune the opaque overlay coordinates.** Cannot work where the source label is white
  text on top of ice-sheet geometry, and leaves every future label one estimate away from
  the same defect.
- **Redraw the diagrams.** Would replace attributed Swiss Curling content with
  application-authored sporting drawings, which is neither approved nor faithful.
- **Evict the superseded revision to keep the cached corpus small.** Implemented first,
  then withdrawn: it makes a diagram an athlete already had offline disappear the moment
  the application starts, and "it will be re-downloaded on demand" is worth nothing at a
  rink with no signal. Saved-plan availability outranks cache size.
- **Shrink an English label until it fits.** Below the source's own type size a diagram
  label stops being readable on a phone. Re-wrapping onto the lines the source label
  itself used, and centring in the callout the source drew, fits the text without making
  it smaller.
