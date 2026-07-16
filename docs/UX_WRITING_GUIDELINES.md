# UX Writing Guidelines

## Purpose

This document defines how the application communicates with its users.

The goal is not simply to explain features, but to help athletes understand their training, make better decisions and gain confidence in the data.

All user-facing text should follow these principles.

---

# Core Principles

## Explain, don't overwhelm

The interface should be understandable without requiring external documentation.

Information should appear exactly where it is needed.

Prefer:

- short subtitles

- contextual explanations

- progressive disclosure

- Info buttons for deeper explanations

Avoid long paragraphs directly inside the UI.

---

## Every feature should explain itself

A user should understand:

- what a feature does

- why it exists

- when to use it

- what a good result looks like

without asking another person.

Example:

Instead of:

&gt; Blind Weight

Prefer:

&gt; Blind Weight

&gt;

&gt; Predict your release time before seeing the measured value.

---

## Explain purpose before mechanics

Always answer:

&gt; Why would I use this?

before

&gt; How does this work?

Example:

Poor:

&gt; Random targets are generated automatically.

Better:

&gt; Train your ability to reproduce different weights under changing targets.

&gt;

&gt; Targets are generated automatically.

---

## Progressive disclosure

Only show as much information as necessary.

Hierarchy:

1. Title

2. One-sentence description

3. Optional Info button

4. Detailed explanation

Never expose every explanation permanently.

---

## Be precise

Do not exaggerate.

Never claim more certainty than the data supports.

Avoid:

- proves

- guarantees

- always

- never

Prefer:

- may indicate

- suggests

- could be caused by

- consider checking

---

## Explain observations, not causes

Analytics show patterns.

They do not diagnose technique.

Bad:

&gt; Your release is wrong.

Better:

&gt; This pattern may indicate a systematic bias.

---

## Separate facts from interpretation

Facts:

- Average Error

- Bias

- Standard Deviation

- On Target Rate

Interpretation:

- may indicate fatigue

- may indicate handle differences

- may indicate inconsistent weight control

These must never be mixed.

---

## Short first, detailed second

Every metric and chart should have:

- title

- one-sentence subtitle

- optional detailed explanation

Example:

Bias

Shows whether your shots systematically fall on one side of the target.

ⓘ

---

## Use consistent terminology

Always use the terminology defined in DOMAIN_[GLOSSARY.md](http://GLOSSARY.md).

Do not invent synonyms.

For example:

Always:

- Training Category

- Training Block

- Session

- Measurement Mode

- Handle

- Target Time

Never mix with:

- Mode

- Exercise

- Random Weight

- Weight Type

---

# Information Architecture

## Titles

Titles should be short.

Good:

- Bias

- Consistency

- Target vs Actual

Avoid long titles.

---

## Subtitles

Every chart should explain its purpose in one sentence.

Example:

Shows how closely actual release times match different target times.

---

## Info Buttons

Use Info buttons when:

- interpretation requires explanation

- misunderstanding is likely

- mathematical definitions matter

Do not use them for trivial UI actions.

---

## Empty States

Never display:

"No data"

Instead explain:

- why nothing is shown

- what the user needs to do

Example:

Train at least one Variable Weight block to see this chart.

---

## Warnings

Warnings should be rare.

Only warn when the interpretation could be misleading.

Example:

Thresholds vary across the selected blocks.

---

# Tone of Voice

The application should sound:

- calm

- factual

- encouraging

- professional

It should never sound:

- sarcastic

- patronising

- overly excited

- overly dramatic

---

## Coaching Style

The application supports coaching.

It does not replace a coach.

Prefer:

"This pattern may indicate..."

over

"You need to..."

---

# Assessment Language

**[Implemented — Release Time Core Assessment v1 execution flow, Phase B.]** See
`docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md` for the full Assessment model and
`src/lib/assessmentContent.ts` for the actual copy used throughout the flow. The
general principles above (separate facts from interpretation, prefer "may indicate"/
"suggests" over certainty) already apply to Assessment copy. Two rules are specific to
Assessments:

- `Official Assessment` describes platform/organisation control and versioning — it must
  never be worded in a way that implies federation endorsement (e.g. "Official Swiss
  Curling Assessment") unless that endorsement genuinely exists.
- Do not label a result `Perfect`, `Poor`, or similarly, without a validated reference
  value behind it — prefer describing the measured difference itself (e.g. "Your largest
  measured difference was...", "This run is not directly comparable because...").

---

# Accessibility

Do not rely only on colour.

Always combine:

- colour

- icons

- labels

- text

---

# Internationalisation

All user-facing text should originate from a central source where practical.

Avoid embedding long strings directly inside components.

---

# Future Principle

Whenever a new feature is added, ask:

1. Does the user understand what it is?

2. Does the user understand why it exists?

3. Does the user understand when to use it?

4. Does the user understand what success looks like?

If any answer is "no", improve the UX before adding more functionality.