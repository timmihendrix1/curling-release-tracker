# Design System

&gt; Visual Language, Components and Interface Standards

&gt;

&gt; This document defines the reusable visual rules and component patterns of the Curling Performance Platform.

&gt;

&gt; Its purpose is to make the interface consistent, efficient, accessible and appropriate for use during curling training.

&gt;

&gt; It translates the product-experience principles from `MOBILE_UX_AND_DESIGN_[PRINCIPLES.md](http://PRINCIPLES.md)` into concrete interface standards.

---

# 1. Scope

This document defines:

- semantic colour roles

- typography

- spacing

- borders and elevation

- layout primitives

- surface hierarchy

- navigation components

- buttons and actions

- segmented controls

- chips and status indicators

- form controls

- help and information patterns

- charts and metric presentation

- lists and tables

- overlays and dialogs

- empty, loading and error states

- responsive component behaviour

- accessibility requirements

This document complements:

- `docs/MOBILE_UX_AND_DESIGN_[PRINCIPLES.md](http://PRINCIPLES.md)`

- `docs/UX_WRITING_[GUIDELINES.md](http://GUIDELINES.md)`

- `docs/COACHING_[PRINCIPLES.md](http://PRINCIPLES.md)`

- `docs/PRODUCT_DIRECTION_AND_[PRINCIPLES.md](http://PRINCIPLES.md)`

- `docs/SYSTEM_[ARCHITECTURE.md](http://ARCHITECTURE.md)`

- `docs/DOMAIN_[GLOSSARY.md](http://GLOSSARY.md)`

It does not define:

- product workflows

- domain rules

- analytics formulas

- coaching interpretation

- user-facing terminology

Those remain authoritative in their respective documents.

---

# 2. Design Objectives

The interface should feel like:

- a focused performance tool

- calm and dependable

- professional

- clear under time pressure

- easy to operate with one hand

- suitable for use beside the ice

- precise without feeling technical or administrative

The interface should not feel like:

- a desktop dashboard compressed onto a phone

- a long configuration form

- a collection of unrelated cards

- a prototype with every feature shown at once

- an analytics tool that requires expert interpretation

- a decorative consumer-fitness application

---

# 3. Core Principles

## Function Before Decoration

Visual design must support:

- comprehension

- execution

- comparison

- decision-making

- recovery from interruption

Decoration must never compete with current training information.

---

## Mobile First

The primary reference viewport is approximately 390 pixels wide.

Every component must first be designed and validated for:

- 320 × 700

- 390 × 844

Tablet and desktop layouts may expand density and use additional columns, but they must preserve the same information hierarchy.

---

## Current Task First

The strongest visual element should normally represent:

- the current action

- the current target

- the current result

- the current status

Secondary configuration and analytics must not compete with execution.

---

## Progressive Disclosure

Show:

1. what is required now

2. the context needed to act

3. a compact summary

4. optional detail

5. advanced configuration

Do not expose all available information permanently.

---

## Consistency Over Novelty

A user should recognise the same interaction pattern everywhere.

Examples:

- mutually exclusive choices use segmented controls

- filters use chips or compact selectors

- primary actions use primary buttons

- destructive actions use danger styling

- detailed explanations use the shared help pattern

- metric cards follow one consistent structure

Do not introduce a visually new component when an existing pattern can be extended without semantic compromise.

---

# 4. Semantic Design Tokens

The implementation should use semantic roles rather than feature-specific colours or ad-hoc values.

Exact values should be centralised in the application theme or Tailwind configuration where practical.

---

## 4.1 Colour Roles

### Canvas

The application background.

Purpose:

- creates separation from white surfaces

- remains calm and low contrast

- supports long use without visual fatigue

Use the existing light neutral-blue canvas.

---

### Surface Primary

Used for:

- main cards

- dialogs

- sheets

- important contained sections

Usually white or near-white.

---

### Surface Secondary

Used inside a primary surface for:

- metric tiles

- selected detail groups

- compact configuration panels

- subtle empty states

It must be visually lighter than a full card.

---

### Surface Muted

Used for:

- disabled selections

- tertiary metadata

- Coming Soon areas

- non-interactive status rows

It should not look actionable.

---

### Text Primary

Used for:

- page titles

- section titles

- metric values

- primary labels

Use the existing dark navy tone.

---

### Text Secondary

Used for:

- descriptions

- field labels

- metadata

- chart subtitles

---

### Text Muted

Used for:

- helper text

