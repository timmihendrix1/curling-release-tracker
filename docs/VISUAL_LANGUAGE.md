# Visual Language

&gt; This document defines how the visual identity of the Curling Performance Platform is expressed through layout, hierarchy, spacing and information architecture.

&gt;

&gt; Unlike the Design System, this document intentionally avoids implementation details. It defines visual principles that guide every future screen, component and interaction.

&gt;

&gt; When design decisions are ambiguous, the principles in this document take precedence over individual component preferences.

---

# Core Principle

The interface should communicate **performance, clarity and confidence** before it communicates functionality.

A user should understand:

- what matters

- what happened

- what to do next

within a few seconds.

Visual hierarchy should accomplish this naturally, without relying on excessive colours, borders or decorations.

---

# Visual Hierarchy

Not every piece of information deserves equal attention.

The platform uses five hierarchy levels.

---

## Hero

The single most important information on the screen.

Examples:

- Current Target

- Assessment Result

- Today's Training

- Key Progress Summary

Characteristics:

- highest visual emphasis

- large typography

- generous whitespace

- immediately visible without scrolling

Only one Hero should exist per screen.

---

## Primary

Core information required to complete the current task.

Examples:

- Training configuration

- Live metrics

- Assessment protocol

- Main chart

Characteristics:

- strong visual weight

- grouped together

- easy to scan

---

## Secondary

Supporting information.

Examples:

- historical context

- comparison metrics

- secondary charts

- supporting KPIs

Characteristics:

- visually quieter

- complements Primary information

- never competes with Hero content

---

## Tertiary

Context.

Examples:

- labels

- descriptions

- timestamps

- metadata

- notes

Characteristics:

- visually subtle

- supports comprehension

- never dominates

---

## Utility

Rare actions.

Examples:

- Export

- Advanced Filters

- Debug

- Reset

Characteristics:

- intentionally understated

- visible when needed

- never distracts from the main workflow

---

# Surface Hierarchy

Cards are tools.

Not every section should become a card.

Different surface types communicate different levels of importance.

---

## Hero Surface

Used for:

- Today's Plan

- Assessment Result

- Live Training Status

Characteristics:

- strongest elevation

- generous spacing

- immediate visual focus

Use sparingly.

---

## Primary Surface

The standard working surface.

Used for:

- Training configuration

- Live dashboard

- Main analysis

Characteristics:

- moderate elevation

- comfortable spacing

- clearly grouped

Most interactive sections belong here.

---

## Secondary Surface

Provides supporting information.

Examples:

- Devices

- Training Overview

- Reference Information

- Comparison Cards

Characteristics:

- lighter visual weight

- subtle border

- minimal shadow

Should visually step back.

---

## Inline Section

No card.

Simply structured content.

Examples:

- headings

- explanatory text

- grouped controls

- small filter areas

Avoid unnecessary containers.

---

## Status Surface

Communicates temporary state.

Examples:

- Success

- Warning

- Information

Should use colour purposefully.

---

## Danger Surface

Reserved exclusively for destructive actions.

Examples:

- Delete History

- Reset Local Data

Should never be reused for normal functionality.

---

# Layout Rhythm

Good interfaces create rhythm.

Avoid long sequences of visually identical sections.

Instead alternate between:

- open layouts

- grouped content

- prominent surfaces

- lightweight sections

Example:

Hero

↓

Open spacing

↓

Primary Surface

↓

Inline content

↓

Secondary Surface

↓

Chart

↓

Inline explanation

↓

Primary Surface

This rhythm improves readability and reduces fatigue.

---

# Information Density

Different screens require different densities.

---

## Home

Lowest density.

The athlete should immediately understand:

- today's priority

- recent progress

- next action

No information overload.

---

## Train

Medium density.

The athlete is configuring and executing a session.

Complexity should appear progressively.

---

## Active Training

Higher density.

The athlete actively interacts with the application.

Important information should stay immediately accessible.

---

## Assessment

Medium density.

The protocol should feel structured and controlled.

Never overwhelming.

---

## Analyze

Highest density.

Users intentionally visit Analyze to study performance.

More information is acceptable here.

Even then:

Hierarchy remains more important than quantity.

---

# Progressive Disclosure

Only reveal complexity when it becomes useful.

Examples:

Beginner:

- Training Mode

- Target

- Start

Advanced:

- Filters

- Thresholds

- Detailed charts

- Comparison controls

Experts should discover depth naturally.

Beginners should never feel intimidated.

---

# Dashboard Philosophy

Dashboards answer questions.

They do not display everything.

Every dashboard should answer:

What matters most?

before

What else happened?

Order should generally be:

1. Key takeaway

2. Core metrics

3. Supporting charts

4. Detailed data

5. Raw history

---

# Chart Philosophy

Charts exist to explain behaviour.

Never to impress.

Each chart should answer exactly one question.

Examples:

Can I repeat different weights?

Am I becoming more consistent?

Which handle is less stable?

How is my bias changing?

If a chart answers multiple unrelated questions, it should be redesigned.

---

# White Space

Whitespace is functional.

Not decorative.

It is used to:

- separate ideas

- improve focus

- reduce cognitive load

- create rhythm

Whitespace should never create the impression of unfinished design.

Likewise, interfaces should never feel compressed simply to fit more information.

---

# Typography Hierarchy

Typography communicates importance before colour.

The hierarchy should generally follow:

Hero values

↓

Section titles

↓

Primary metrics

↓

Descriptions

↓

Labels

↓

Metadata

Numbers deserve particular emphasis.

Performance metrics should always be easier to scan than surrounding explanations.

---

# Visual Weight

Everything cannot be important.

Visual emphasis should be reserved for:

- current task

- current performance

- current decision

Everything else should naturally fade into the background.

Whenever two neighbouring sections compete for attention, hierarchy should be reconsidered.

---

# Empty States

Empty states should feel intentional.

Every empty state should explain:

Why nothing is shown.

What will appear later.

What the athlete can do next.

Avoid large empty charts or placeholder components whenever possible.

---

# Forms

Forms should feel lightweight.

Avoid presenting configuration as administration.

Instead:

Guide users through decisions.

Related options should be grouped.

Descriptions should appear only where they improve understanding.

The interface should feel like setting up a training session—not completing paperwork.

---

# Navigation

Navigation should always feel available but never intrusive.

Users should always know:

- where they are

- what they can do next

- how to return

Navigation should not compete visually with the screen's primary purpose.

---

# Screen Composition

Every screen should have:

One clear entry point.

One primary task.

One visual focal point.

One obvious next action.

Screens should never feel like collections of unrelated cards.

---

# Consistency

Consistency is measured by behaviour.

Not by identical layouts.

Different screens may look different if they solve different problems.

Consistency means users can predict:

- where information appears

- how controls behave

- how actions are completed

- how feedback is presented

---

# Visual Restraint

Whenever a design decision adds visual complexity, ask:

Does this improve understanding?

If the answer is no,

remove it.

The interface should earn every visual element it contains.

---

# Evolution

The visual language should scale naturally as the platform grows.

Future features such as:

- Coach

- Team

- Training Plans

- Cloud Sync

- Brower Integration

- Athlete Profiles

should feel like natural extensions of the same product.

New features should never require a new visual language.

The platform should become richer over time without becoming visually heavier.