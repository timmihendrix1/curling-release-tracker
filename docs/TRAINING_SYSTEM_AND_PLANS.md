# Training System and Plans

&gt; This document defines the product model, scope, user experience and architectural direction for reusable training plans in the Curling Performance Platform.

&gt;

&gt; It describes the intended first implementation while preserving a clear path toward future training types beyond release timing.

&gt;

&gt; It is a product and domain specification. It does not prescribe detailed component implementation unless required to protect the product model.

---

# 1. Purpose

The platform currently supports individual release-time training sessions using:

- Fixed Weight

- Variable Weight

- Blind Weight

Athletes can create training blocks during a session and configure each block independently.

However, athletes often repeat similar training structures.

For example:

```text

8 stones Fixed Weight

Alternating handles

16 stones Variable Weight

Alternating handles

8 stones Blind Weight

Free handles

```

Today, the athlete must recreate this structure manually whenever the training is repeated.

Training Plans should make these repeatable structures reusable.

The first version should answer one simple question:

&gt; How can an athlete save a specific sequence of configured training blocks and start it again without rebuilding it manually?

Training Plans are not intended to become a calendar, coaching engine or seasonal planning system in the first version.

They are reusable, ordered training configurations.

---

# 2. Product Goal

Training Plans should help athletes:

- prepare a training structure before going onto the ice

- repeat proven training sequences

- reduce setup time between exercises

- define the intended number of stones in advance

- predefine handle behaviour

- move through exercises in a deliberate order

- make comparable training sessions easier to repeat

- preserve flexibility while avoiding unnecessary reconfiguration

The experience should remain fast enough for direct use at the rink.

The plan should guide the session without making the athlete feel locked into a rigid protocol.

---

# 3. Version 1 Scope

Version 1 supports saved plans composed of the existing release-time training modes:

- Fixed Weight

- Variable Weight

- Blind Weight

Each step may define:

- training mode

- number of stones

- handle configuration

- measurement mode

- target configuration

- mode-specific settings

- position within the plan

A plan can contain any number and order of supported steps.

Example:

```text

Release Consistency

1. Fixed Weight

   8 stones

   Alternating handles, starting In

   Backline–Hog

   Target: 3.75 s

2. Variable Weight

   16 stones

   Alternating handles, starting Out

   Backline–Hog

   Smart Random: 2.50–4.50 s

3. Blind Weight

   8 stones

   Free handles

   Backline–Hog

   Fixed target: 3.75 s

```

The athlete must remain free to define the structure.

The platform should not impose predefined training combinations.

---

# 4. Explicitly Out of Scope for Version 1

Version 1 does not include:

- calendars

- weekly schedules

- recurring plans

- seasonal periodisation

- coach assignment

- team plans

- shared plans

- plan marketplaces

- AI-generated plans

- automatic progression

- performance-based plan adaptation

- achievement systems

- exercise recommendations

- plan compliance scoring

- remote coach monitoring

- cloud synchronisation

- non-release-time training execution

These may be added later.

Their absence should not block the first useful implementation.

---

# 5. Core Product Principle

A Training Plan is not training data.

A Training Plan is a reusable configuration that orchestrates a future training execution.

```text

Training Plan

→ defines what should happen

Training Session

→ records what actually happened

```

Editing a saved plan must never alter previously completed sessions.

Historical sessions remain independent records of the configuration that was actually executed.

---

# 6. Domain Hierarchy

For Version 1, the domain hierarchy is:

```text

Training Plan

  └── Ordered Plan Steps

        └── Release Timing Plan Step Configuration

Plan Execution

  └── Training Session

        └── Training Blocks

              └── Shots

```

A Training Plan contains ordered Plan Steps.

When a release-time plan is started, its steps are translated into preconfigured Training Blocks inside one Training Session.

```text

Training Plan

  Step 1

  Step 2

  Step 3

Start Plan

Training Session

  Block 1

  Block 2

  Block 3

```

This preserves the existing session model:

```text

Session

→ Blocks

→ Shots

```

The Training Plan remains an orchestration layer above the existing training domain.

---

# 7. Why Plan Steps Are Required

A plan must not store only a list of modes.

This would be insufficient:

```text

Fixed

Variable

Blind

```

Each step must represent a complete, reusable training instruction.

For example:

```text

Fixed Weight

8 stones

Alternating handles

Backline–Hog

Target 3.75 s

```

The Plan Step therefore contains both:

- the type of training

- the configuration needed to execute it

This gives the athlete enough freedom to build meaningful plans without reconfiguring each exercise at runtime.

---

# 8. Training Plan

A Training Plan is a reusable ordered collection of Plan Steps.

A plan should contain at least:

- unique identifier

- name

- optional description

- ordered steps

- creation timestamp

- last modified timestamp

- version or schema information if required for migration

