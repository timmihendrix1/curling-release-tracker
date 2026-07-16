# Mobile UX and Design Principles

&gt; Product Experience and Interaction Principles

&gt;

&gt; This document defines how the Curling Performance Platform should structure, prioritise and present its interface, especially on mobile devices.

&gt;

&gt; It governs information hierarchy, navigation, screen composition, interaction patterns and responsive behaviour.

&gt;

&gt; It does not replace:

&gt;

&gt; - `DESIGN_[SYSTEM.md](http://SYSTEM.md)`, which defines visual tokens and reusable components

&gt; - `UX_WRITING_[GUIDELINES.md](http://GUIDELINES.md)`, which defines language and user-facing communication

&gt; - `COACHING_[PRINCIPLES.md](http://PRINCIPLES.md)`, which defines how performance data may be interpreted

&gt; - domain specifications, which define product and workflow rules

---

# 1. Purpose

The platform is primarily used in practical training environments.

Athletes may use it:

- on the ice

- between shots

- while holding a broom or stone

- with limited attention

- with cold hands

- under time pressure

- while switching between physical execution and data entry

The interface must therefore prioritise:

- immediate comprehension

- reliable touch interaction

- low cognitive load

- short interaction paths

- clear current-state visibility

- recovery from interruption

- safe mobile navigation

The product should feel like a focused performance instrument.

It should not feel like:

- a long administrative form

- a collection of unrelated dashboards

- a desktop interface compressed onto a phone

- a stack of equally important cards

- a technical analytics tool requiring expert interpretation

---

# 2. Relationship to Other Design Documents

## Mobile UX and Design Principles

Defines:

- information hierarchy

- screen purpose

- navigation behaviour

- page composition

- progressive disclosure

- mobile interaction

- responsive adaptation

- workflow focus

## Design System

Defines:

- colours

- typography

- spacing tokens

- border radii

- shadows

- buttons

- inputs

- cards

- segmented controls

- chips

- navigation components

- chart containers

## UX Writing Guidelines

Defines:

- terminology

- tone of voice

- labels

- explanations

- empty-state copy

- warnings

- metric descriptions

- interpretation language

A feature should satisfy all three documents.

---

# 3. Product Experience Vision

The platform supports the cycle:

&gt; Plan → Train → Assess → Analyze → Repeat

The interface should help the athlete understand:

1. What can I do now?

2. What am I currently doing?

3. What happened?

4. What should I inspect next?

At any point, the next relevant action should be visually clearer than secondary information.

The interface should not expose every available function at the same visual level.

---

# 4. Mobile First

The primary design target is a mobile viewport around 390 pixels wide.

Every new screen should first be designed and verified for:

- 320 × 700

- 390 × 844

Tablet and desktop layouts should expand the mobile structure rather than replace it with a different information architecture.

Mobile-first does not mean making every element full width.

It means prioritising:

- the essential task

- thumb reach

- safe areas

- readable text

- compact but comfortable spacing

- minimal horizontal complexity

Desktop may use:

- wider content regions

- side-by-side comparisons

- multi-column analytics

- persistent supporting information

The order and meaning of the content should remain consistent across breakpoints.

---

# 5. One Primary Purpose per Screen

Every screen should have one clearly identifiable primary purpose.

Examples:

## Home

Help the athlete decide what to do next.

## Train Setup

Configure and start a training session or template.

## Active Training

Capture and review the current training activity.

## Assess

Select, understand, start or resume an assessment.

## Assessment Execution

Complete the current assessment protocol.

## Analyze

Inspect past performance and development.

## Settings

Manage data, preferences and product configuration.

A screen should not give equal visual prominence to setup, execution, analytics, history and administration at the same time.

Secondary functions should use:

- expandable sections

- secondary screens

- tabs

- sheets

- contextual actions

- compact summaries

---

# 6. Prioritise the Current Task

The interface should prioritise what the athlete needs at the current moment.

During training execution, the primary information is:

- current target

- expected or selected handle

- measurement input or capture state

- primary action

- immediate feedback

- current progress

The following information is secondary during execution:

- full session metadata

- long-term history

- every available chart

- advanced filter controls

- device configuration

- editable setup fields

