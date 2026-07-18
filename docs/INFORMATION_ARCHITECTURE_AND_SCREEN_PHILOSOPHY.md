# Information Architecture and Screen Philosophy

&gt; This document defines the mental model of the Curling Performance Platform.

&gt;

&gt; Unlike the Design System or the Visual Language, it does not describe how components look. Instead, it defines what every screen exists to accomplish, how information should flow through the product and how users should think while using it.

&gt;

&gt; Every future feature should strengthen this architecture rather than compete with it.

---

# Purpose

The Curling Performance Platform is not a collection of features.

It is a sequence of mental states.

Every screen exists because the athlete is asking a different question.

The interface should guide athletes naturally from one state of mind to the next.

The user should never need to wonder:

- Where am I?

- What should I do next?

- Why am I on this screen?

---

# Core Philosophy

The application follows the athlete's journey.

Not the software's architecture.

The product should mirror how athletes actually think during training.

The mental flow is:

Prepare

↓

Train

↓

Measure

↓

Understand

↓

Improve

The interface should support this progression without interruption.

---

# Navigation Philosophy

Primary navigation does not represent features.

It represents stages of the athlete's workflow.

Each destination has one primary responsibility.

Destinations should not compete with each other.

Whenever a feature belongs clearly to one mental stage, it should live there.

Avoid duplicating the same capability across multiple screens simply because it is technically possible.

---

# Home

## Purpose

Provide orientation.

Not information.

---

## The Question

What should I do now?

---

## Primary Responsibilities

- orient the athlete

- continue interrupted work

- surface today's priority

- highlight recent progress

- reduce decision making

---

## Should Immediately Answer

- Do I already have an active Training or Assessment?

- What is my next meaningful action?

- What happened recently?

- Is there anything requiring attention?

---

## Should Not Become

- an analytics dashboard

- a settings screen

- a history browser

- a marketing page

- a feature catalogue

---

## Information Priority

1. Current activity

2. Today's priority

3. Recent progress

4. Quick actions

5. Supporting information

---

## Desired Feeling

"I'm ready."

---

# Train

## Purpose

Prepare deliberate practice.

---

## The Question

How should I train?

---

## Primary Responsibilities

- configure a meaningful Training Session

- remove unnecessary decisions

- make setup feel lightweight

- prepare execution

---

## Should Immediately Answer

- What kind of training am I about to do?

- What weight strategy am I using?

- What target will I train?

- Am I ready to start?

---

## Should Not Become

- a configuration wizard

- a settings page

- a technical administration interface

---

## Information Priority

1. Training objective

2. Training configuration

3. Validation

4. Optional details

---

## Desired Feeling

"I know exactly what I'm about to train."

---

# Active Training

## Purpose

Support execution.

Everything else is secondary.

---

## The Question

What do I need to do right now?

---

## Primary Responsibilities

- present the current target

- collect the current shot

- provide immediate feedback

- maintain flow

---

## Should Immediately Answer

- What is my current target?

- What shot am I entering?

- Has it been recorded?

- What comes next?

---

## Secondary Responsibilities

- show compact progress

- show meaningful live feedback

- allow limited editing

---

## Should Not Become

- an analytics dashboard

- a settings page

- a reporting interface

---

## Information Priority

1. Current Target

2. Current Shot

3. Immediate Result

4. Session Progress

5. Live Summary

6. Detailed Analytics

---

## Desired Feeling

"I stay in rhythm."

---

# Assessment

## Purpose

Measure performance under controlled conditions.

---

## The Question

Where do I currently stand?

---

## Primary Responsibilities

- communicate the protocol

- create confidence

- ensure consistency

- guide execution

---

## Should Immediately Answer

- What Assessment is this?

- What will be measured?

- How long does it take?

- How should I perform it?

---

## During Execution

The athlete should think only about the next stone.

Never about the software.

---

## Should Not Become

- a tutorial

- a coaching session

- a report

- a comparison tool

---

## Information Priority

1. Current protocol

2. Current shot

3. Progress

4. Immediate feedback

5. Protocol status

---

## Desired Feeling

"This is structured and reliable."

---

# Analyze

## Purpose

