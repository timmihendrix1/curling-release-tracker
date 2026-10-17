# Platform Navigation &amp; Home Experience

&gt; Product Vision Document

&gt;

&gt; This document defines the long-term navigation model and Home experience of the Curling Performance Platform.

&gt;

&gt; The navigation should support the product's evolution from a local single-athlete training application into a complete performance platform for athletes, coaches, teams and connected hardware without requiring structural redesign.

---

# Implementation Status (first vertical slice)

The current primary navigation is **Home / Train / Analyze / Settings**. Assessments
are an entry within Train (approved 2026-10-09; see `DESIGN_SYSTEM.md`, House rink-side
refinement). The internal `assess` view remains for recovery and guard compatibility;
Assessment Runs, templates, capture ownership and comparisons remain independent of
Training Sessions. The older five-section target model below is historical context.

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
- **Train offers Exercises, Training Plans and Assessments** — no new
  navigation item for either: `TrainLanding.tsx` offers **Exercises** (the default)
  and **Training Plans**, with **Assessments** opening the guarded assessment view.
  - **Profile-owned mixed Training Plans are implemented**, per
    `docs/TRAINING_SYSTEM_AND_PLANS.md` and `docs/SYSTEM_ARCHITECTURE.md`'s "Training
    Plans" section.
  - **The Exercise Library and Solo Stage B are implemented** for 41 curated Standard
    Exercise identities, of which 39 are offered in active discovery under two
    categories — **Technique** (4) and **Shotmaking** (35). This includes structured
    Ice Sheet diagrams and public, offline-capable delivery of all 37 approved Swiss
    Curling source diagrams. Technique and Shotmaking use Profile-owned Solo execution;
    Release Time — a Measured Exercise discovered under Technique — opens the existing
    Fixed/Variable/Blind setup and runner as its nested execution
    path. One-device Team Exercise execution is implemented;
    Team-plan orchestration remains planned. See
    `docs/EXERCISE_LIBRARY_AND_EXECUTION_SPECIFICATION.md` (the
    authoritative product/domain source), `docs/SYSTEM_ARCHITECTURE.md`'s "Exercise
    Library" section, and `docs/adr/0030`.
- **Teams is implemented** and appears on Home as an "Available now" capability with a
  direct Manage action into Team administration. **Coach** and **Schedule** remain
  visually secondary "Coming soon" placeholders; neither has an implemented coaching
  or scheduling data model.
- **Athlete Experience** (Personal / Coach Guided / Team Training) is described below
  as a concept but has no selection UI, persistence, or Home-branching behavior yet.
- **Home's implemented information hierarchy** follows the approved House direction
  in `DESIGN_SYSTEM.md`:
  - The stable House header shows **Your training.** with **Curling Performance**
    above a single primary current-training surface.
  - An existing training shows a factual recorded-stone count and **Resume training**.
    A configured training remains resumable before its first stone; the empty
    automatically-created Session instead offers **Start Training**. Team execution
    takes precedence when it is the Train destination, without borrowing Solo counts.
  - **Recent training** lists the two newest archived Sessions. **See all** opens
    Analyze; rows do not imply an unimplemented direct-detail action.
  - Active Assessments retain their separate **Resume Assessment** action.
  - **Teams & devices** groups supporting controls in a disclosure. Team **Manage**
    remains available, and **Manage devices** opens Settings. Home makes no claim
    about the current hardware connection. Schedule and Coach remain planned.
  - The Home heading retains **Curling Performance**. All four destinations share
    the same sync-row and House-header geometry; account management is below the Settings header.
  - Shared navigation uses four labeled destinations and retains existing guards.
    Its floating mobile surface accommodates narrow screens and safe-area spacing.

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

### Session completion and active navigation

Complete Session returns directly to the Train landing after acknowledged archiving,
with a brief saved/empty notice. It does not insert a finish screen. Active exercises
have no Assessment-start shortcut; the Train landing remains the entry for new Assessments.