Secondary content may remain accessible, but it should not compete with the current shot.

Product rule:

&gt; Execution screens prioritise execution. Analysis screens prioritise interpretation.

---

# 7. Progressive Disclosure

Only show information when it becomes useful.

Preferred hierarchy:

1. primary task

2. essential context

3. compact summary

4. optional details

5. advanced controls

Examples:

- Show the current target prominently.

- Keep the full block configuration available through a details action.

- Show three or four core metrics before detailed charts.

- Hide advanced filters until requested.

- Keep protocol explanations accessible without permanently occupying the main screen.

Do not permanently show every:

- explanation

- setting

- metric

- chart

- filter

- protocol rule

Progressive disclosure must not hide information required for safe or valid execution.

---

# 8. Visual Hierarchy

Every screen should distinguish between three levels.

## Primary

The current task or most important action.

Examples:

- Start Training

- Add Shot

- Resume Assessment

- Current Target

- View Full Results

## Secondary

Information or actions that support the primary task.

Examples:

- session summary

- progress

- threshold context

- compact metrics

- filters

- View Protocol

## Tertiary

Low-frequency or future-oriented content.

Examples:

- device information

- Coming Next

- technical metadata

- export

- destructive actions

Primary, secondary and tertiary content must not use identical size, spacing, shadow and contrast.

---

# 9. Page Structure

A standard mobile screen should normally contain:

1. compact page heading

2. optional one-sentence context

3. primary content area

4. secondary content

5. clear bottom spacing above navigation

Avoid repeatedly showing the full product header on every screen.

## Home

May show the full product identity:

- Curling Performance

- product subtitle

## Functional Screens

Train, Assess, Analyze and Settings should generally use a compact contextual header.

Examples:

- Train

- Assess

- Analyze

- Settings

- Release Time Core Assessment

The product name does not need to consume a large card at the top of every functional screen.

---

# 10. Mobile Navigation

The primary mobile navigation must respect the operating-system safe area.

It must never sit directly on top of:

- the iOS Home Indicator

- browser controls

- gesture areas

- device cut-outs

## Required Behaviour

The navigation should:

- sit above `env(safe-area-inset-bottom)`

- include sufficient internal bottom padding

- provide at least 44 × 44 pixel touch targets

- remain visually separated from scrolling content

- use a stable background

- not cover buttons or form fields

- remain usable with one hand

- show the active destination clearly

- use text labels consistently

The page content must include bottom padding equal to:

- navigation height

- safe-area inset

- an additional visual gap

The last content element must remain fully scrollable above the navigation.

## Preferred Visual Treatment

The navigation may be:

- a fixed bottom surface

- a slightly elevated or floating navigation bar

- contained within safe horizontal margins

It should not appear as five compressed buttons touching the bottom edge of the device.

## Navigation Labels

Primary destinations remain:

- Home

- Train

- Assess

- Analyze

- Settings

Do not hide core destinations behind a menu unless the navigation model changes intentionally.

---

# 11. Card System

A card should group information that belongs together.

A card should not be the default wrapper for every section.

## Use a Card When

- content has a distinct purpose

- the section may be acted on independently

- separation improves understanding

- the content benefits from a contained surface

- the section needs a clear relationship between title, data and action

## Do Not Use a Card When

- a heading and short text are sufficient

- the content is merely a page introduction

- the card would contain only another card

- multiple consecutive cards have equal weight

- the wrapper adds spacing without adding meaning

## Card Hierarchy

### Primary Card

Used for the main task or action.

Examples:

- Today's Plan

- Current Shot

- Assessment Resume

- Completion Summary

### Standard Section Card

Used for grouped analytics or configuration.

Examples:

- Block Results

- Threshold Selection

- Session Setup

### Compact Surface

Used for small summaries or metadata.

Examples:

- KPI values

- device status

- protocol status

Avoid nested card-on-card structures unless the inner surfaces are clearly lightweight data tiles.

---

# 12. Card Density

Multiple large full-width cards create excessive scroll length and weaken hierarchy.

On mobile:

- combine closely related information

- reduce excessive top and bottom padding

- use dividers inside one section where appropriate

- use compact metadata rows

- avoid a separate card for every empty chart

- collapse advanced sections

