# Platform Navigation &amp; Home Experience

&gt; Product Vision Document

&gt;

&gt; This document defines the long-term navigation model and Home experience of the Curling Performance Platform.

&gt;

&gt; The navigation should support the product's evolution from a local single-athlete training application into a complete performance platform for athletes, coaches, teams and connected hardware without requiring structural redesign.

---

# Implementation Status (first vertical slice)

This document describes the long-term, five-section navigation model
(Home / Train / Assess / Analyze / Settings). The first implemented slice
deliberately narrows this:

- **Home, Train, Assess, Analyze, and Settings are all implemented** as real, active
  navigation items — see `docs/SYSTEM_ARCHITECTURE.md`'s "Platform Navigation" section,
  `docs/adr/0009`, and `docs/adr/0011` for Assess specifically.
- **Assess became a real, active navigation item in Phase B** (the Release Time Core
  Assessment v1 execution flow): `AssessScreen.tsx` drives the full Landing → Overview
  → Guided Introduction → Threshold/Setup → Warm-up → Scored Execution →
  Pause/Resume/Abandon → Completion Summary flow, on top of the domain and
  local-persistence foundation built in Phase A (`src/lib/assessment/` — see
  `docs/SYSTEM_ARCHITECTURE.md`'s "Assessments" section, `docs/adr/0010`, and
  `docs/adr/0011`).
- **The full Result screen, Assessment history/detail views, and Analyze integration
  (Phase C) are now implemented**: the Completion Summary's "View Full Results" action,
  `AssessmentLanding`'s "Latest Completed Assessment" card, and a new Assessments tab
  under Analyze (`AssessmentAnalyze.tsx`) all open `AssessmentResultScreen.tsx` for a
  given completed/incomplete run — see `docs/SYSTEM_ARCHITECTURE.md`'s "Assessments"
  section for the full breakdown. Not yet built: benchmarking, a synthetic overall
  score, athlete-level classification, a Custom Assessment editor, coach/team
  workflows — see `docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s "Assessment Framework"
  section. The Assessment product and domain model this screen implements is defined in
  `docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md` — read it before any further
  Assess implementation work, alongside this document.
- **Train now has three entry paths, all inside the existing `"train"` view** — no new
  navigation item for any of them: `TrainLanding.tsx` offers **Quick Start**
  (unchanged, and still the default), **Exercises**, and **Training Plans**.
  - **Training Plans (Version 1) is implemented**, per
    `docs/TRAINING_SYSTEM_AND_PLANS.md` and `docs/SYSTEM_ARCHITECTURE.md`'s "Training
    Plans" section.
  - **The Exercise Library and Solo Stage B are implemented** for three curated Standard
    Exercises, including the structured Ice Sheet diagram renderer. Technique and
    Shotmaking use Profile-owned Solo execution; measured Release Time reuses the
    existing Quick Start runner. Team execution remains planned. See
    `docs/EXERCISE_LIBRARY_AND_EXECUTION_SPECIFICATION.md` (the
    authoritative product/domain source), `docs/SYSTEM_ARCHITECTURE.md`'s "Exercise
    Library" section, and `docs/adr/0030`.
  - Quick Start remains an entry mechanism, not a synonym for Release Time.
- **Coach and Team** appear on Home as visually secondary "Coming soon"
  placeholders, per this document's own Home structure below.
- **Schedule** likewise appears as "Coming soon" — no scheduling/calendar data model
  exists.
- **Athlete Experience** (Personal / Coach Guided / Team Training) is described below
  as a concept but has no selection UI, persistence, or Home-branching behavior yet.
- **Home's implemented information hierarchy** (first-review UX pass) narrows this
  document's Home Structure section further, to keep Home compact and
  athlete-centered rather than a long list of equally-weighted cards:
  - **Greeting** is a plain, time-of-day heading directly above Today's Plan — not a
    standalone full-width card. It carries no invented name personalization.
  - **Quick Access** was not built as its own section — "Start Training" already lives
    in Today's Plan, and the only other quick action (opening Analyze) is a secondary
    "View Analyze" control inside Training Overview instead, so a session-history
    figure and its natural next action sit together.
  - **Performance Snapshot** is implemented as **Training Overview** — the same
    Last Training / Total Sessions facts, under an honestly-scoped name, since these
    are activity data, not validated performance metrics. "Performance Snapshot" (as a
    visible title) does not appear anywhere in the current implementation.
  - **Schedule, Coach, and Team** are grouped into one compact "Coming next" section
    (`FutureCapabilitiesSection` + `FutureCapabilityItem`) rather than three separate
    full-width "Coming soon" cards — same non-interactive, visually secondary
    guarantee as before, just less vertical weight. A second, small cleanup pass
    replaced three individually-boxed tiles with one shared, dashed-border
    container holding three compact rows (divided by a subtle line on mobile,
    by columns at the `sm` breakpoint and above) — three separately-bordered
    boxes read as fragmented even when stacked; one shared container reads as a
    single, quieter section.
  - **Devices** keeps its own card, positioned between Training Overview and Coming
    next: more prominent than a "Coming soon" placeholder (it's real, current
    behavior), less prominent than Today's Plan. Its supporting copy reads
    "External timing systems will be supported here." — deliberately not "...will
    appear here when connected", which could be read as implying a connection is
    already possible today.
  - The app-wide title shown above the navigation is currently **"Curling
    Performance"** with the subtitle "Train and understand your performance." — a
    provisional, visible-only product name (see `AppHeader.tsx`), not a final
    branding decision and not reflected in package/PWA metadata. The subtitle
    deliberately names only capabilities that are actually available today (Train,
    Analyze); Assess is not mentioned here until it exists as a real, usable
    capability (see the Assess bullet above).

Treat every section below as the target model this implementation is working toward,
not as a description of what exists today — check `SYSTEM_ARCHITECTURE.md` for current
state.

---

# Purpose

The navigation should not be organised around pages or data.

Instead, it should reflect the three core intentions an athlete has when opening the platform:

- I want to train.

- I want to measure my current performance.

- I want to understand my performance.

These intentions become the foundation of the entire platform.

---

# Product Philosophy

The platform revolves around a continuous performance cycle.

```