- timestamps

- unavailable features

- secondary context

Muted text must still meet accessibility contrast requirements.

---

### Action Primary

Used for:

- the dominant action

- active navigation state

- selected action-oriented control

The current dark navy treatment remains the default primary action colour.

---

### Accent

Used sparingly for:

- timing-gate visuals

- chart series

- focus indicators

- highlighted data

Accent colour must not compete with the primary action colour.

---

### Success

Used only for confirmed successful states.

Do not use success colour as a general performance judgement.

---

### Warning

Used for states requiring attention but not immediate danger.

Examples:

- incompatible comparison context

- timing setup issue

- protocol deviation requiring review

---

### Danger

Used for:

- delete

- clear history

- abandon

- irreversible actions

Danger colour must not be used for poor sporting performance.

---

### Focus

All keyboard-focus rings must use one consistent high-contrast focus colour.

Focus styling must remain visible on both selected and unselected controls.

---

## 4.2 Colour Rules

Do not rely on colour alone.

Combine colour with at least one of:

- text

- icon

- marker

- pattern

- shape

- explicit status label

Do not use red or green as automatic sporting-quality labels.

---

# 5. Typography

Typography should create a strong but compact hierarchy.

The existing font family may remain.

Use semantic text styles consistently rather than assigning sizes independently inside each component.

---

## 5.1 Product Title

Used primarily on Home.

Characteristics:

- strong weight

- prominent

- not repeated on every functional screen

Example:

`Curling Performance`

---

## 5.2 Page Title

Used on Train, Assess, Analyze, Settings and detailed screens.

Characteristics:

- compact

- clearly identifies context

- should not require a large surrounding card

Examples:

- Train

- Assess

- Analyze

- Settings

- Assessment Results

---

## 5.3 Section Title

Used for major groups within a page.

Examples:

- Today's Plan

- Training Overview

- Accuracy Thresholds

- Block Results

---

## 5.4 Component Title

Used inside cards, panels and chart sections.

Examples:

- Bias

- Handle Comparison

- Current Shot

---

## 5.5 Body

Used for standard explanations and content.

Avoid long paragraphs inside primary task screens.

---

## 5.6 Supporting Text

Used for:

- helper text

- metadata

- captions

- chart context

- timestamps

Supporting text should not become so small or low-contrast that it becomes difficult to read on the ice.

---

## 5.7 Metric Value

Metric values use:

- stronger weight

- tabular numerals where available

- consistent decimal formatting

- units visually attached to the value

Do not use oversized values that destabilise the layout.

---

## 5.8 Typography Rules

- Keep titles short.

- Avoid all-caps headings except short status or eyebrow labels.

- Do not use placeholder text as the only explanation.

- Avoid large text blocks on execution screens.

- Use consistent terminology from `DOMAIN_[GLOSSARY.md](http://GLOSSARY.md)`.

- Do not use font size alone to communicate hierarchy; spacing and weight must support it.

---

# 6. Spacing System

Use a consistent spacing scale.

Recommended base scale:

- 4 px — micro spacing

- 8 px — tight internal spacing

- 12 px — compact group spacing

- 16 px — standard component spacing

- 20 px — comfortable mobile card padding

- 24 px — section spacing

- 32 px — major page separation

- 40 px or more — exceptional separation only

Avoid arbitrary one-off spacing values.

---

## 6.1 Mobile Page Gutters

Recommended:

- 16 px minimum on narrow screens

- 20 px on standard mobile screens where space permits

The page gutter should remain visually consistent across screens.

---

## 6.2 Card Padding

Recommended mobile padding:

- compact surface: 12–16 px

- standard card: 16–20 px

- primary task card: 20–24 px

Do not use excessive internal padding merely to make a section look important.

---

## 6.3 Vertical Rhythm

Use:

- small spacing within one decision group

- medium spacing between related groups

- large spacing between unrelated sections

A sequence of label, input and helper text should be visually treated as one field group.

---

# 7. Border Radius

Use a small, controlled radius scale.

Recommended roles:

- small: chips, badges and compact controls

- medium: inputs and segmented controls

- large: cards and panels

- extra large: primary surfaces and dialogs where appropriate

Avoid using the largest radius on every element.

The visual hierarchy should not depend on every surface appearing as a large rounded rectangle.

---

# 8. Borders and Elevation

Elevation should communicate layer and importance.

Do not apply a strong shadow to every section.

---

## 8.1 Level 0 — Inline Content

