# Exercise diagram audit — 2026-09-10

Verification record for ADR-0046's diagram correction. Every current Swiss Curling
diagram was inspected **as rendered by the application**, not as a PNG or as overlay
metadata.

## How it was verified

- A Playwright pass drove the real Train → Exercises flow, opened all 39 discoverable
  Exercise details in turn, and captured the rendered `figure` for each at **320 px**,
  **390 px** and **1280 px**, plus the page's horizontal-overflow state at each width.
  No diagram produced horizontal overflow at any width.
- The two Exercises retired from discovery still have current diagrams, so they were
  captured through the path an athlete actually has: a saved Training Plan step's
  "View setup and diagram" preview. Both render correctly, which is also asserted by the
  permanent `keeps a saved plan whose Exercise was retired from discovery fully usable`
  scenario in `tests/e2e/training-plans.spec.ts`.
- The **enlarged** state was captured top and bottom for a representative set spanning
  every source-image label pattern: a multi-line callout on a white box (Guard 10), four
  stacked callouts (Draw 12), a white label across a ring boundary (Draw 1), a three-line
  tinted alternative-zone block (Softshot 1) and a right-hand callout (Draw 8/9). Release
  Gates is a structured platform diagram and has **no** enlargement action — its SVG
  already scales to the column and is never cropped — so it was verified inline only.
- Representative Library, detail, setup and plan-preview surfaces were included: the
  grouped Library list, every Exercise detail, the plan step editor's setup/diagram
  preview, and the Release Gates setup instructions (which state the same ≈30 cm the
  diagram now annotates).
- Rendered label widths were measured in the browser from the **painted** text extent,
  not from the positioning box: a label is centred with `whitespace-pre` and can paint
  outside its own box, and the diagram wrapper clips at the image edge, so neither
  metadata bounds nor document-level horizontal overflow can see a clipped label. Three
  corrections came out of that measurement:
  - Guard 10 and Guard 11's move-aside note exceeded its drawn callout by about 2 % and
    was re-wrapped from two lines to three.
  - Draw 8 and Draw 9's "Maximum gap between …" exceeded its callout by about 3 px on
    each side and was re-wrapped onto the four lines the source label itself used.
  - Draw 12's "Stone 2: Come-around" painted 0.2–0.3 px past the left edge of the image
    at 320, 390 and 1280 px, and was clipped there. Framed labels are now centred in the
    callout rectangle the source drew rather than on the German glyph run, and every
    label is painted in the source's own typeface so the measured boxes mean what they
    say.

  After the corrections, across 120 measurements (every label × three widths) the closest
  any label comes to the image edge is 1.4 px **inside** it, and no label of the 24 framed
  ones crosses its callout.
- Automated checks that back the visual pass live in
  `src/lib/exercises/__tests__/diagramLabels.test.ts`: every current diagram references a
  current asset id, carries exactly one English label per removed German label, places
  each from measured geometry, declares no background, and shows no German text.
  Rendered clipping is guarded separately by
  `no diagram label is painted outside its image at 320 / 390 / 1280 px` in
  `tests/e2e/exercise-library.spec.ts`, which measures painted text in a real browser;
  both it and the enlargement's focus-containment test were confirmed to fail against the
  pre-correction behaviour.

## Findings

No German fragment, clipped label, hidden stone, displaced label or misleading target
area remains in any current diagram. Two observations, neither a defect:

- **Next.js development indicator.** In `next dev` the framework's floating badge sits
  over the bottom-right of the viewport and therefore over part of a diagram or the
  enlargement's Close control. It does not exist in a production build.
- **English is wider than German.** A replacement label that sits directly on the ice
  (for example “Target zone” for *Zielzone*) is wider than the text it replaces, so it
  extends symmetrically over adjacent empty ice. Such labels have no callout to cross and
  no background, so they cannot hide a stone, an arrow or a zone boundary; every case was
  measured and checked visually at all three widths, and none reaches the edge of its
  image. Labels the source *did* frame are centred in that frame and stay inside it.

## Per-diagram record

“Source label” is the exact text removed from the image; a *(white)* English label
reproduces a source label that was white over the house rings.

