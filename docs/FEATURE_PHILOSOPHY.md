# Feature Philosophy

&gt; This document defines the long-term philosophy for introducing, designing and evolving features within the Curling Performance Platform.

&gt;

&gt; It is intentionally independent of implementation details and technology choices.

&gt;

&gt; Every future feature should align with these principles before design or development begins.

&gt;

&gt; The goal is to build a platform that becomes more capable over time without becoming more complicated.

---

# Purpose

Features are not the product.

The product is the athlete's training experience.

Every feature exists to strengthen that experience.

The platform should continuously become:

- more useful

- more insightful

- more reliable

—not simply larger.

---

# Core Principle

Every feature must improve at least one of the following:

- preparation

- execution

- measurement

- understanding

- long-term improvement

If it does not clearly improve one of these stages, it probably does not belong in the platform.

---

# Athlete First

The athlete is always the primary user.

Every feature should first answer:

&gt; How does this help an athlete train better?

Only afterwards should it answer:

- How does it help coaches?

- How does it help teams?

- How does it help organisations?

The platform should never optimise administrative workflows at the expense of the athlete experience.

---

# Solve Real Problems

Features should emerge from observed training problems.

Not from trends.

Not from technology.

Not because competitors have them.

Questions to ask before building:

- What problem does this solve?

- How frequently does it occur?

- Who experiences it?

- How is it solved today?

- Why is the current solution insufficient?

If the problem cannot be clearly described, the feature is not ready.

---

# Build for Curling

Generic software creates generic experiences.

Every feature should feel purpose-built for curling.

Whenever possible, features should embrace:

- curling terminology

- curling workflows

- curling measurements

- curling coaching methods

- curling training structures

Avoid generic sports abstractions unless they clearly improve extensibility.

---

# One Core Responsibility

Every feature should have one primary responsibility.

Examples:

Training

→ deliberate practice

Assessment

→ standardized measurement

Analyze

→ performance understanding

Coach

→ guidance

Training Plans

→ structured preparation

Cloud Sync

→ continuity

Features should complement each other—not overlap.

---

# Manual First

The platform should always function manually.

Automation should enhance existing workflows.

It should never become mandatory.

Examples:

Automatic timing complements manual entry.

Cloud sync complements local storage.

Coach feedback complements self-analysis.

Manual workflows should always remain available.

---

# Local First — offline-capable after authenticated onboarding

**Corrected 2026-08-24 — see `docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md`
and `docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md` (Accepted;
not implemented). This section previously said the platform should remain fully usable
without accounts; that is no longer the product direction.**

Athletes should own their training. Ownership is Profile-scoped and never transferred by a
team, a coach, or a payer.

Local First means **training must not depend on connectivity**. Once a device has completed
authentication and personal Profile onboarding, the athlete must be able to start, perform,
finish and review supported training with:

- no internet connection

- no paid subscription

An **account and a completed Profile are required** — Free is a tier, not an exemption — and
first authentication and onboarding on a device do need connectivity. What Free includes is
substantial: recording, the athlete's own raw records, export, and cloud persistence of the
structured raw sporting record (the **Free Cloud Core**) with basic restore on a new device.

Cloud functionality should extend the experience, not define it: the cloud makes the record
durable and restorable, and paid tiers sell *derived* analysis — neither may stand between
the athlete and a training session at the rink.

---

# Raw Data is Sacred

Raw measurements are the foundation of the platform.

Derived metrics should always be reproducible from stored raw data.

No feature should overwrite or destroy original measurements.

Every insight should remain explainable.

---

# Explainability

Every calculation should be understandable.

The platform should never produce mysterious scores.

Athletes should always be able to answer:

- What is being measured?

- How was this calculated?

- Why did this result change?

Trust comes from transparency.

---

# AI Assists — It Does Not Replace

Artificial Intelligence should help athletes understand performance.

It should never replace judgement.

AI may:

- explain

- summarise

- identify patterns

- suggest areas for improvement

AI should not:

- invent measurements

- hide uncertainty

- replace coaching decisions

- become a black box

The athlete always remains in control.

---

# Platform Before Integrations

Hardware and external services should connect to the platform—not define it.

Example:

Automatic Timing

is not a Brower feature.

It is an implementation of an External Timing Provider.

Future integrations should reuse the same platform capabilities.

Vendor-specific behaviour should remain isolated.

---

# Extensibility

New features should reuse existing concepts whenever possible.

Avoid creating parallel systems.

Examples:

Assessments use:

- Sessions

- Blocks

- Shots

- Targets

- Analytics

rather than introducing separate measurement models.

The platform should grow by extending its domain—not duplicating it.

---

# Progressive Complexity

The platform should reveal complexity gradually.

Beginners should experience simplicity.

Experienced athletes should discover depth naturally.

Advanced capabilities should emerge through experience rather than configuration.

---

# Data Ownership

Athletes own their data.

The platform should always support:

- export

- backup

- migration

- transparency

No feature should intentionally lock users into the platform.

Trust is more valuable than retention.

---

# Coach Philosophy

Coaches support athletes.

They do not replace them.

Future coaching features should empower discussion rather than prescribe behaviour.

The platform should facilitate collaboration while preserving athlete autonomy.

---

# Team Philosophy

Teams are collections of athletes.

Not the other way around.

Individual performance data belongs to the athlete.

Sharing should always be deliberate and transparent.

Future team functionality should strengthen collaboration without compromising ownership.

---

# Training Philosophy

The platform should encourage deliberate practice.

Not simply more practice.

Features should help athletes:

- define objectives

- execute consistently

- measure accurately

- reflect meaningfully

- improve systematically

More repetitions alone do not create progress.

---

# Assessment Philosophy

Assessments exist to create reliable benchmarks.

Not rankings.

Not gamification.

Not entertainment.

Every assessment should prioritise:

- repeatability

- standardisation

- comparability over time

Reliability is more important than novelty.

---

# Analytics Philosophy

Analytics should answer meaningful questions.

Not maximise available data.

Every new metric should justify its existence by improving decision making.

If a metric cannot influence behaviour, it probably does not belong in the product.

---

# Feature Lifecycle

Every feature should pass through the same lifecycle.

Observe

↓

Understand the problem

↓

Define success

↓

Design

↓

Validate

↓

Implement

↓

Measure adoption

↓

Iterate

Features should never skip validation simply because implementation is easy.

---

# Complexity Budget

Every feature increases complexity.

Therefore every feature must contribute more value than complexity.

Questions before implementation:

- Is this solving a meaningful problem?

- Is there a simpler solution?

- Could this be achieved by extending an existing feature?

- Does this introduce new concepts?

- Does this increase cognitive load?

If complexity grows faster than value, reconsider the feature.

---

# Future Readiness

Every feature should leave room for future evolution.

Avoid decisions that prevent:

- additional sports science metrics

- new timing providers

- wearable integrations

- cloud capabilities

- coach workflows

- AI-assisted analysis

The platform should remain adaptable without frequent architectural redesign.

---

# Product Integrity

The platform should feel like one coherent product.

Not a collection of independent modules.

New capabilities should strengthen the existing experience rather than compete with it.

Whenever a feature introduces a new mental model, terminology or workflow, reconsider whether it truly belongs.

---

# Success Criteria

A feature is successful when it:

- solves a real athlete problem

- integrates naturally into the platform

- reduces friction rather than adding it

- preserves the athlete-first philosophy

- reuses existing concepts where possible

- scales to future needs

- increases insight without increasing confusion

- aligns with the platform's long-term vision

The objective is not to build the most feature-rich curling platform.

The objective is to build the most trusted and effective performance platform for curlers.