No surface, border or shadow.

Use for:

- page introductions

- greetings

- section headings

- simple explanatory text

---

## 8.2 Level 1 — Subtle Surface

Uses:

- light background

- optional subtle border

- no or minimal shadow

Use for:

- metric tiles

- compact summaries

- filters

- grouped options

- empty states

---

## 8.3 Level 2 — Standard Card

Uses:

- primary surface

- subtle border or low elevation

- clear section grouping

Use for:

- Training Overview

- Assessment configuration

- analytics sections

- session setup

---

## 8.4 Level 3 — Primary or Floating Surface

Uses:

- stronger separation

- restrained shadow

- optional larger radius

Use for:

- Today's Plan

- Current Shot

- active assessment state

- dialogs

- bottom navigation surface

Do not use this elevation for every card.

---

## 8.5 Border Rules

Use borders when they improve structure.

Preferred:

- subtle dividers inside grouped content

- one shared border around related items

- visible input borders

- dashed border only for clearly unavailable or future capability sections

Avoid:

- multiple individually bordered boxes for one logical section

- nested full-strength borders

- heavy borders around charts

---

# 9. Page Shell

A standard functional page should contain:

1. compact contextual header

2. optional short description

3. primary content

4. secondary content

5. sufficient bottom clearance above navigation

---

## 9.1 Home Header

Home may show the full product identity:

- product title

- product subtitle

The full product header should not be repeated as a large card on every functional screen.

---

## 9.2 Functional Header

Train, Assess, Analyze and Settings should use a compact contextual header.

A functional header may contain:

- page title

- optional one-sentence description

- optional contextual action

It should normally be inline rather than contained inside a large elevated card.

---

## 9.3 Content Width

Mobile:

- single content column

- full available width inside page gutters

Tablet and desktop:

- readable maximum content width

- side-by-side sections where this improves comprehension

- avoid stretching mobile cards across the entire viewport

---

# 10. Surface Hierarchy

Cards are one available pattern, not the default wrapper for all content.

---

## 10.1 Primary Task Surface

Used for the most important task on the screen.

Examples:

- Today's Plan

- Current Shot

- Resume Assessment

- Completion Summary

Characteristics:

- strongest hierarchy

- one clear primary action

- limited secondary content

- no unnecessary nested cards

---

## 10.2 Standard Section Card

Used to group one coherent responsibility.

Examples:

- Threshold Selection

- Session Setup

- Block Results

- Protocol Integrity

---

## 10.3 Inset Panel

A low-emphasis panel inside a card.

Examples:

- target for next shot

- threshold values

- compact validation message

- comparison context

An inset panel must not look like another full card.

---

## 10.4 Metric Tile

Displays one metric.

Contains:

- short label

- value

- optional unit

- optional supporting context

- optional Info action

Metric tiles should be visually lightweight.

Do not show zero values as measured results when no data exists.

---

## 10.5 Grouped Row List

Use for several related compact items.

Examples:

- Coming Next capabilities

- protocol details

- device status

- run metadata

Prefer one shared container with dividers over multiple small cards.

---

## 10.6 Inline Section

Use when a title and content do not require a contained surface.

Examples:

- greeting

- page introduction

- short note beneath an Assessment card

---

## 10.7 Shared Implementation Primitive

`src/components/Surface.tsx` is the one shared implementation of this section's
hierarchy — it does not define a new hierarchy, it gives 10.1–10.4 a single
reusable component instead of copy-pasted Tailwind strings.

| `level` prop | Maps to | Use |
| --- | --- | --- |
| `hero` | 10.1 Primary Task Surface | exactly one per screen |
| `primary` | 10.2 Standard Section Card | essential supporting content/controls |
| `secondary` | Secondary Surface (Visual Language) | analytics, context, history that steps back |
| `inset` | 10.3 Inset Panel | low-emphasis panel nested inside another surface |
| `utility` | 8.2 Level 1 — Subtle Surface | filters, metadata, compact status rows |

10.5 Grouped Row List and 10.6 Inline Section remain open layout — they are
deliberately not part of `Surface`, since they exist precisely to avoid a
contained surface.

---

# 11. Navigation

Users must always understand:

- where they are

- what primary area is active

- how to move to another area

Primary destinations:

- Home

- Train

- Assess

- Analyze

- Settings

---

## 11.1 Mobile Bottom Navigation

`PrimaryNavigation.tsx` remains the single source for mobile and desktop primary navigation.