Potential conceptual model:

```ts

type TrainingPlan = {

  id: string

  name: string

  description?: string

  steps: TrainingPlanStep[]

  createdAt: string

  updatedAt: string

}

```

The exact implementation should follow the existing project conventions.

The plan itself must not contain:

- recorded shots

- session analytics

- completion data from past executions

- live draft state

- mutable references to historical sessions

---

# 9. Training Plan Step

A Training Plan Step is one ordered unit inside a plan.

For Version 1, all steps are Release Timing Plan Steps.

The model should nevertheless be discriminated by step type so additional training domains can be added later.

Conceptually:

```ts

type TrainingPlanStep =

  | ReleaseTimingPlanStep

```

Future extension:

```ts

type TrainingPlanStep =

  | ReleaseTimingPlanStep

  | RotationPlanStep

  | LinePlanStep

  | SweepingPlanStep

  | AssessmentPlanStep

```

Version 1 should not implement these future types.

The architecture should simply avoid assuming that every future step will always be a release-time block.

---

# 10. Release Timing Plan Step

A Release Timing Plan Step configures one future release-time Training Block.

It should contain at least:

- unique step identifier

- optional step name

- step type

- training mode

- number of stones

- handle configuration

- measurement mode

- target configuration

- mode-specific configuration

- position within the plan through array order

Conceptually:

```ts

type ReleaseTimingPlanStep = {

  id: string

  type: 'release-timing'

  name?: string

  mode: 'fixed' | 'variable' | 'blind'

  completion: ShotCountCompletion

  handleStrategy: HandleStrategy

  measurementMode: MeasurementMode

  configuration: ReleaseTimingStepConfiguration

}

```

The final structure should reuse existing domain types where safe.

Do not duplicate established values for:

- mode

- measurement mode

- target source

- handle

- Smart Random configuration

---

# 11. Number of Stones

For Version 1, every Release Timing Plan Step is completed through a defined number of saved shots.

The user-facing field should be:

&gt; Number of stones

Example:

```text

8 stones

16 stones

32 stones

```

Internally, this should be modelled as a completion rule rather than treated only as descriptive metadata.

Conceptually:

```ts

type ShotCountCompletion = {

  type: 'shot-count'

  value: number

}

```

This preserves a clean extension path for future training types that may use:

- duration

- repetitions

- completed protocol

- manual completion

- sensor-defined completion

Version 1 should expose only shot-count completion for Release Timing Plan Steps.

Do not add unused completion types to the user interface.

---

# 12. Handle Configuration

Each step must allow the user to define how handles should behave during execution.

Version 1 should support at least:

## Free

The athlete chooses the handle for every shot.

```text

Free

```

No automatic handle is imposed.

## In only

Every shot defaults to or requires In handle.

```text

In only

```

## Out only

Every shot defaults to or requires Out handle.

```text

Out only

```

## Alternating, starting In

The expected sequence is:

```text

In

Out

In

Out

...

```

## Alternating, starting Out

The expected sequence is:

```text

Out

In

Out

In

...

```

Conceptually:

```ts

type HandleStrategy =

  | { type: 'free' }

  | { type: 'fixed'; handle: 'in' | 'out' }

  | { type: 'alternating'; startingHandle: 'in' | 'out' }

```

A custom handle sequence may be considered later:

```text

In

In

Out

Out

```

It is not required in Version 1.

The data model should not make such an extension impossible, but no speculative complexity should be added solely for this future case.

---

# 13. Handle Behaviour During Execution

The plan configuration should reduce interaction.

It should not create unnecessary friction.

## Free strategy

The normal handle selector remains available.

The user chooses the handle per shot.

## Fixed strategy

The configured handle is preselected.

The athlete should not need to select it again for every shot.

Whether the handle may still be changed during execution is a product decision.

The preferred Version 1 behaviour is:

- preselect the configured handle

- allow deliberate override

- record the handle actually used

The saved Shot remains the source of truth.

## Alternating strategy

The application automatically preselects the expected handle for the next shot.

After a shot is saved, the expected handle advances.

Example:

```text

Shot 1 → In

Shot 2 → Out

Shot 3 → In

```

The preferred behaviour is:

- show the expected handle clearly

- preselect it automatically

- allow manual override when reality differs

- continue the sequence based on shot position, not on the manually selected value

A manually overridden shot must record the handle actually used.

The plan should guide execution, not falsify data.

---

# 14. Training Modes

Version 1 supports the current release-time modes without changing their domain logic.

## Fixed Weight

A Fixed Weight step should allow configuration of:

- number of stones

- handle strategy

- measurement mode

- fixed target time

- any existing settings currently required to create a valid Fixed Weight block

Each created Shot continues to store its own immutable `targetTime`.

The step configuration becomes the source for the block's initial settings.

## Variable Weight

A Variable Weight step should allow configuration of:

- number of stones

- handle strategy

- measurement mode

- supported target source

- Smart Random range where applicable

- manual or coach-driven target behaviour where supported

- any existing settings currently required to create a valid Variable Weight block

The existing restrictions remain valid.

For example:

- Smart Random availability depends on Measurement Mode

- Hog-Hog must not receive Back-Hog defaults

- no new ranges should be invented

## Blind Weight

A Blind Weight step should allow configuration of:

- number of stones

- handle strategy

- measurement mode

- Blind Weight target source

- fixed target where applicable

- Smart Random range where applicable

- any existing settings required by the Blind Weight state machine

The existing Blind Weight process remains unchanged:

```text

Predict

→ Measure

→ Review

→ Save

```

The plan configures the step.

It does not bypass or simplify the integrity of Blind Weight capture.

---

# 15. Target Configuration

Each Release Timing Plan Step must store the configuration needed to initialise its future block.

It must not store a future Shot's immutable target value prematurely.

The distinction remains:

```text

Plan Step Configuration

→ defines how targets should be produced

Training Block

→ contains active runtime target state

Shot

→ stores the target actually used

```

Examples:

## Fixed

```text

Plan Step

Target source: Fixed

Target: 3.75 s

```

When executed:

```text

Block targetTime: 3.75 s

Shot targetTime: 3.75 s

```

## Smart Random

```text

Plan Step

Target source: Smart Random

Minimum: 2.50 s

Maximum: 4.50 s

```

When executed:

- the runtime block receives the configured range

- the initial `pendingTargetTime` is generated according to existing logic

- each saved Shot receives its actual target

- later plan edits do not change completed Shots

## Manual

```text

Plan Step

Target source: Manual

```

When executed:

- the athlete or coach enters the next target according to existing behaviour

- the plan defines the mode, not every future target value

---

# 16. Plan Order

Plan Steps are ordered.

The order defines the intended execution sequence.

Example:

```text

1. Fixed Weight

2. Variable Weight

3. Blind Weight

```

The user must be able to:

- add a step

- edit a step

- duplicate a step

- delete a step

- move a step up

- move a step down

Drag-and-drop may be considered later.

It is not required for Version 1.

On mobile, explicit move controls may be more reliable and accessible.

Array order should remain the source of truth unless the existing architecture strongly favours explicit position fields.

Avoid storing two competing order representations.

---

# 17. Plan Creation

The user should be able to create a plan from the Train area.

The creation flow should be simple:

```text

Train

→ Manage Training Plans

→ New Training Plan

```

Suggested sequence:

```text

Enter plan name

→ Add first step

→ Configure step

→ Add further steps

→ Review sequence

→ Save plan

```

A plan should require:

- a valid name

- at least one valid step

A step should not be saveable if its required mode-specific configuration is incomplete.

Validation should reuse existing training configuration rules wherever possible.

Do not create parallel validation logic that can drift from normal block setup.

---

# 18. Plan Editing

A saved plan can be edited from the Training Plan library.

Editable properties include:

- name

- optional description

- step configuration

- step order

- added steps

- removed steps

Editing a plan affects only future executions.

It must not mutate:

- active sessions already started from the plan

- completed sessions

- historical blocks

- historical shots

- historical analytics

When a plan execution begins, the required configuration should be copied into the execution context.

The active session must not depend on a live mutable reference to the saved plan.

---

# 19. Plan Duplication

Users should be able to duplicate a plan.

This supports common workflows such as:

```text

Release Consistency – Short

Release Consistency – Full

```

Duplication should:

- generate a new plan identifier

- generate new step identifiers

- copy all user-editable configuration

- use a clearly distinguishable default name

- create an independent plan

Later edits to either plan must not affect the other.

---

# 20. Plan Deletion

Users should be able to delete a saved plan.

Deletion removes only the reusable plan definition.

It must not remove:

- sessions previously started from the plan

- completed training history

- blocks

- shots

- analytics

If an active plan execution exists, deletion behaviour must be safe.

Preferred principle:

&gt; An already started execution can continue independently even if its source plan is later edited or deleted.

---

# 21. Train Navigation

Training Plans should live inside the existing Train area.

They should not require a new primary navigation tab in Version 1.

The current top-level navigation remains:

```text

Home

Train

Assess

Analyze

Settings

```

The Train area should offer two clear entry paths:

```text

Train

Quick Start

→ Create an individual training session

Training Plans

→ Start a saved structured session

```

Quick Start preserves the current free setup experience.

Training Plans add reuse without replacing flexible training.

---

# 22. Train Landing Experience

A future Train landing screen may contain:

```text

Quick Start

Start a custom session using:

- Fixed Weight

- Variable Weight

- Blind Weight

```

and:

```text

Training Plans

Release Consistency

3 steps · 32 stones

Weight Control

2 steps · 24 stones

Competition Preparation

4 steps · 48 stones

```

Primary actions may include:

- Start

- New Training Plan

- Manage Plans

The exact composition should follow the established visual hierarchy and design documentation.

Avoid turning the Train screen into a dense management dashboard.

The athlete's primary intent is usually to begin training.

Starting should remain more prominent than administration.

---

# 23. Where Plans Are Created and Managed

The preferred information architecture is:

```text

Train

→ Training Plans

→ Manage Training Plans

```

The management screen contains:

- list of saved plans

- plan summary

- Start action

- Edit action

- Duplicate action

- Delete action

- New Training Plan action

Settings should not be the primary home for Training Plans.

Plans are part of the training workflow, not application configuration.

Home may later surface a shortcut to a recent or selected plan, but it should not become the main editing location.

---

# 24. Plan Summary

A plan should be understandable without opening its editor.

A compact summary may include:

- plan name

- number of steps

- total planned stones

- mode composition

- last modified date where useful

Example:

```text

Release Consistency

3 steps · 32 stones

Fixed · Variable · Blind

```

Avoid showing every configuration field in the library view.

Detailed configuration belongs in the editor or plan detail view.

---

# 25. Starting a Plan

Starting a plan should require minimal interaction.

Preferred flow:

```text

Select plan

→ Review summary

→ Start Training

```

The application should not ask the user to reconfigure every step.

That would defeat the purpose of the plan.

A short pre-start review may show:

```text

Release Consistency

1. Fixed Weight · 8 stones · Alternating

2. Variable Weight · 16 stones · Alternating

3. Blind Weight · 8 stones · Free

Total: 32 stones

```

Potential quick adjustments before start may be considered later.

They are not required for Version 1.

The first implementation should prioritise predictable execution of the saved configuration.

---

# 26. Plan Execution

Starting a release-time Training Plan creates one Training Session.

Each Plan Step becomes one preconfigured Training Block.

```text

Start Plan

→ Create Session

→ Create Block from Step 1

→ Prepare later planned blocks or execution sequence

→ Activate first Block

```

The exact timing of block creation may follow one of two valid approaches:

## Eager creation

All blocks are created when the plan starts.

Advantages:

- complete session structure exists immediately

- order is explicit

- session survives later plan changes

- progress is easy to calculate

## Lazy creation

The next block is created only when the athlete reaches that step.

Advantages:

- less unused runtime state

- later steps may be adjusted before execution

For Version 1, eager creation is likely simpler and more predictable, provided inactive future blocks cannot incorrectly affect analytics or UI.

The implementation should choose the approach that best fits the current session architecture.

The behavioural requirement is more important than the mechanism:

&gt; The active execution must be independent from later changes to the saved plan.

---

# 27. Active Plan Execution Context

A session started from a plan should retain enough context to explain its origin.

Potential metadata:

```ts

type PlanExecutionReference = {

  sourcePlanId: string

  sourcePlanName: string

  sourcePlanUpdatedAt?: string

}

```

A stronger immutable snapshot may be required if future features need exact reconstruction.

Version 1 should avoid unnecessary duplication, but should preserve enough information that History can display:

```text

Started from: Release Consistency

```

The session must remain valid if the source plan is later:

- renamed

- edited

- duplicated

- deleted

The copied Block and Shot data remain authoritative.

---

# 28. Step Progress

During execution, the athlete should be able to understand:

- current step

- current shot count

- required shot count

- remaining steps

- total plan progress

Example:

```text

Step 2 of 3

Variable Weight

Shot 7 of 16

```

Plan progress should be useful but visually secondary to active shot capture.

The interface must not become crowded with planning metadata during execution.

The athlete's immediate task remains throwing and recording the current shot.

---

# 29. Automatic Step Completion

A Release Timing Plan Step is completed when the configured number of valid Shots has been saved for its corresponding Block.

Example:

```text

Required stones: 8

Saved valid shots: 8

→ Step complete

```

Drafts do not count.

This is especially important for Blind Weight:

- prediction draft does not count

- measured but unsaved review does not count

- only a saved Shot counts

Deleted Shots reduce the completed count.

Edited Shots remain part of the count unless the current domain model considers them invalid.

The completion rule should be based on persisted valid Shots, not transient UI actions.

---

# 30. Transition Between Steps

When a step reaches its required shot count, the application should provide a clear transition.

Preferred flow:

```text

Step complete

Fixed Weight

8 of 8 stones

Next:

Variable Weight

16 stones

[Continue]

```

The next step should not necessarily begin automatically without acknowledgement.

A deliberate Continue action gives the athlete time to:

- retrieve stones

- change focus

- review the next exercise

- pause briefly

- stop early if needed

The transition should remain lightweight.

It should not feel like ending and restarting an entirely separate training session.

---