| Source | Page | Exercise | Current asset | Source label removed | English label | Correction |
| --- | --- | --- | --- | --- | --- | --- |
| Guard Exercise 1 | 8 | Guards in Front of the House | `swiss-curling-guard-exercise-1-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Guard Exercise 2 | 9 | Guards into the Mixed Doubles Position | `swiss-curling-guard-exercise-2-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Guard Exercise 3 | 10 | Guards into the Left Mixed Doubles Zone | `swiss-curling-guard-exercise-3-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Guard Exercise 4 | 11 | Guards into the Right Mixed Doubles Zone | `swiss-curling-guard-exercise-4-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Guard Exercise 5 | 12 | Guard Before, Then Beyond the Mixed Doubles Zone | `swiss-curling-guard-exercise-5-v2` (v2) | *Zielzone*<br>*Zielzone* | “Target zone 2”<br>“Target zone 1” | German text removed at source; 2 English labels placed from measured geometry |
| Guard Exercise 6 | 13 | Guard Beyond, Then Before the Mixed Doubles Zone | `swiss-curling-guard-exercise-6-v2` (v2) | *Zielzone*<br>*Zielzone* | “Target zone 1”<br>“Target zone 2” | German text removed at source; 2 English labels placed from measured geometry |
| Guard Exercise 7 | 14 | Matching-Depth Corner Guards | `swiss-curling-guard-exercise-7-v1` (v1) | — (sequence numerals only) | — | No embedded text; asset unchanged |
| Guard Exercise 8 | 15 | Short, Then Long Corner Guard | `swiss-curling-guard-exercise-8-v1` (v1) | — (sequence numerals only) | — | No embedded text; asset unchanged |
| Guard Exercise 9 | 16 | Long, Then Short Corner Guard | `swiss-curling-guard-exercise-9-v1` (v1) | — (sequence numerals only) | — | No embedded text; asset unchanged |
| Guard Exercise 10 | 17 | Eight Guards, Progressively Longer | `swiss-curling-guard-exercise-10-v3` (v3) | *Stein nach Stillstand jew eils als Markierung auf die Seite legen* | “After each stone / stops, move it aside / as a marker.” | German text removed at source; 1 English label placed from measured geometry |
| Guard Exercise 11 | 18 | Eight Guards, Progressively Shorter | `swiss-curling-guard-exercise-11-v2` (v2) | *Stein nach Stillstand jew eils als Markierung auf die Seite legen* | “After each stone / stops, move it aside / as a marker.” | German text removed at source; 1 English label placed from measured geometry |
| Draw Exercise 1 | 20 | Draws into the House, Outside to Inside | `swiss-curling-draw-exercise-1-v2` (v2) | *Zielzone* | “Target zone” *(white)* | German text removed at source; 1 English label placed from measured geometry |
| Draw Exercise 2 | 21 | Draws into the House, Inside to Outside | `swiss-curling-draw-exercise-2-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Draw Exercise 3 | 22 | Draws Before the T-Line, Outside to Inside | `swiss-curling-draw-exercise-3-v2` (v2) | *Zielzone* | “Target zone” *(white)* | German text removed at source; 1 English label placed from measured geometry |
| Draw Exercise 4 | 23 | Draws Before the T-Line, Inside to Outside | `swiss-curling-draw-exercise-4-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Draw Exercise 5 | 24 | Four Stones in Each House Quarter | `swiss-curling-draw-exercise-5-v2` (v2) | *Haus-Viertel 2*<br>*Haus-Viertel 4*<br>*Haus-Viertel 1*<br>*Haus-Viertel 4* | “House quarter 2”<br>“House quarter 4”<br>“House quarter 1”<br>“House quarter 3” | German text removed at source; 4 English labels placed from measured geometry |
| Draw Exercise 6 | 25 | Come-around from Outside to Inside, Before the T-Line | `swiss-curling-draw-exercise-6-v2` (v2) | — (sequence numerals only) | — | No embedded text; asset unchanged |
| Draw Exercise 7 | 26 | Come-around from Inside to Outside, Before the T-Line | `swiss-curling-draw-exercise-7-v1` (v1) | — (sequence numerals only) | — | No embedded text; asset unchanged |
| Draw Exercise 8 | 27 | Outside-to-Inside Draw, Then Freeze | `swiss-curling-draw-exercise-8-v2` (v2) | *Maximaler Abstand zwischen beiden Steinen: 1 Besenlänge* | “Maximum gap between / the two stones: / one broom length” | German text removed at source; 1 English label placed from measured geometry |
| Draw Exercise 9 | 28 | Inside-to-Outside Draw, Then Freeze | `swiss-curling-draw-exercise-9-v2` (v2) | *Maximaler Abstand zwischen beiden Steinen: 1 Besenlänge* | “Maximum gap between / the two stones: / one broom length” | German text removed at source; 1 English label placed from measured geometry |
| Draw Exercise 10 | 29 | Draw Split Time | `swiss-curling-draw-exercise-10-v2` (v2) | *8 Steine nacheinander immer mit der gleichen Ziel-Split-Zeit spielen* | “Play 8 consecutive stones / with the same target split time.” | German text removed at source; 1 English label placed from measured geometry |
| Draw Exercise 11 | 30 | Draw Split-Time Ladder | `swiss-curling-draw-exercise-11-v2` (v2) | *8 Steine nacheinander immer einer neuen Ziel-Split-Zeit spielen:*<br>*Stein 1: 3.6s Stein 2: 3.7s Stein 3: 3.8s Stein 4: 3.9s Stein 5: 3.9s Stein 6: 3.8s Stein 7: 3.7s Stein 8: 3.6s* | “Play 8 consecutive stones, / each with a new target split time:”<br>“Stone 1: 3.6s / Stone 2: 3.7s / Stone 3: 3.8s / Stone 4: 3.9s / Stone 5: 3.9s / Stone 6: 3.8s / Stone 7: 3.7s / Stone 8: 3.6s” | German text removed at source; 2 English labels placed from measured geometry |
| Draw Exercise 12 | 31 | Guard, Come-around, Freeze and Tap | `swiss-curling-draw-exercise-12-v2` (v2) | *Stein 2: Come-around*<br>*Stein 3: Freeze*<br>*Stein 4: Tap mit Back 8/12 Länge*<br>*Stein 1: Guard Stein 1: Guard* | “Stone 2: Come-around”<br>“Stone 3: Freeze”<br>“Stone 4: Tap to / back 8/12-foot”<br>“Stone 1: Guard” | German text removed at source; 4 English labels placed from measured geometry |
| Softshot Exercise 1 | 33 | Long Draws, Outside to Inside | `swiss-curling-softshot-exercise-1-v2` (v2) | *Zielzone*<br>*Alternative Zielzone 2 Hack-Board*<br>*Alternative Zielzone 1 Out-Hack* | “Target zone”<br>“Alternative / target zone 2 / Hack–Board”<br>“Alternative / target zone 1 / Out–Hack” | German text removed at source; 3 English labels placed from measured geometry |
| Softshot Exercise 2 | 34 | Long Draws, Inside to Outside | `swiss-curling-softshot-exercise-2-v2` (v2) | *Zielzone*<br>*Alternative Zielzone 2 Hack-Board*<br>*Alternative Zielzone 1 Out-Hack* | “Target zone”<br>“Alternative / target zone 2 / Hack–Board”<br>“Alternative / target zone 1 / Out–Hack” | German text removed at source; 3 English labels placed from measured geometry |
| Softshot Exercise 3 | 35 | Soft Take-out on the Centre Line at the Back 12-Foot | `swiss-curling-softshot-exercise-3-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Softshot Exercise 4 | 36 | Soft Take-out on the Centre Line at the Back 8-Foot | `swiss-curling-softshot-exercise-4-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Softshot Exercise 5 | 37 | Soft Take-out on the Centre Line at the T-Line | `swiss-curling-softshot-exercise-5-v3` (v3) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Softshot Exercise 6 | 38 | Soft Take-out on the Centre Line at the Front 8-Foot | `swiss-curling-softshot-exercise-6-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Softshot Exercise 7 | 39 | Soft Take-out on the Centre Line at the Front 12-Foot | `swiss-curling-softshot-exercise-7-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Softshot Exercise 8 | 40 | Soft Take-out at 8-Foot Width, Back 12-Foot | `swiss-curling-softshot-exercise-8-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Softshot Exercise 9 | 41 | Soft Take-out at 8-Foot Width, Back 8-Foot | `swiss-curling-softshot-exercise-9-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Softshot Exercise 10 | 42 | Soft Take-out at 8-Foot Width on the T-Line | `swiss-curling-softshot-exercise-10-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Softshot Exercise 11 | 43 | Soft Take-out at 8-Foot Width, Front 8-Foot | `swiss-curling-softshot-exercise-11-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Softshot Exercise 12 | 44 | Soft Take-out at 8-Foot Width, Front 12-Foot | `swiss-curling-softshot-exercise-12-v2` (v2) | *Zielzone* | “Target zone” | German text removed at source; 1 English label placed from measured geometry |
| Softshot Exercise 13 | 45 | Soft Shot Around a Centre Guard | `swiss-curling-softshot-exercise-13-v1` (v1) | — (sequence numerals only) | — | No embedded text; asset unchanged |
| Softshot Exercise 14 | 46 | Soft Shot Around a Corner Guard | `swiss-curling-softshot-exercise-14-v1` (v1) | — (sequence numerals only) | — | No embedded text; asset unchanged |

## Structured platform diagrams

| Exercise | Current diagram | Correction |
| --- | --- | --- |
| Eight Guards, Progressively Longer (historical Version 2) | `eight-guards-progressively-longer-diagram-v1` | Unchanged; superseded by the source diagram from Version 3 onward |
| Release Gates | `release-gates-diagram-v3` | “Direction of travel” moved off the two gate lines into its own authored label; both gate labels given clear space; the stated ≈30 cm separation annotated between the gates |

Release Point, Release Time and Rotation Count declare no diagram, so there is nothing
to audit for them.
