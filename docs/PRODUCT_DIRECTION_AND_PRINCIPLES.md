# Product Direction &amp; Principles



## Core mission

Help curlers improve faster through better training.

Every decision should ultimately contribute to this mission.

If a feature does not improve training quality, coaching quality or athlete development, its priority should be questioned.



## Purpose

This document defines the long-term direction and guiding principles of the Curling Performance Platform.

It is intended to support product decisions, architecture discussions and implementation work.

It is **not** a feature specification, roadmap or technical design document.

Whenever significant product or architectural decisions are made, this document should take precedence over short-term implementation convenience.

---

# Product Vision

Our vision is to build the leading performance platform for curlers.

The platform should help athletes and coaches train with greater intention, capture meaningful data with minimal friction and continuously improve through objective analysis and structured feedback.

The goal is not to build another statistics application.

The goal is to build a platform that connects every important aspect of curling performance into one coherent system.

---

# Why this product exists

The project originated from a real training problem.

Current curling training often relies on isolated tools:

- timing systems

- spreadsheets

- handwritten notes

- videos

- wearable platforms

- subjective memory

These tools rarely work together.

As a result, athletes collect data but struggle to convert it into better training decisions.

The initial Release Time Tracker solves one small but important part of this problem.

It is intentionally the first module of a much larger vision.

---

# Product ambition

The project is developed as a potential commercial software product.

The initial users are individual athletes.

Over time the platform should also support:

- coaches

- teams

- clubs

- performance centres

- national programmes

The architecture should therefore remain extensible without introducing unnecessary complexity today.

---

# Product philosophy

We believe that better training comes from combining multiple perspectives.

Every shot consists of several different layers.

## Intention

What was the athlete trying to do?

Examples:

- Draw

- Takeout

- Handle

- Target weight

- Tactical objective

---

## Perception

What did the athlete think happened?

Examples:

- Estimated release time

- Perceived weight

- Confidence

- Subjective feedback

---

## Measurement

What was objectively measured?

Examples:

- Release time

- Rotation

- Line

- Speed

- Heart rate

---

## Outcome

What actually happened?

Examples:

- Shot success

- Missed line

- Heavy

- Light

- Tactical result

---

## Context

What influenced the shot?

Examples:

- Training block

- Drill

- Fatigue

- Ice conditions

- Equipment

- Competition

These concepts should remain independent.

The platform should avoid merging them simply because today's interface presents them together.

---

# Long-term capability areas

The current application focuses on release-time training.

Future modules may include:

## Training

- Training plans

- Drills

- Session templates

- Goal tracking

## Performance

- Release timing

- Rotation analysis

- Line consistency

- Weight consistency

- Shot consistency

## Coaching

- Coach feedback

- Athlete feedback

- Video review

- Technical observations

## Teams

- Team sessions

- Shared training plans

- Team analytics

- Coach dashboards

## Health

- Apple Health

- WHOOP

- Garmin

- Recovery metrics

## Sensors

- Timing gates

- Stone-mounted sensors

- Camera systems

- Future measurement devices

These represent opportunities rather than commitments.

New functionality should only be introduced when it creates meaningful value.

---

# Product principles

## Solve real athlete problems

Every feature should improve training rather than simply increase functionality.

---

## Minimise training interruption

Capturing data should require as little effort as possible.

Automation should reduce friction without reducing reliability.

---

## Build around the athlete, not around devices

Hardware will change.

Manufacturers will change.

The athlete's training process should remain the centre of the product.

---

## Device independence

The platform should never depend on a specific manufacturer.

For example:

- Brower

- Apple Health

- WHOOP

- Garmin

These are integrations.

They are not part of the core domain.

---

## Preserve information

Whenever practical, preserve raw measurements.

Future analyses may require information that is not currently displayed.

---

## Explainable analytics

Statistics should support coaching decisions.

The platform should favour understandable metrics over opaque scoring systems.

---