# 31. Manual Step Changes

Athletes may need flexibility during real training.

Possible needs include:

- moving to the next step early

- returning to an earlier step

- adding extra shots

- stopping the plan

- skipping a step

Version 1 should define these behaviours explicitly.

Recommended minimum:

## Continue after completion

Normal transition to the next step.

## End training early

The current session may be completed with partial plan progress.

## Skip step

Optional for Version 1.

If implemented, the skipped step remains without Shots and is recorded as skipped or simply incomplete.

## Add extra shots

The preferred Version 1 behaviour is:

- reaching the planned count marks the step complete

- the athlete may deliberately continue the block if needed

- extra shots remain recorded in the same Block

- progress displays planned count and actual count clearly

Example:

```text

10 shots recorded

8 planned

```

The plan is guidance, not a hard barrier that blocks valid training data.

---

# 32. Deviations From the Plan

Real training does not always follow the intended structure.

The system must preserve actual behaviour.

Examples:

- handle overridden

- extra shots added

- step ended early

- step skipped

- session ended before all steps

- block settings adjusted during execution

The saved session should reflect what actually happened.

The plan defines intent.

The session records reality.

Analytics must use actual Shot and Block data, not the original plan configuration where they differ.

---

# 33. Editing an Active Planned Block

The platform should be cautious about allowing runtime changes to a planned block.

A practical Version 1 approach is:

- allow the same safe block adjustments currently supported in normal training

- never mutate previously saved Shots

- show that the execution now differs from the saved plan

- keep the source plan unchanged

Example:

```text

Plan target: 3.75 s

Runtime block changed to: 3.80 s

```

Future history may distinguish:

- planned configuration

- executed configuration

Version 1 does not need a complex compliance model.

The session's actual configuration remains authoritative.

---

# 34. Ending a Planned Session

The user must be able to end the session at any time.

When ending early, the app should clearly communicate:

- completed steps

- partially completed step

- remaining steps

- number of actual Shots

- number of planned Shots

The user should be able to confirm ending the training.

An incomplete plan execution is still a valid Training Session.

It should not be discarded merely because the full plan was not completed.

---

# 35. History

A completed planned session should appear in the existing History and Analyze workflows.

It should behave like any other Training Session.

Potential additional context:

- source plan name

- planned total stones

- actual total stones

- completed steps

- partial completion

However, Version 1 should avoid creating a completely separate analysis system for plans.

Existing Block and Shot analytics remain the primary analytical foundation.

The plan adds context.

It does not replace session analytics.

---

# 36. Analytics

Training Plan analytics are not a separate metric system in Version 1.

The existing analytics continue to operate on:

- Sessions

- Blocks

- Shots

Because every Release Timing Plan Step becomes a Training Block, existing analytics can support planned sessions without duplication.

Potential filters and grouping already follow naturally:

- by Block

- by mode

- by handle

- by target

- by Session

Do not calculate performance based on the saved plan definition.

Calculate from the actual execution data.

Future plan-level comparisons may include:

- repeated executions of the same plan

- completion consistency

- performance by recurring step

- planned versus actual volume

These are outside Version 1.

---

# 37. Persistence

Training Plans should be persisted independently from Training Sessions.

Conceptually:

```text

trainingPlans

currentSession

sessionHistory

```

Plan persistence should follow the project's current local-first principles.

Version 1 should remain usable offline.

A change to a plan must not trigger migrations of completed sessions.

Plan schema changes may require their own migration strategy as the feature evolves.

The implementation should avoid coupling Training Plan migration directly to Session migration unless technically justified.

---

# 38. Migration and Schema Evolution

Training Plans are a new persisted domain.

Their schema should be designed with future extension in mind.

Important invariants:

- unknown future step types must not corrupt unrelated plans

- existing plans should remain readable after additive changes

- step identifiers remain stable within a plan

- plan edits do not rewrite session history

- missing optional values receive safe defaults only where domain-valid

- invalid target configurations must not silently receive values from another Measurement Mode

The platform must not invent curling-specific defaults during migration without a documented basis.

---

# 39. Reusing Existing Domain Logic

Training Plan implementation should reuse existing logic for:

- block creation

- mode validation

- target validation

- Smart Random configuration

- Blind Weight configuration

- Measurement Mode restrictions

- Shot persistence

- analytics

- migration conventions

- time input

The plan feature should not create a second interpretation of what constitutes a valid Fixed, Variable or Blind block.

Preferred flow:

```text

Plan Step

→ map to existing block creation input

→ validate through shared domain logic

→ create Training Block

```

Avoid:

```text

Plan-specific block rules

Normal training block rules

```

Two parallel rule systems will drift.

---

# 40. Mapping Plan Steps to Training Blocks

A dedicated pure mapping boundary should translate a Release Timing Plan Step into the input required for a Training Block.