Train

   ↓

Assess

   ↓

Analyze

   ↓

Train

```

Every major feature should naturally belong to one of these three stages.

If a new feature does not clearly support Train, Assess or Analyze, it should be questioned whether it belongs in the core product.

---

# Design Principles

## Athlete First

The platform should always feel like a training tool.

Analytics exist to improve training.

Training does not exist to generate analytics.

---

## Daily Companion

The application should become something athletes open before every practice.

The Home screen should answer:

&gt; "What should I do today?"

rather than

&gt; "What does the application do?"

---

## Progressive Complexity

New users should only see functionality that is currently available.

As coaches, teams, devices and additional modules become available, they naturally appear within the existing navigation.

The navigation itself should not require redesign.

---

## Platform First

The navigation should be designed for the long-term vision rather than the current MVP.

Future capabilities should integrate into the existing structure instead of creating entirely new navigation concepts.

---

# Navigation Model

```

Home

Train

Assess

Analyze

Settings

```

---

# Home

The Home screen is **not** one of the platform modules.

Its purpose is to answer:

&gt; "What is relevant today?"

Home should never become an analytics dashboard.

It should guide today's training.

---

# Home Structure

## Greeting

Examples

Good morning, Tim

Ready for today's training?

---

## Today's Plan

This is the primary section of the Home screen.

Examples

```

Today's Plan

No scheduled session.

Start whenever you're ready.

```

or

```

Today's Plan

Variable Weight

Assigned by Coach

18:00 Today

```

or

```

Today's Plan

Official Performance Assessment

Saturday

```

The platform should never prescribe training.

If no plan exists, the athlete remains in control.

If a coach or calendar provides a plan, it is displayed here.

---

## Quick Access

Fast access to the three core workflows.

Examples

- Start Training

- Start Assessment

- Open Analytics

This section provides navigation rather than information.

---

## Performance Snapshot

A very small overview.

Examples

- Last Training

- Last Assessment

- Recent Improvement

This is intentionally not a dashboard containing dozens of metrics.

Detailed analysis belongs under Analyze.

---

## Schedule

Current MVP

```

Coming soon

```

Future examples

- Planned training sessions

- Coach assignments

- Team practice

- Training calendar

---

## Devices

Current MVP

```

Manual Timing

