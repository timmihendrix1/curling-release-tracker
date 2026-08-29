# ADR-0044: Cleared Exercise diagrams are public, cache-first assets and Training Plans select from the Exercise Library

## Status

Accepted and implemented.

## Context

Swiss Curling has cleared the three initial Shotmaking diagrams for every application
user. The previous one-Team delivery restriction therefore no longer represents the
product's permission scope. At the rink, a diagram is also essential setup information:
an athlete who has opened the app online must not lose it when connectivity disappears.

The Training Plan editor previously exposed Exercise titles in a native select. That
required the athlete to know a title before they could discover its goal or setup, and
the editor used a separate top-level choice for Release Time even though Release Time
is a Measured Exercise in the same Library.

## Decision

1. The current versions of Guard Exercise 10, Draw Exercise 6 and Softshot Exercise 5
   declare `scope: "public"` and `publicDeliveryPermitted: true`. Each permission change
   creates a new immutable Exercise Version; historical restricted versions are not
   rewritten.
2. The three versioned PNGs are delivered from `public/exercise-diagrams/`. A generic
   `ExerciseAssetResolver` validates the allowlisted asset id, exact PNG response and a
   two-megabyte limit, converts the image to a Data URL and stores it through the
   application `StorageAdapter` under one key per immutable asset id.
3. Resolution is cache-first. `TrackerApp` preloads all three diagrams after mount, so
   the athlete does not need to open every Exercise while online. A later offline load
   reads the stored Data URL without attempting a network request. Download, storage or
   inspection failure remains a visible unavailable state and never breaks Exercise
   instructions.
4. ADR-0023's restricted resolver and private route remain a valid boundary for future
   genuinely restricted content, but they are no longer the production path for these
   three assets.
5. Diagram captions stay beside the image. The full Exercise source is shown once as a
   compact footer at the bottom of the detail view; the former prominent provenance
   disclosure is removed. Structured provenance remains in the immutable content model.
6. Adding or changing a Training Plan step opens one catalog-driven picker. It starts
   with Technique, Shotmaking and Measured Exercises; supports cross-category search;
   shows title, goal and classification; and can preview setup and diagram before the
   athlete selects the exact immutable Exercise Version. Edit uses the same picker.
7. Release Time appears under Measured Exercises and, once selected, opens the existing
   Fixed/Variable/Blind configuration. There is no second timing flow.
8. While a Release Time plan step is active, its configured shot count remains its
   completion rule. The active screen shows the remaining stones, hides `Start New
   Session`, and replaces that status with `Continue to Next Step` when the count is
   reached. This works when Release Time is between two other Exercise steps.

## Consequences

- The diagrams are intentionally publicly addressable; UI hiding is not treated as an
  access-control mechanism.
- Offline availability is guaranteed after one successful online preload in that
  browser/Profile environment. A device that has never downloaded the application
  cannot obtain new bytes while already offline.
- A new diagram revision needs a new asset id and Exercise Version, preventing stale
  cached bytes from being mistaken for newer content.
- The plan editor scales with Library growth without duplicating Exercise descriptions
  or building an Exercise-specific selector.