Conceptually:

```ts

createTrainingBlockFromPlanStep(step)

```

or:

```ts

mapPlanStepToTrainingBlockInput(step)

```

The exact function name should follow project conventions.

This mapping should:

- preserve the plan's mode

- preserve Measurement Mode

- preserve target source

- preserve valid Smart Random range

- initialise runtime target state correctly

- configure handle strategy for execution

- preserve the planned shot count separately from Shot data

- generate new runtime identifiers

- avoid copying plan step identifiers as Block identifiers

The Plan Step is a template.

The Training Block is a runtime entity.

---

# 41. Separation of Configuration and Runtime State

Training Plans should store stable configuration.

They should not store transient execution state.

Do not persist in the plan:

- active step index

- current shot number

- current alternating handle

- Blind Weight draft

- `pendingTargetTime` generated for a live session

- recorded release times

- recorded predictions

- runtime errors

- capture status

These belong to the active execution.

Example distinction:

```text

Plan Step:

Smart Random 2.50–4.50 s

Runtime Block:

pendingTargetTime 3.65 s

Shot:

targetTime 3.65 s

releaseTime 3.70 s

```

---

# 42. Future Training Types

The Training Plan model must allow future step types without claiming they already exist.

Potential future examples:

- stone rotation training

- line consistency training

- release line training

- weight and rotation combination

- sweeping training

- stone sensor exercises

- video-linked exercises

- tactical shot-making exercises

- assessment steps

A future stone-sensor step may measure:

- rotations

- rotation consistency

- line

- release direction

- other sensor-supported values

These metrics and capabilities remain open decisions.

No sensor capability should be assumed before the hardware and measurement model are validated.

---

# 43. Future Step-Type Architecture

Future step types may not map to the current `TrainingBlock` structure.

Therefore the durable model is:

```text

Training Plan

→ Plan Step

Plan Step Type

→ defines how the step executes

```

For Version 1:

```text

Release Timing Plan Step

→ creates a Release Timing Training Block

```

Later:

```text

Rotation Plan Step

→ creates a Rotation Exercise Execution

```

or:

```text

Combined Sensor Plan Step

→ creates a Sensor Exercise Execution

```

The Training Plan orchestrates ordered steps.

It should not own the internal measurement logic of every step type.

Each step type should eventually define:

- configuration schema

- validation

- execution UI

- completion rules

- recorded data

- analytics

Version 1 should establish only the minimum discriminated step model needed for this extension path.

---

# 44. Naming

The product should use clear, user-facing terminology.

Recommended terms:

## Training Plan

A saved reusable sequence of configured training steps.

## Step

One configured item inside a Training Plan.

## Training Session

One actual execution recorded in the platform.

## Training Block

One release-time block inside an executed Session.

Avoid introducing unnecessary distinctions such as:

- workout

- routine

- programme

- drill group

- template session

unless later research shows a clearer athlete-facing vocabulary.

In the code, more precise names such as `ReleaseTimingPlanStep` may be appropriate.

The UI may simply display:

&gt; Step

---

# 45. User Experience Principles

Training Plans must follow the existing product and UX principles.

Especially:

- mobile-first use at the rink

- minimal interaction between shots

- calm interfaces

- progressive disclosure

- clear hierarchy

- one primary action per state

- no unnecessary setup repetition

- actual training flow determines the UX

- editing and administration remain secondary to execution

The plan editor can be more configuration-heavy than active training.

The active execution must remain focused.

---

# 46. Plan Editor Composition

A Plan Editor should prioritise the sequence.

Suggested structure:

```text

Plan name

Step 1

Fixed Weight

8 stones

Alternating handles

Step 2

Variable Weight

16 stones

Alternating handles

Step 3

Blind Weight

8 stones

Free handles

Add Step

Save Plan

```

Each collapsed step summary should communicate:

- mode

- number of stones

- handle strategy

- essential target configuration

Detailed fields appear when editing the step.

Avoid showing every setting for every step simultaneously on mobile.

---

# 47. Step Creation Flow

When adding a step:

```text

Add Step

→ Select training type

→ Select release-time mode

→ Configure required settings

→ Save step

```

In Version 1, training type selection may be implicit because only Release Timing exists.

The UI may begin directly with:

```text

Choose mode:

Fixed Weight

Variable Weight

Blind Weight

```

The data model should still preserve an explicit step type internally.

Do not expose future empty categories in the interface.

---

# 48. Validation

Plan validation should occur at two levels.

## Plan-level validation

A valid plan requires:

- non-empty name

- at least one valid step

- unique plan identifier

- stable step order

## Step-level validation

A valid Release Timing Plan Step requires:

- supported mode

- positive number of stones

- valid handle strategy

- valid Measurement Mode

- complete mode-specific target configuration

- no unsupported Smart Random and Measurement Mode combination