The mobile rendering must:

- be fixed above the operating-system gesture area

- respect `env(safe-area-inset-bottom)`

- provide at least 44 × 44 px touch targets

- use a stable surface behind all items

- remain visually separated from scrolling content

- display all labels

- expose the active destination with `aria-current="page"`

- preserve visible keyboard focus

- never cover the final content element

Required content clearance:

&gt; page bottom padding = rendered navigation height + safe-area inset + additional visual gap

The navigation must not sit directly on the iOS Home Indicator.

The application viewport configuration must support safe-area handling where required.

---

## 11.2 Preferred Mobile Navigation Surface

Preferred characteristics:

- contained within small horizontal margins

- elevated slightly above the device edge

- rounded outer surface

- clear active item

- quiet inactive items

- sufficient spacing between destinations

Avoid presenting the navigation as five tightly compressed independent buttons touching the device edge.

---

## 11.3 Desktop Navigation

Desktop and tablet may use a top navigation surface.

Requirements:

- same item configuration

- same order

- same labels

- same active-state semantics

Do not create a second independent navigation configuration.

---

## 11.4 Contextual Back Navigation

Detailed views may use:

- Back to Assess

- Back to Analyze

- Back to Results

Contextual back navigation must not conflict visually with primary navigation.

---

# 12. Buttons

Buttons trigger actions.

They must not be used as the default styling for every selection.

---

## 12.1 Primary Button

Used for the main action in the current state.

Examples:

- Start Training

- Add Shot

- Start Assessment

- Continue

- View Full Results

Rules:

- one dominant primary action per screen or state

- clear enabled and disabled states

- full-width on mobile when appropriate

- minimum touch height approximately 44 px

- label describes the result of the action

---

## 12.2 Secondary Button

Used for supporting actions.

Examples:

- View Protocol

- Edit Details

- Pause

- View Analyze

It must remain clearly subordinate to the primary action.

---

## 12.3 Tertiary Action

Used for low-emphasis actions.

Examples:

- Skip explanation

- Reset

- Dismiss

- View details

May use:

- text button

- subtle button

- inline link-style action

---

## 12.4 Danger Button

Used only for destructive actions.

Examples:

- Delete Run

- Clear History

- Abandon Assessment

Danger actions require clear confirmation where consequences are significant.

---

## 12.5 Disabled Button

A disabled action must:

- remain readable

- visibly differ from an enabled action

- preserve its label

- communicate the missing requirement nearby where useful

Do not rely on reduced opacity alone if the resulting contrast becomes insufficient.

---

# 13. Segmented Controls

Use a segmented control for a small set of mutually exclusive options.

Examples:

- Fixed Weight / Variable Weight / Blind Weight

- Backline–Hog / Hog–Hog

- In Handle / Out Handle

- Draw / Takeout

- Standard / Tight / Custom

- Training / Assessments

---

## 13.1 Segmented-Control Rules

A segmented control:

- behaves as one grouped component

- has one selected item

- uses consistent item heights

- has a clear selected state

- supports keyboard navigation

- does not rely only on colour

- does not resemble several unrelated action buttons

Avoid placing an independent Info icon inside every segment when this reduces legibility or tap reliability.

Preferred alternatives:

- one shared Info action for the control group

- contextual help below the control

- a dedicated description for the selected option

---

## 13.2 Mobile Behaviour

For three or fewer short labels:

- use one row where labels remain readable

For long labels or four or more options:

- allow an intentional two-row layout

- use a compact selector

- or use a sheet-based selection pattern

Do not force multi-word labels into cramped narrow segments.

---

# 14. Chips and Badges

## Chips

Use for:

- filters

- optional selections

- compact metadata

- active comparison context

Chips may be interactive.

Interactive chips require:

- clear selected state

- sufficient touch target

- visible focus state

- accessible label

---

## Badges

Use for status or metadata.

Examples:

- Coming Soon

- Auto

- Incomplete

- Original

- Protocol Deviation

Badges are normally not interactive.

They should remain compact and visually secondary.

---

# 15. Forms

Forms should be structured by athlete decision, not by internal data model.

---

## 15.1 Field Group

A field group contains:

- visible label

- control

- optional helper text

- optional validation text

Keep these elements visually close.

---

## 15.2 Inputs

Inputs must:

- have a visible label

- provide sufficient touch height

- use readable text

- expose a clear focus state

- show validation near the field

- avoid critical instructions only in the placeholder