Large cards should be reserved for meaningful content.

A screen containing more than five major cards should be reviewed for grouping and progressive disclosure.

---

# 13. Spacing

Spacing should communicate hierarchy, not merely make the interface larger.

General principle:

- smaller gaps within a logical group

- medium gaps between related groups

- larger gaps between separate sections

Avoid using large vertical spacing between every label, input and action.

Forms should feel structured and efficient rather than sparse.

Exact spacing tokens belong in `DESIGN_[SYSTEM.md](http://SYSTEM.md)`.

The mobile implementation should generally prefer:

- compact page gutters

- consistent card padding

- smaller spacing within field groups

- clear section separation

- generous touch-target height without excessive vertical whitespace

---

# 14. Action Hierarchy

A screen should normally have one primary action.

## Primary Action

Examples:

- Start Training

- Add Shot

- Start Assessment

- Continue

- View Full Results

Use the strongest visual treatment.

## Secondary Action

Examples:

- View Protocol

- Pause

- View Analyze

- Edit Details

Use a lower-emphasis button or text action.

## Tertiary Action

Examples:

- Skip explanation

- Reset

- Dismiss

Use text or subtle controls.

## Destructive Action

Examples:

- Abandon Assessment

- Delete Run

- Clear History

Use destructive styling only when the action has irreversible or significant consequences.

Do not use primary-button styling for option selection.

---

# 15. Controls and Selection Patterns

Different interaction types require different visual patterns.

## Buttons

Use for actions that cause an event.

Examples:

- Start

- Save

- Add

- Continue

- Export

## Segmented Controls

Use for choosing exactly one option from a small, stable set.

Examples:

- In / Out

- Draw / Takeout

- Standard / Tight / Custom

- Training / Assessments

A segmented control should visually behave as one grouped component, not as several unrelated buttons.

## Chips

Use for:

- filters

- compact metadata

- optional multi-selection

- status indicators

## Inputs

Use when the athlete must enter a value.

Avoid using a text field where a compact selector is more reliable.

## Info Actions

Use to explain meaning or interpretation.

Do not place info icons where the selectable label itself becomes hard to tap or read.

---

# 16. Forms

Forms should be grouped by decision, not by database structure.

For training setup, possible groups include:

## Session

- session name

- notes

## Training Block

- block name

- training category

- measurement mode

## Target Configuration

- target mode

- range

- accuracy thresholds

Do not place every field inside a separate visual container.

## Form Behaviour

- labels remain visible

- placeholders provide examples, not critical instructions

- validation appears near the affected field

- the keyboard must not cover the primary action

- the primary action should remain reachable

- selected states must remain obvious

- optional fields must be clearly optional

Long setup forms should use:

- sections

- compact summaries

- progressive disclosure

- sensible defaults

---

# 17. Active Training Experience

The active training screen is the most interaction-sensitive area of the platform.

It should prioritise:

1. current block

2. current target

3. measurement or capture

4. handle and shot classification

5. primary shot action

6. immediate feedback

7. progress

## Current Block

Show a compact summary.

Avoid using a large card containing long metadata and a large secondary action side by side if it reduces readability.

## Current Shot

The target time should be one of the strongest visual elements on the screen.

The shot-entry area should be reachable without excessive scrolling.

## Manual Entry

The numeric field, handle selection, shot type and Add Shot action should remain grouped.

## Auto Capture

Auto Capture configuration should not permanently occupy the main execution area after capture begins.

Once active, replace setup controls with a compact status and essential actions.

## Analytics During Training

Show a compact summary first.

Detailed charts should appear:

- below the execution area

- in collapsible sections

- or in a separate Live Analysis view

Session details and editable metadata should not sit after multiple analytics sections as a large repeated form.

---

# 18. Assessment Experience

Assessment screens should feel more controlled and protocol-driven than normal training.

## Overview

Prioritise:

- purpose

- duration

- number of stones

- threshold selection

- setup confirmation

- primary start action

## Execution

Prioritise:

- current phase

- block

- target

- expected handle

- progress

- capture status

- immediate attempt feedback

## Results

Prioritise:

1. core metrics

2. active threshold context

3. block results

4. target and handle comparisons

5. protocol integrity