- no cross-mode fallback values

Validation errors should be explained next to the affected step.

The user should not need to discover invalid configuration only when starting the plan.

---

# 49. Limits

Version 1 may define reasonable technical limits if required.

Examples:

- maximum plan name length

- maximum description length

- maximum number of steps

- maximum planned shot count

Any limits should:

- protect usability or technical stability

- be generous enough for real training

- be documented

- not be invented without a concrete reason

Do not impose arbitrary curling-volume restrictions.

---

# 50. Accessibility and Mobile Interaction

The plan library and editor must remain usable on a phone.

Important considerations:

- touch targets large enough for rink use

- no drag-and-drop-only interaction

- clear expanded and collapsed states

- no horizontally overflowing configuration tables

- destructive actions require confirmation

- handle strategy descriptions must be understandable without relying only on icons

- active progress must not depend only on colour

- step order must be visible and accessible

---

# 51. Empty States

## No saved plans

The Train area should explain the value clearly.

Example:

```text

No training plans yet

Save a sequence of Fixed, Variable and Blind Weight blocks so you can start the same structure again without rebuilding it.

```

Primary action:

```text

Create Training Plan

```

Quick Start remains available.

## Empty plan editor

Prompt the user to add the first step.

Avoid presenting an empty management interface without direction.

---

# 52. Error Handling

Potential failures include:

- invalid persisted plan

- unsupported step type

- incomplete target configuration

- plan deleted before start

- mapping to block creation fails

- corrupted step order

- session creation interrupted

The system should fail safely.

Preferred principles:

- do not create a partially corrupted active session

- explain which step is invalid

- allow the user to repair the plan

- preserve valid existing plans

- avoid silently dropping steps

- never substitute invalid Hog-Hog configuration with Back-Hog defaults

---

# 53. Starting From an Invalid Legacy Plan

As the schema evolves, a saved plan may no longer be immediately executable.

The platform should distinguish:

```text

Readable plan

Executable plan

```

A plan that cannot be executed should remain visible where possible.

The user should receive a clear explanation and an Edit action.

Do not silently mutate sport-specific configuration unless the migration is unambiguous and value-preserving.

---

# 54. Relationship to Assessments

Assessments are not part of Training Plans in Version 1.

Assessment protocols have their own rules and domain authority.

Future versions may allow an Assessment Step.

That decision requires separate specification because an Assessment is not merely another release-time block.

The Version 1 plan architecture should not prevent this extension.

It should also not prematurely merge Assessment into the training plan domain.

---

# 55. Relationship to Home

Home may later surface:

- most recently used plan

- planned training shortcut

- continue active planned session

- selected favourite plan

Version 1 does not require Home redesign.

The primary plan discovery, creation and management location remains Train.

A future Home entry should link into the same plan execution flow rather than creating a separate plan system.

---

# 56. Relationship to Settings

Settings may later contain:

- backup and restore of plans

- plan storage information

- import and export

- default preferences

Settings should not contain the main plan library or editor.

Training Plans are training content.

They belong under Train.

---

# 57. Import and Export

Version 1 does not require individual plan sharing.

However, future full-data backup should include Training Plans.

Plan export may later support:

- personal backup

- sharing with another athlete

- coach-created templates

- public plan libraries

Any future export format should contain:

- schema version

- plan metadata

- ordered steps

- step types

- configurations

It must not imply support for future step types that the receiving app cannot execute.

---

# 58. Technical Boundaries

The Training Plan feature should be separated into clear responsibilities.

Potential boundaries:

## Plan persistence

- load plans

- save plans

- update plans

- delete plans

- migrate plans

## Plan domain

- plan validation

- step validation

- duplication

- ordering

- summary calculations

## Release-time mapping

- convert a Release Timing Plan Step into valid block creation input

- initialise runtime state through existing domain logic

## Plan execution

- create session

- attach execution context

- activate first step

- calculate progress

- handle step transitions

## UI

- plan library

- plan editor

- step editor

- pre-start summary

- active progress

- transition state

Do not place the entire feature directly into the current central orchestration component if a clean domain boundary can be created.

Avoid premature framework abstraction.

---

# 59. Product Invariants

The following invariants are mandatory:

1. A plan contains configuration, not recorded training data.

2. Editing a plan never changes a completed or active Session.

3. Every completed Shot remains historically immutable with respect to its original target and measured values.

4. A Release Timing Plan Step creates a Training Block using existing domain rules.

5. A plan may contain any supported number and order of Fixed, Variable and Blind Weight steps.

6. Every step may define its own number of stones.

7. Every step may define its own handle strategy.

8. The handle actually used is stored on the Shot.

9. Planned configuration never overrides actual recorded execution data.

10. Blind Weight drafts do not count toward completion.

11. Only saved valid Shots count toward shot-count completion.

