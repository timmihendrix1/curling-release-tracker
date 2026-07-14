# Design System

## Purpose

This document defines the visual and interaction principles of the application.

Its goal is consistency, clarity and speed.

The interface should help athletes focus on training and analysis rather than navigating the software.

This document complements:

- PRODUCT_DIRECTION_AND_[PRINCIPLES.md](http://PRINCIPLES.md)

- SYSTEM_[ARCHITECTURE.md](http://ARCHITECTURE.md)

- UX_WRITING_[GUIDELINES.md](http://GUIDELINES.md)

---

# Core Principles

## Mobile first

The primary platform is a mobile phone used beside the curling sheet.

Every screen must remain fully usable on a small display.

Desktop is an enhancement, not the primary design target.

---

## Minimise interaction

Training should never be interrupted by the application.

Every unnecessary tap or decision reduces training flow.

Before introducing any interaction, ask:

&gt; Does this make training better or only the software more flexible?

---

## Data before decoration

The application exists to support better decisions.

Visual elements should highlight information rather than decorate the interface.

Avoid visual noise.

---

## Progressive disclosure

Show the most important information first.

Advanced information should appear only when needed.

Hierarchy:

1. Essential

2. Useful

3. Detailed

Never overwhelm the user.

---

## Consistency over novelty

Similar information should always look and behave similarly.

Users should not have to relearn patterns.

---

# Layout

## Information hierarchy

Every screen should follow this structure whenever applicable.

1. Current context

2. Primary action

3. Immediate feedback

4. Analytics

5. Details

6. Configuration

---

## Sections

Different responsibilities belong in different visual sections.

Typical sections:

- Context

- Input

- Dashboard

- Charts

- Details

- History

- Settings

Each section should have a clear visual boundary.

---

## Vertical rhythm

Prefer consistent spacing throughout the application.

Avoid dense layouts.

Whitespace improves readability.

---

# Cards

Cards are the primary building block.

Every card should have:

- clear title

- optional subtitle

- optional Info button

- body

- optional footer

Cards should never contain unrelated functionality.

---

## Dashboard Cards

Dashboard cards display one important metric.

Each card should contain:

- title

- value

- optional trend

- optional Info button

Do not overload cards with secondary information.

---

## Chart Cards

Every chart card should contain:

- title

- subtitle

- Info button

- chart

- contextual notices (when needed)

Charts should never appear without context.

---

## Filter Cards

Filters belong together.

Primary filters should remain visible.

Secondary filters may be collapsed.

---

# Navigation

Navigation should remain simple.

Users should always understand:

- where they are

- what they are analysing

- how to return

---

# Sticky Elements

Sticky UI should only be used when it reduces unnecessary scrolling.

Current examples:

- History filters

Avoid multiple competing sticky areas.

---

# Buttons

Buttons should communicate priority.

Hierarchy:

Primary

Used for the main action.

Secondary

Used for supporting actions.

Danger

Used only for destructive actions.

Avoid multiple primary buttons in the same section.

---

# Forms

Keep forms short.

Only request information that is required.

Show validation close to the relevant field.

Never rely on alert dialogs.

---

# Charts

Charts should answer questions.

Every chart should answer exactly one primary question.

If a chart answers multiple unrelated questions, split it.

---

## Reference lines

Reference lines should always be clearly explained.

Examples:

- Zero line

- Perfect match line

---

## Colour usage

Colour should support interpretation.

It should never be the only way to distinguish information.

Always combine colour with:

- labels

- markers

- icons

- patterns

---

## Empty charts

Never show an empty chart without explanation.

Instead explain:

- why no data is shown

- what the athlete needs to do

---

# Tables and Lists

Lists should prioritise scanning.

Important values should be immediately visible.

Avoid large dense tables on mobile.

---

# Icons

Icons support text.

They should never replace text completely.

Info icons should behave consistently throughout the application.

---

# Typography

Typography should create hierarchy.

Prefer:

Title

↓

Subtitle

↓

Body

↓

Supporting text

Avoid large blocks of text.

---

# Feedback

The application should always communicate:

- successful actions

- failed actions

- loading states

- unavailable features

Users should never wonder whether an action succeeded.

---

# Empty States

Every empty state should answer:

- Why is this empty?

- What should I do next?

Example:

Train at least one Variable Weight block to see this chart.

---

# Responsive Behaviour

The application should work comfortably on:

- phones

- tablets

- desktop browsers

Content should reflow vertically before horizontal scrolling is introduced.

Horizontal scrolling should generally be avoided.

---

# Accessibility

Interfaces should remain usable for all users.

Consider:

- keyboard navigation

- screen readers

- colour vision deficiencies

- touch interaction

- sufficient contrast

Accessibility should be part of every feature, not an afterthought.

---

# Future Components

New reusable components should follow existing patterns whenever possible.

Avoid introducing visually different components when an existing one can be extended.

---

# Design Review Checklist

Before completing a feature, verify:

- Is the primary action obvious?

- Is the current context clear?

- Is the screen understandable without explanation?

- Is information prioritised correctly?

- Does this match existing components?

- Does it work on mobile?

- Does it avoid unnecessary interaction?

- Does it improve training rather than software complexity?