- use the correct mobile keyboard type

---

## 15.3 Numeric Inputs

Timing fields should:

- support the established input formats

- clearly communicate units

- prevent invalid double submission

- use consistent decimal precision

- remain easy to edit with a numeric keyboard

---

## 15.4 Text Areas

Text areas should be reserved for content that genuinely benefits from longer input.

Notes should remain optional.

Avoid giving optional notes excessive visual prominence during setup.

---

## 15.5 Form Sections

Typical training setup sections:

### Session

- name

- optional notes

### Training Block

- block name

- training category

- measurement mode

### Target Configuration

- target mode

- target or range

- accuracy thresholds

Related decisions may share one card with internal section spacing or dividers.

Do not give every field group its own card.

---

## 15.6 Form Actions

The primary form action must remain reachable:

- above the bottom navigation

- when the keyboard is open

- without excessive scrolling where practical

---

# 16. Help and Information

## Info Action

Use Info actions when:

- interpretation requires explanation

- mathematical meaning matters

- misunderstanding is likely

- protocol rules require permanent access

Do not use Info actions for trivial interactions.

---

## 16.1 Info Icon Placement

Info icons must:

- have a reliable touch target

- not collide with labels

- not reduce selectable-control width unnecessarily

- use the same icon and interaction pattern throughout the app

---

## 16.2 Help Content

Detailed help should use the shared overlay or sheet pattern.

Help content should not permanently occupy primary task screens.

---

# 17. Overlays, Dialogs and Sheets

Use overlays for focused content that temporarily sits above the current context.

Examples:

- metric explanation

- Assessment Protocol

- setup diagram

- invalid-attempt reason

- destructive confirmation

---

## 17.1 Overlay Requirements

Every overlay must:

- have a clear title

- provide an explicit close action

- trap focus correctly

- restore focus after closing

- remain scrollable on small devices

- respect top and bottom safe areas

- prevent background interaction

- avoid clipping long content

- have a clear maximum width on desktop

---

## 17.2 Dialog vs. Sheet

Use a dialog for:

- confirmation

- short focused choice

- destructive action

Use a sheet or large modal for:

- protocol content

- setup guidance

- longer explanations

- detailed metric help

Do not introduce parallel overlay systems without strong reason.

---

# 18. Sticky and Fixed Elements

Sticky UI is allowed only when it meaningfully reduces repeated scrolling.

Current or potential examples:

- primary bottom navigation

- compact history filter bar

- compact execution action area

Rules:

- respect safe areas

- do not cover content

- do not cover the keyboard

- avoid multiple competing sticky layers

- use a documented z-index hierarchy

- preserve access to the final content element

A small mobile viewport must not simultaneously lose excessive space to:

- sticky header

- sticky filters

- sticky action bar

- bottom navigation

---

# 19. Active Training Components

The active Training experience should prioritise execution.

---

## 19.1 Active Block Summary

Show:

- block name

- category

- measurement mode

- concise target context

- shot count

- secondary action for a new block

The summary should remain compact.

Avoid a large two-column card where the action competes with the block identity.

---

## 19.2 Current Target Panel

The target for the next shot should be one of the strongest visual elements.

Include only essential context:

- target time

- generation method where relevant

- current mode

- optional status badge

---

## 19.3 Shot Entry

Group together:

- timing input

- handle selection

- shot type selection

- primary Add Shot action

These controls should appear as one coherent execution unit.

---

## 19.4 Auto Capture

Before activation, Auto Capture may show configuration.

After activation, replace the full configuration form with a compact active state containing:

- capture status

- current shot progress

- active strategy

- pause or stop action

- error state if needed

Do not permanently retain the entire configuration form after capture begins.

---

## 19.5 Live Training Analytics

Display a compact summary first. The implemented mobile pattern calls the combined,
collapsed-by-default surface **Live Performance**: its closed header retains the current
shot count, average and on-target rate; opening it reveals filters, supporting metrics
and detailed charts in that order.

Detailed charts should appear:

- below the execution area

- in collapsible sections

- or in a dedicated Live Analysis view

Do not require the athlete to scroll through all analytics to reach current-session controls.

---

## 19.6 Session Details During Execution

Session Details should be:

- compact

- collapsed by default

- or available through Edit Details

Do not repeat the entire setup form after the analytics area.

---

# 20. Assessment Components

Assessment screens should feel more structured and protocol-driven than normal Training.

---

## 20.1 Assessment Overview

Prioritise:

- purpose

- number of stones

- estimated duration

- measurement mode

- threshold selection

- setup confirmation

- primary start action

---

## 20.2 Assessment Progress

`AssessmentProgress` is the shared progress pattern for:

- warm-up

- block progress

- total progress

Requirements:

- visible text such as `4 of 8`

- semantic progress attributes

- clear current phase

- no colour-only status

---

## 20.3 Assessment Current Shot

`AssessmentCurrentShot` prioritises:

- target

- expected handle

- current phase

- executed handle confirmation

- latest result

- protocol-deviation notice

Target and handle must remain visible without precise scrolling.

---

## 20.4 Assessment Setup Diagram

`AssessmentSetupDiagram` is:

- schematic

- provider-neutral

- mobile-readable

- accessible

- free of manufacturer branding

Labels and arrows must not collide.

The illustration should explain the setup quickly rather than behave as a detailed engineering drawing.

---

## 20.5 Assessment Protocol

`AssessmentProtocolSheet` provides permanent access to:

- purpose

- warm-up

- blocks

- setup

- invalid-attempt rules

- wrong-handle rules

- pause and abandon rules

It should not permanently occupy the execution screen.

---

## 20.6 Assessment Results

Assessment results should follow this order:

1. summary

2. active threshold context

3. core metrics

4. block results

5. target results

6. handle comparison

7. Variable Adaptation

8. protocol integrity

9. shot details

10. trends and comparisons where available

Do not present all subsections with equal visual weight.

---

# 21. Metrics

## Dashboard Metric

A metric component contains:

- concise title

- value

- unit where relevant

- optional trend or comparison

- optional Info action

---

## 21.1 Metric Group

Related metrics should appear as one coherent group.

Prefer:

- a shared card with lightweight internal tiles

- consistent column layout

- compact spacing

Avoid giving every metric a separate elevated card.

---

## 21.2 No-Data Metrics

When no valid data exists:

- do not display `0.00s`

- do not display `0%`

- do not display placeholder values that look measured

Instead show one compact group-level empty state.

Example:

`Add a shot to begin the live summary.`

---

# 22. Charts

Every chart must answer one primary athlete question.

Examples:

- Is my release becoming more consistent?

- Is my timing systematically above or below target?

- Do my handles differ?

- Can I reproduce different targets?

---

## 22.1 Chart Card

A Chart Card contains:

- title

- one-sentence purpose

- optional Info action

- threshold or filter context where relevant

- chart

- accessible text summary

- contextual notice where needed

---

## 22.2 Chart Height

Chart height should reflect information density.

Avoid oversized chart containers on mobile.

A chart with few points should not consume most of the screen.

---

## 22.3 Empty Chart State

Do not render:

- empty axes

- blank coordinate frames

- large empty plot areas

Instead show a compact empty state inside the section.

Example:

`Add at least two shots to see the release trend.`

The empty state should use substantially less height than the rendered chart.

---

## 22.4 Reference Lines

Every reference line must be explained.

Examples:

- zero-error line

- perfect-match line

- active threshold band

---

## 22.5 Chart Colour

Colour supports interpretation but cannot be the sole distinction.

Combine series colour with:

- labels

- markers

- line style

- tooltip text

- legend text where needed

---

## 22.6 Chart Economy

Avoid:

- decorative gauges

- radar charts

- score rings

- excessive gradients

- heavy animation

- multiple charts showing the same pattern

Prefer:

- direct line charts

- scatterplots

- boxplots

- compact grouped comparisons

- simple distribution views

---

# 23. Filters

Filters should remain distinct from actions.

Use:

- chips

- compact selectors

- segmented controls

- expandable advanced filter area

---

## 23.1 Filter Hierarchy

Primary filters remain visible.

Secondary filters may sit behind:

- More Filters

- an expandable panel

- a sheet

---

## 23.2 Filter Summary

The active selection should remain understandable after advanced filters collapse.

---

## 23.3 Sticky Filters

Sticky filters are allowed only where repeated adjustment is common.

They must not compete with:

- bottom navigation

- page header

- execution controls

---

# 24. Lists and Tables

Lists should support fast scanning.

Important values should be visible without opening every item.

---

## 24.1 Mobile Lists

Prefer:

- compact rows

- structured cards only where meaningful

- clear status

- one primary row action

- optional disclosure for detail

---

## 24.2 Tables

Avoid wide dense tables on mobile.

Responsive alternatives:

- stacked data rows