12. Quick Start remains available without a Training Plan.

13. Training Plans remain accessible offline.

14. Future plan step types must be addable without redefining the meaning of existing release-time plans.

15. Unsupported Measurement Mode and target-source combinations must not receive silent fallback values.

---

# 60. Version 1 Acceptance Criteria

Training Plans Version 1 is successful when an athlete can:

1. Open the Train area.

2. See Quick Start and saved Training Plans as distinct options.

3. Create a new Training Plan.

4. Give the plan a name.

5. Add multiple ordered steps.

6. Select Fixed Weight, Variable Weight or Blind Weight for each step.

7. Define a separate number of stones for each step.

8. Configure handles as:

   - Free

   - In only

   - Out only

   - Alternating, starting In

   - Alternating, starting Out

9. Configure valid mode-specific settings for each step.

10. Reorder steps.

11. Edit steps.

12. Duplicate steps.

13. Delete steps.

14. Save the plan locally.

15. Edit, duplicate and delete saved plans.

16. Start a saved plan without recreating each block manually.

17. Execute all release-time steps within one Training Session.

18. See the current step and shot progress.

19. Complete a step after the planned number of Shots.

20. Continue deliberately to the next step.

21. End a planned session early without losing valid recorded data.

22. Find the completed session in normal History and Analyze areas.

23. Retain correct Block and Shot data even after the source plan is later edited or deleted.

24. Continue using normal Quick Start sessions without any plan.

---

# 61. Future Product Opportunities

The following are future possibilities, not current commitments:

## Plan scheduling

- assign plans to dates

- weekly structures

- seasonal phases

## Coaching

- coach-created plans

- shared plans

- feedback

- remote monitoring

## Adaptive planning

- plans based on recent performance

- progression rules

- automatic exercise selection

- assessment-triggered changes

## New exercise domains

- stone rotation

- line consistency

- sweeping

- sensor-integrated drills

- tactical exercises

- video exercises

## Plan analytics

- performance across repeated executions

- progression within a plan

- planned versus actual volume

- completion patterns

- fatigue effects by step order

## Team support

- shared team plans

- position-specific steps

- multi-athlete execution

- lane or device assignment

Each of these requires separate product validation and specification.

---

# 62. Open Product Decisions

The following decisions should be resolved before or during implementation.

## Runtime override of a fixed handle

Preferred direction:

- preselect configured handle

- allow deliberate override

- save actual handle

Confirm whether fixed strategy should ever hard-lock the selector.

## Continuing after planned shot count

Preferred direction:

- mark step complete

- offer Continue to next step

- allow optional extra shots without blocking

Confirm the exact interaction.

## Skipping a step

Decide whether Version 1 needs:

- Skip Step

- or only End Session Early

## Plan execution snapshot

Decide how much source plan information should be copied into the Session.

At minimum, the session should remain understandable after the plan is renamed or deleted.

## Eager or lazy Block creation

Choose based on current architecture and persistence behaviour.

The execution must remain independent of later plan edits either way.

## Editing future steps during active execution

Decide whether the athlete may adjust not-yet-started planned blocks.

A minimal Version 1 may keep them fixed after start.

## Step naming

Decide whether custom step names are included in Version 1.

Examples:

```text

Warm-up Weight

Main Variable Set

Blind Finish

```

This is useful but not essential.

## Plan descriptions

Decide whether descriptions are required in the first release or can remain an optional future field.

---

# 63. Recommended Version 1 Decisions

To keep the first implementation focused:

- Plans live under Train.

- Quick Start remains unchanged.

- Plans contain ordered Release Timing Plan Steps.

- Each step creates one Training Block.

- One plan execution creates one Training Session.

- Each step uses shot-count completion.

- Fixed and alternating handles are preselected but overridable.

- Only saved Shots count.

- Step transition requires a Continue action.

- Extra Shots are allowed deliberately.

- Early session completion is allowed.

- Step skipping may be deferred unless easy to support safely.

- Custom step names are optional.

- Plan descriptions are optional.

- Drag-and-drop is not required.

- Assessments are not included.

- No plan scheduling or coaching.

- Plans persist locally.

- Plan edits affect future executions only.

---

# 64. Final Principle

Training Plans should make structured training easier without making training rigid.

The athlete defines:

- what to train

- in which order

- for how many stones

- with which handle behaviour

- using which release-time configuration

The platform then removes repetitive setup and guides the athlete through the sequence.

The durable design principle is:

&gt; A Training Plan defines intended structure.  

&gt; A Training Session records actual execution.

Version 1 should remain simple:

```text

Save configured sequence

→ Start it

→ Execute the blocks

→ Analyze the real session

```

At the same time, the plan model must remain open enough that future sensor-based, line, rotation, sweeping or other curling-specific training types can become additional Plan Step types without rebuilding the foundation.