Generate understanding.

Not display data.

---

## The Question

What did I learn?

---

## Primary Responsibilities

- explain performance

- reveal patterns

- support reflection

- encourage deliberate improvement

---

## Should Immediately Answer

- What matters most?

- What changed?

- What should I investigate?

- Where should I improve?

---

## Information Hierarchy

1. Key takeaway

2. Summary metrics

3. Supporting charts

4. Detailed analysis

5. Raw history

---

## Should Not Become

- a spreadsheet

- a database browser

- a chart gallery

- a statistics textbook

---

## Desired Feeling

"I understand something I didn't know before."

---

# Settings

## Purpose

Create trust.

---

## The Question

Can I rely on this platform?

---

## Primary Responsibilities

- manage data

- manage preferences

- manage devices

- explain storage behaviour

---

## Should Immediately Answer

- Where is my data?

- Can I export it?

- Can I restore it?

- Can I trust this system?

---

## Should Not Become

- a feature dump

- a troubleshooting page

- a hidden developer menu

---

## Information Priority

1. Data

2. Devices

3. Preferences

4. Advanced functionality

---

## Desired Feeling

"My data is safe."

---

# Cross-Screen Journey

The application follows one continuous story.

Home

↓

Train

↓

Active Training

↓

Analyze

or

Home

↓

Assessment

↓

Assessment Result

↓

Analyze

Transitions should feel natural.

Every screen prepares the next one.

---

# Information Flow

Information should always move from:

Action

↓

Feedback

↓

Understanding

↓

History

Never in reverse.

Historical information should never compete with current execution.

---

# Progressive Information

Every screen follows the same information pattern.

Immediate

↓

Important

↓

Supporting

↓

Advanced

The user should almost never need advanced information first.

---

# Cognitive Load

Every screen has a cognitive budget.

Do not exceed it.

If a screen contains many unrelated decisions, split responsibilities.

If a screen contains many unrelated charts, group them.

If a screen contains many unrelated actions, prioritise them.

The interface should reduce thinking about the software.

Not about curling.

---

# Context Preservation

Users should never lose context.

When navigating:

- preserve filters where appropriate

- preserve selected tabs

- preserve unfinished work

- preserve mental continuity

The application should feel like one continuous experience rather than independent pages.

---

# Decision Architecture

The platform should minimise unnecessary choices.

Instead of asking:

"What do you want to configure?"

Guide users through:

"What are you trying to achieve?"

The interface should encourage good decisions naturally.

---

# Information Lifetimes

Not all information deserves permanent visibility.

---

## Permanent

Core navigation.

Current activity.

Current target.

Current result.

---

## Temporary

Success messages.

Warnings.

Progress indicators.

---

## On Demand

Protocol details.

Advanced filters.

Detailed explanations.

Technical information.

---

## Historical

Completed sessions.

Assessments.

Comparisons.

Exports.

Historical information should remain accessible without dominating current workflows.

---

# Interruptions

Training is frequently interrupted.

The platform should recover gracefully.

Users should always understand:

- what was happening

- what remains to be done

- how to continue

Recovery should require as few decisions as possible.

---

# Future Features

New capabilities should integrate into the existing mental model.

Examples:

Coach

Supports improvement.

Not execution.

---

Team

Provides collaboration.

Not analytics.

---

Training Plans

Guide preparation.

Not reporting.

---

Automatic Timing

Improves execution.

Not configuration.

---

Cloud Sync

Builds trust.

Not performance.

Whenever a new feature cannot clearly answer:

"Which mental stage does this belong to?"

its place in the product should be reconsidered.

---

# Architecture Principles

Every screen should have:

One purpose.

One primary question.

One primary action.

One visual focal point.

One logical next step.

If a screen attempts to solve multiple unrelated problems, it should be redesigned.

---

# Success Criteria

A successful information architecture means that athletes rarely think about the software itself.

Instead, they naturally progress through the cycle:

Prepare

↓

Train

↓

Measure

↓

Understand

↓

Improve

The application should feel like a quiet partner in this process.

It should guide attention, reduce friction and continuously reinforce purposeful training.

Every future feature should strengthen this journey rather than interrupt it.