- card-based detail

- horizontal comparison only when deliberate and clearly signposted

Tables must use semantic headers.

---

# 25. Empty States

Every empty state must answer:

1. Why is this empty?

2. What needs to happen?

3. Is there a relevant action?

---

## 25.1 Compactness

Empty states must not occupy the same height as populated content.

Avoid:

- large empty cards

- blank charts

- empty headings

- repeated no-data messages in consecutive cards

Where several related analytics are empty, prefer one group-level empty state.

---

## 25.2 Examples

`Add a shot to begin the live summary.`

`Complete another comparable assessment to see development over time.`

`No handle data is available in this selection.`

`Train at least one Variable Weight block to see this analysis.`

---

# 26. Loading, Success and Error States

## Loading

Use loading indicators only when an operation is not immediate.

Avoid unnecessary skeleton screens for local calculations.

---

## Success

Provide immediate confirmation after meaningful actions.

Examples:

- shot saved

- backup created

- restore completed

Do not interrupt fast training flows with a modal for routine success.

---

## Error

Errors should:

- explain what failed

- preserve entered data where possible

- suggest the next action

- remain near the affected area

- avoid raw technical messages

---

# 27. Future Capability Pattern

`FutureCapabilityItem.tsx` remains the reusable Home pattern for planned capabilities.

Characteristics:

- title

- compact Coming Soon badge

- one-sentence description

- non-interactive

- not focusable

- visually muted

`FutureCapabilitiesSection.tsx` groups all future capabilities within:

- one shared low-emphasis container

- internal dividers

- one section heading

Do not use several individually elevated Coming Soon cards.

Future content must remain secondary to available functionality.

---

# 28. Responsive Behaviour

## Mobile

- one primary column

- compact functional headers

- safe-area-aware bottom navigation

- no horizontal page scrolling

- one chart per row

- selection controls adapted to label length

- tables converted to readable rows

- primary actions reachable with one hand

---

## Tablet

- wider cards

- selective two-column groups

- larger chart area where useful

- same navigation destinations

- same content order

---

## Desktop

- multi-column analytics where comparison benefits

- side-by-side result views

- readable maximum widths

- reduced unnecessary vertical stacking

- same terminology and information hierarchy

Desktop should not simply stretch mobile cards across the full viewport.

---

# 29. Accessibility

Every component must support:

- keyboard navigation

- visible focus

- semantic labels

- screen-reader-compatible state

- sufficient contrast

- reliable touch targets

- non-colour status communication

- correct modal focus management

- accessible chart summaries

---

## 29.1 Touch Targets

Interactive targets should be at least approximately 44 × 44 px.

Small icons must receive an enlarged invisible or visible hit area.

---

## 29.2 Selected State

Selected controls require:

- visual contrast

- semantic selected state

- readable text

- focus state independent from selected state

---

## 29.3 Disabled State

Disabled state must be distinguishable without becoming unreadable.

Where useful, explain why the control is disabled.

---

# 30. Motion

Motion should clarify:

- navigation

- expansion

- completion

- state changes

Motion must not delay execution.

Use:

- short durations

- restrained easing

- reduced-motion support

Avoid:

- decorative looping animation

- large entrance animation

- delayed primary actions

- animated metric counting during training

---

# 31. Implemented Shared Components

Current shared components include:

- `PrimaryNavigation`

- `DashboardCard`

- `ChartCard`

- `InfoButton`

- `ConfirmModal`

- `HistoryFilterBar`

- shared chart theme utilities

- shared Assessment components

These should be extended where semantics remain valid rather than duplicated.

---

## 31.1 Assessment Component Family

Implemented Assessment patterns include:

- `AssessmentSetupDiagram`

- `AssessmentProtocolSheet`

- `AssessmentProgress`

- `AssessmentCurrentShot`

- `AssessmentThresholdSelector`

- `AssessmentSetupConfirmation`

- `AssessmentInvalidAttemptDialog`

- `AssessmentBlockTransition`

- `AssessmentPausedView`

- `AssessmentCompletionSummary`

- `AssessmentResultScreen`

- `AssessmentResultSummary`

- `AssessmentThresholdControl`

- `AssessmentCoreMetrics`

- `AssessmentBlockResults`

- `AssessmentTargetResults`

- `AssessmentHandleComparison`

- `AssessmentVariableAdaptationResults`

- `AssessmentProtocolIntegrity`

- `AssessmentShotDetails`

