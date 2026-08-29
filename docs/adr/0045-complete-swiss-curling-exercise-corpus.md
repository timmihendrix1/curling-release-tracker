# ADR-0045: The complete Swiss Curling collection is curated through one data-driven public and offline boundary

## Status

Accepted and implemented for the 2026-08-29 Exercise Library expansion.

## Context

ADR-0044 made the first three approved Swiss Curling diagrams public and
offline-capable. The product owner has now approved all 37 Exercises and diagrams in
the supplied *Individual On-Ice Training – Exercise Collection*, version 2.0, for the
same audience. The Library must grow from seven to 41 current Exercises without 34
named UI branches, without weakening immutable Version snapshots and without making
the diagrams unavailable when connectivity is lost.

Two collection entries are measured Draw exercises. Draw Split Time repeats one
backline-to-hog target; Draw Split-Time Ladder changes the target for every stone.
The existing Release Time runner already persists an immutable target per Shot and
supports Fixed Weight plus Variable Weight with Coach / Manual target selection.

The source also contains three internal inconsistencies: Guard Exercise 6 and Guard
Exercise 7 have different levels in the index and page footer, while Softshot Exercise
12 repeats Exercise 8's back-twelve-foot title although its ordered series and diagram
show the front-twelve-foot position.

## Decision

1. The current catalog contains all 37 Swiss Curling Exercises plus the four existing
   platform-curated Exercises: Release Point, Release Gates, Release Time and Rotation
   Count.
2. The 34 new source Exercises are declared as immutable data in
   swissCurlingCorpus.ts. Shared builders supply the generic Shotmaking guidance,
   participation, sweeping, provenance, public diagram distribution and optional
   Rotation Count protocol. Renderers and execution code never branch on a new
   Exercise id.
3. The 32 ordinary additions are Shotmaking Exercises and retain the generic,
   team-defined 0–4 evaluation basis. Source point goals remain descriptive context
   with evaluated false; they are not converted into platform pass/fail rules.
4. Draw Split Time and Draw Split-Time Ladder are Measured Exercises with the required
   Backline–Hog protocol. Protocol semantics route both through the existing Release
   Time runner. The ordinary exercise uses Fixed Weight; the ladder instructs the
   athlete to use Variable Weight with Coach / Manual and the source sequence. No
   separate measurement aggregate or id-specific runner is introduced.
5. Every source diagram has a versioned public asset id and path. The existing three
   v2 ids remain unchanged; the other 34 begin at v1. The same generic resolver
   preloads all 37, validates PNG responses, stores version-keyed Data URLs through the
   existing StorageAdapter, and resolves the cached image before attempting network
   access.
6. Every user-facing Exercise string is English. German labels embedded in source
   images are covered by normalized, data-driven English overlays in the generic
   source-image renderer. Swiss Curling appears once in the compact source footer.
7. The two Guard level conflicts are represented as ranges (3–4 and 4–5), preserving
   both source statements rather than choosing one silently. Softshot Exercise 12 is
   titled Front 12-Foot from its diagram and ordered Level 2–6 series; its source
   metadata records the repeated back-twelve-foot title.

## Consequences

- The Library and Training Plan picker scale through catalog data to 41 current
  Exercises and all three focus groups.
- Existing Exercise Version ids, historical snapshots and the original three public
  asset cache keys remain unchanged.
- The complete public PNG corpus is approximately 1.4 MB before Data URL encoding, so
  the established local cache remains within its intended small-content boundary.
- A future source collection, changed sporting meaning or changed diagram still needs
  a separate rights decision and a new immutable Exercise Version or asset id.
- Exact automated target-sequence setup remains unnecessary: Coach / Manual already
  records the target that actually applied to each ladder stone. The source sequence is
  explicit in setup instructions and the diagram.