```

Future examples

- Brower Connected

- Sensor Connected

- Device Battery

- Synchronisation Status

---

## Coach

Initially hidden or shown as "Coming soon".

Future examples

- Coach feedback

- Assigned training

- Messages

- Performance reviews

---

## Team

Initially hidden or shown as "Coming soon".

Future examples

- Team activity

- Shared training

- Team analytics

- Upcoming team sessions

---

# Train

Purpose

Improve performance.

Train is where athletes perform their daily practice.

Examples

- Fixed Weight

- Variable Weight

- Blind Weight

- Future Rotation Training

- Future Direction Training

- Coach Sessions

Responsibilities

- Create training sessions

- Configure training blocks

- Capture timing

- Review the current training session

Historical analytics should not dominate this section.

---

# Assess

Purpose

Measure current performance under a standardised protocol.

Assess is intentionally different from training, and functionally separate from Train —
a distinct domain, not a Training mode or a special kind of Training Session.

Training asks:

&gt; How can I improve?

Assessment asks:

&gt; Where do I currently stand?

Assessments should be standardised whenever comparison is important.

The full Assessment product and domain model — purpose, domain concepts, execution
rules, comparison rules and future direction — is defined in
`docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md`. That document, not this one, is
authoritative for Assessment product logic; this section only places Assess within the
platform's navigation and Home experience.

**Status:** Assess should only become visible in navigation once a functional Assessment
flow actually exists — see "Implementation Status" above. The first assessment type
proposed for that flow is **Release Time Core Assessment v1** (see the specification
document); no other assessment type has a concrete proposal yet.

A Baseline Assessment may later become an optional part of a new athlete's first-use
experience (see the specification's "Future: Baseline Assessment"), but it must never be
mandatory for using the platform. Home's Today's Plan may later surface a planned
Assessment the same way it surfaces planned training, once such planning exists — no
assessment recommendation or baseline-derived classification should be implemented before
those rules are validated in the specification.

---

## Official Assessments

Examples

- Release Time Core Assessment v1 (proposed first Official Assessment — see the
  specification document)

- Club Assessment (future)

- National Team Assessment (future)

Official assessments should be fixed and comparable.

---

## Custom Assessments

Future

Coaches or organisations may define custom assessments.

These should remain separate from official assessments.

---

# Analyze

Purpose

Understand performance.

Analyze contains the existing analytics functionality.

Examples

- Session history

- Progress

- Scatterplots

- Boxplots

- Trends

- Bias analysis

- Handle comparison

Analyze explains performance.

It does not perform training.

---

# Settings

Current

- General

- Training

- Analytics

- Export

Future

- Profile

- Devices

- Notifications

- Coach

- Team

- Data

- About

---

# Athlete Experience

The platform should adapt to different workflows rather than skill levels.

During onboarding (or later in Settings), the athlete chooses how they primarily use the platform.

Examples

## Personal Training

The athlete plans their own training.

The platform may offer suggestions.

---

## Coach Guided

Training is primarily planned by a coach.

The platform displays assigned sessions rather than recommending its own.

---

## Team Training

Training mainly happens within a team environment.

Future team functionality becomes more prominent.

The selected experience changes the behaviour of the Home screen rather than unlocking different products.

---

# Authentication

Authentication is intentionally outside the current MVP.

The navigation should nevertheless assume authenticated users in the future.

Potential roles

- Athlete

- Coach

- Team Manager

- Administrator

All roles share the same navigation philosophy while seeing different capabilities.

---

# Workspace Concept

The platform should eventually support multiple workspaces.

Examples

- Personal

- Curling Club Limmattal

- Swiss Curling

- National Team

The active workspace determines

- available athletes

- teams

- coaches

- permissions

- shared analytics

The navigation itself should remain unchanged.

---

# Future Modules

The navigation should naturally accommodate future modules including

- Training Calendar

- Coach Assignments

- Team Management

- Rotation Analysis

- Line &amp; Direction Analysis

- Stone Sensors

- Video Analysis

- Recovery Tracking

- External Timing Providers

- AI Coaching

- Benchmarking

- Performance Reports

without requiring structural redesign.

---

# Success Criteria

A first-time user should immediately understand

- where to begin,

- what today's focus is,

- and where to go depending on their intention.

The three core intentions should always remain obvious:

**Train**

I want to improve.

**Assess**

I want to measure my current level.

**Analyze**

I want to understand my performance.

Every future feature should naturally strengthen one of these three pillars.