## Evolution over perfection

Prefer continuous improvement over premature architecture.

Introduce abstractions only when real use cases justify them.

---

## Data longevity

Athletes invest years into training.

Product evolution should preserve historical data whenever reasonably possible.

---

## Mobile-first, on the ice

The primary usage context is a smartphone in a curler's hand, between shots, at the
rink — not a desk. Every screen, especially data-entry screens, should be designed
first for that context: large touch targets, minimal typing, readable at arm's length,
usable one-handed. Desktop use is secondary.

---

## Minimal interaction between shots

The time between shots during training is short. Capturing a shot's data should take as
few taps and as little typing as the training mode honestly requires — no additional
steps that don't serve the training objective itself (this is why, for example, Blind
Weight doesn't ask for a shot-type classification: it isn't part of what that mode
trains).

---

## Shot data is historically immutable once recorded

A recorded shot's `targetTime`, `releaseTime`, and (for Blind Weight) `predictedTime`
must never change as a side effect of a later action — not a block's target changing,
not a Smart Random range being edited, not a migration. If a value was wrong, correcting
it should be an explicit, visible action on that shot, never an implicit recomputation.
This is what makes changing targets over time (Variable/Blind Weight) safe to build on.

---

## Real training workflows define the UX, not the data model

Design the entry flow around how the training actually happens at the ice (e.g. Blind
Weight's predict → measure → review order exists because that is the real order events
happen in — the player cannot know the actual release time before reading the external
timing system). Do not simplify a flow in a way that would require the app to know
something before it realistically can.

---

## Manual entry and future sensors share one domain flow

Wherever a value might one day arrive from a device instead of a keyboard (most
concretely: the measured release time in Blind Weight), the manual and future automated
paths should be the same domain-level action with different sources, not two different
flows that have to be kept in sync. Manual entry is today's implementation of that
action, not a separate concept from a future sensor.

---

## Target logic stays extensible

New ways of determining a shot's target (new Target Sources, new ranges, new
transition strategies) should be addable without rewriting how targets are stored,
resolved, or judged against. A block's target configuration and a shot's own recorded
target are deliberately kept as separate concepts for exactly this reason.

---

## No fabricated precision

Never ship a default, range, or profile that looks like a validated sporting value but
isn't backed by real data or domain input — an invented number is worse than an
explicit "not available yet", because it's indistinguishable from a real one until
someone trusts it. (This is why Hog-Hog Smart Random stays unavailable rather than
reusing or approximating the Back-Hog range.)

---

## Local-first is a current feature, not a placeholder

The app works fully offline today, with no login and no backend — this is not merely a
"not built yet" gap to route around. It is a real, currently-relied-upon property (an
athlete training in a rink with no signal must not lose functionality). Cloud sync and
accounts, when they arrive, must be additive to this, not a replacement that assumes
connectivity. See `docs/SYSTEM_ARCHITECTURE.md`'s "Local-first today" principle.

---

# Decision framework

Before implementing any feature, ask:

1. Which athlete problem does this solve?

2. Is this part of the core domain or an integration?

3. Does this simplify or complicate future development?

4. Is the abstraction justified today?

5. Will this decision unnecessarily constrain future modules?

6. Does this improve the athlete's training experience?

---

# Future direction

The Release Time Tracker is not the final product.

It is the first building block of a modular Curling Performance Platform.

Future development should expand the platform without requiring fundamental redesign of the existing product.

The objective is sustainable evolution rather than periodic rewrites.

---

# Guidance for implementation

When implementing new functionality:

- Keep the product modular.

- Keep the user experience simple.

- Avoid speculative infrastructure.

- Separate domain concepts from integrations.

- Preserve backwards compatibility whenever practical.

- Prefer clear domain terminology.

- Document important architectural decisions.

- Optimise for long-term maintainability instead of short-term convenience.

Whenever uncertainty exists, choose the solution that keeps future options open while remaining as simple as possible today.