- `AssessmentComparisonEligibilityNotice`

- `AssessmentRunComparison`

- `AssessmentTrendChart`

- `AssessmentAnalyze`

- `AssessmentHistoryItem`

Their current existence does not mean every current visual treatment is final.

The mobile design-refinement pass may improve:

- density

- hierarchy

- spacing

- surface choice

- responsive composition

without changing their domain responsibilities.

---

# 32. Current Refactor Priorities

## Priority 1 — Bottom Navigation

- correctly apply iOS bottom safe area

- increase touch reliability

- move navigation away from the Home Indicator

- ensure final content remains scrollable above it

- test on a physical or realistic iOS environment

---

## Priority 2 — Functional Headers

- retain full product header on Home

- use compact page headers on Train, Assess, Analyze and Settings

- remove repeated large product-title cards from functional screens

---

## Priority 3 — Card Hierarchy

- stop treating every section as an equally elevated card

- remove unnecessary wrappers

- use inset panels and grouped rows

- reduce repeated shadows

- distinguish primary task surfaces from secondary information

---

## Priority 4 — Training Execution

- keep the current target and shot entry prominent

- compact the active block summary

- collapse setup information during execution

- replace active Auto Capture configuration with a compact active state

- make detailed analytics secondary

---

## Priority 5 — Empty Analytics

- remove empty axes

- remove false zero values

- reduce empty-state height

- combine related empty analytics where appropriate

---

## Priority 6 — Form Density

- reduce excessive vertical spacing

- group related decisions

- avoid cramped long-label segmented controls

- keep the primary action reachable

---

## Priority 7 — Analyze Reading Order

- organise analysis into a coherent narrative

- group core metrics

- prioritise the most useful trend

- progressively disclose detailed charts

- reduce the feeling of unrelated stacked cards

---

# 33. Design Review Checklist

Before completing a feature, verify:

## Purpose

- Is the primary purpose clear?

- Is the current context clear?

- Is there one dominant primary action?

## Mobile

- Does it work at 320 × 700?

- Does it work at 390 × 844?

- Is the bottom safe area respected?

- Is any content covered by navigation?

- Is the keyboard handled correctly?

- Are controls easy to tap?

## Hierarchy

- Are too many sections styled as equal cards?

- Can related sections be grouped?

- Is secondary content less prominent?

- Is the screen unnecessarily long?

## Controls

- Are actions styled as buttons?

- Are selections styled as segmented controls or selectors?

- Are filters visually distinct from actions?

- Are selected and disabled states clear?

## Analytics

- Does each chart answer a clear question?

- Is useful data available?

- Are empty charts replaced with compact empty states?

- Are metric values real rather than placeholders?

## Accessibility

- Is focus visible?

- Is state communicated beyond colour?

- Are controls semantically labelled?

- Do overlays manage focus?

- Do charts include text summaries?

## Consistency

- Does the feature reuse existing patterns?

- Does it follow `MOBILE_UX_AND_DESIGN_[PRINCIPLES.md](http://PRINCIPLES.md)`?

- Does its wording follow `UX_WRITING_[GUIDELINES.md](http://GUIDELINES.md)`?

- Does its interpretation follow `COACHING_[PRINCIPLES.md](http://PRINCIPLES.md)`?

---

# 34. Definition of Done

A component or screen is visually complete only when:

- semantic design tokens are used

- hierarchy is clear

- card use is meaningful

- spacing follows the shared scale

- the primary action is obvious

- navigation safe areas are respected

- touch targets are reliable

- no content is obscured by fixed UI

- no horizontal overflow exists

- empty states are compact and useful

- charts render only when meaningful

- selected, disabled and focus states are accessible

- mobile, tablet and desktop behaviour is verified

- the interface remains consistent with existing platform patterns

---

# 35. Current Product Decision

The Curling Performance Platform uses:

- a calm neutral canvas

- dark navy primary actions and active states

- white primary surfaces

- lightweight secondary surfaces

- semantic colour roles

- compact functional headers

- a safe-area-aware mobile bottom navigation

- one dominant primary action per state

- cards only where grouping adds meaning

- restrained elevation

- consistent spacing tokens

- segmented controls for exclusive choices

- chips for filters and compact context

- buttons only for actions

- compact metric groups

- no false zero metrics

- no empty chart frames

- progressive disclosure

- responsive and accessible interaction

- execution-first Training and Assessment layouts

These rules apply to all new interface work and to the planned mobile design-refinement pass.