6. shot-level detail

Do not display every explanation permanently.

---

# 19. Analyze Experience

Analyze should provide a clear reading order.

Preferred hierarchy:

1. context and filters

2. key performance summary

3. primary trend

4. accuracy and bias

5. target analysis

6. handle analysis

7. detailed shots or history

Avoid presenting analysis as a long sequence of unrelated cards.

## Core Metrics

Metrics should form a coherent summary group.

Do not create empty KPI tiles with misleading zero values when no data exists.

Prefer:

- meaningful empty state

- hidden metric value

- action explaining how to generate data

## Charts

A chart should only render when it can communicate useful information.

Do not show an empty coordinate system when no data exists.

Instead show a compact empty state such as:

&gt; Add at least two shots to see the release trend.

The empty state should not consume the full height of a completed chart.

---

# 20. Chart Principles

Every chart must answer a clear question.

Examples:

- Is my release timing becoming more consistent?

- Is my error systematically above or below target?

- Do my handles differ?

- Can I reproduce different targets?

Charts should include:

- clear title

- one-sentence purpose

- accessible text summary

- meaningful axes

- readable touch targets

- responsive height

- useful tooltip

- visible threshold context where relevant

Avoid:

- decorative charts

- radar charts

- gauges

- excessive animation

- large blank chart containers

- multiple charts that communicate the same pattern

On mobile, prefer one chart per row.

---

# 21. Empty States

Empty states should be compact and purposeful.

They should explain:

- why nothing is shown

- what is required

- what action is available

Do not display:

- zero metrics that resemble real results

- large empty cards

- blank charts

- headings with no content

Examples:

&gt; Add a shot to begin the live summary.

&gt; Complete another comparable assessment to see development over time.

&gt; No handle data is available in this selection.

Where appropriate, include one relevant action.

---

# 22. Sticky and Fixed Elements

Fixed elements require special care because they reduce available viewport space.

Allowed examples:

- bottom navigation

- compact execution action area

- filter bar where repeated access is essential

Requirements:

- respect safe areas

- never cover content

- never cover the keyboard

- avoid multiple competing sticky layers

- maintain a clear z-index hierarchy

- preserve access to the final content element

Avoid combining:

- sticky header

- sticky filters

- sticky action bar

- fixed bottom navigation

unless the remaining viewport is still usable on small devices.

---

# 23. Touch Interaction

Interactive targets should be at least approximately 44 × 44 pixels.

Important controls should:

- have sufficient spacing

- not depend on precise tapping

- remain usable with cold or slightly wet hands

- avoid tiny standalone icons

- show a clear selected state

- show a clear disabled state

Do not place critical controls directly against device edges.

---

# 24. Safe Areas and Device Chrome

All fixed or edge-aligned UI must account for:

- `safe-area-inset-top`

- `safe-area-inset-bottom`

- iOS Home Indicator

- browser toolbars

- virtual keyboard

- landscape orientation where supported

Safe-area handling is a product requirement, not optional visual polish.

Testing only in a desktop browser with a narrow viewport is insufficient.

---

# 25. Responsive Behaviour

Responsive design should adapt density and composition.

## Mobile

- one primary column

- compact headings

- stacked cards where necessary

- minimal persistent controls

- no horizontal scrolling

- charts and tables adapted to cards

- safe bottom navigation

## Tablet

- broader content cards

- selected two-column sections

- persistent supporting information where helpful

## Desktop

- wider analytics layouts

- side-by-side comparison

- reduced excessive vertical stacking

- content width limits for readability

- navigation consistent with the same destinations

Desktop should not merely stretch mobile cards across the screen.

---

# 26. Accessibility

Design must not rely only on:

- colour

- position

- iconography

- animation

Selected, active, warning and error states require textual or semantic confirmation.

Requirements include:

- semantic headings

- keyboard access

- visible focus states

- labelled controls

- accessible chart summaries

- sufficient contrast

- understandable disabled states

- modal focus management

- screen-reader-compatible navigation state

Accessibility requirements apply to both desktop and mobile layouts.

---

# 27. Performance and Perceived Speed

The interface should respond immediately to direct interaction.

Avoid unnecessary:

- page transitions

- loading states

- animations

- layout shifts

- large visual assets

- rerendering of hidden analytics

Actions such as Add Shot should provide immediate state confirmation.

Animations should clarify:

- navigation

- completion

- expansion

- state change

They should not delay training interaction.

---

# 28. Future Expansion

Future modules may include:

- Training Templates

- Schedule

- Coach

- Team

- Devices

- Athlete Profile

- Cloud Sync

The interface should support these modules without giving every future capability a permanent primary-navigation destination.

Potential future hierarchy:

- primary athlete workflow remains Home, Train, Assess and Analyze

- Coach, Team and Schedule may appear contextually or through workspace navigation

- Settings contains configuration, data and account management

- Home surfaces assigned or planned activity

Do not reserve large permanent interface areas for unimplemented capabilities.

Coming-soon content should remain compact and secondary.

---

# 29. Current Mobile Refactor Priorities

Based on the current implemented interface, the first design-refinement work should prioritise:

## Priority 1 — Bottom Navigation and Safe Area

- move navigation above the iOS Home Indicator

- increase touch reliability

- add correct bottom padding

- ensure content is never covered

- verify on physical iOS devices or realistic browser environments

## Priority 2 — Compact Functional Headers

- retain the full product header on Home

- use smaller contextual headings on Train, Assess, Analyze and Settings

- recover vertical space

## Priority 3 — Reduce Card Density

- remove cards that add no grouping meaning

- combine related sections

- differentiate primary, standard and compact surfaces

- avoid equal visual weight across all content

## Priority 4 — Active Training Focus

- keep current target and shot entry above the fold where possible

- reduce persistent setup content

- collapse Auto Capture configuration after activation

- move detailed analytics below or behind progressive disclosure

- avoid repeating Session Details as a large form during execution

## Priority 5 — Analytics Empty States

- do not render large empty chart frames

- do not show zero values as measured results

- replace them with compact instructional empty states

## Priority 6 — Form Compression

- group fields by decision

- reduce unnecessary vertical spacing

- use segmented controls consistently

- keep primary setup actions reachable

## Priority 7 — Assess Landing Balance

- retain the clear primary Assessment card

- reduce unnecessary permanent empty space where useful supporting content exists

- keep detailed history under Analyze

- avoid adding secondary cards without clear purpose

---

# 30. Design Review Questions

Before approving a mobile screen, ask:

1. What is the primary purpose of this screen?

2. What is the single most important action?

3. Is that action immediately recognisable?

4. Can the user complete the task with one hand?

5. Does the screen respect the device safe area?

6. Is any content covered by fixed navigation?

7. Are too many sections presented as equal cards?

8. Can secondary information be disclosed progressively?

9. Is the screen unnecessarily long?

10. Does every chart currently have useful data?

11. Are option selectors visually distinct from action buttons?

12. Is the final content fully reachable above the bottom navigation?

13. Does the interface remain understandable without colour?

14. Does the mobile design feel intentional rather than compressed?

15. Does the screen behave correctly with the keyboard open?

---

# 31. Definition of Done for Mobile UX

A new or redesigned screen is complete only when:

- its primary purpose is clear

- its primary action is visually dominant

- safe areas are respected

- all controls are reliably tappable

- no content is hidden behind navigation

- no horizontal overflow exists

- the keyboard does not block required actions

- empty states are meaningful and compact

- charts provide value when rendered

- selected states are accessible

- the screen works at 320 × 700

- the screen works at 390 × 844

- tablet and desktop layouts remain coherent

- surrounding Train, Assess and Analyze workflows remain consistent

---

# 32. Current Product Decision

The Curling Performance Platform will use:

- mobile-first information architecture

- safe-area-aware bottom navigation

- compact contextual headers outside Home

- one primary purpose per screen

- one dominant primary action per state

- progressive disclosure

- differentiated card hierarchy

- segmented controls for mutually exclusive options

- chips for filters and compact statuses

- action buttons only for actions

- execution-first Training and Assessment screens

- compact empty states instead of empty charts

- responsive analytics designed for athlete questions

- accessible and thumb-friendly interaction

- future expansion without premature navigation complexity

These principles apply to all future interface work and to the planned mobile design-refinement pass.