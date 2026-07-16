# Assessment Product &amp; Domain Specification

&gt; Product and Domain Specification

&gt;

&gt; This document defines the product purpose, domain model, execution rules and future direction of assessments within the Curling Performance Platform.

&gt;

&gt; Assessments are standardised performance measurements. They are intentionally separate from normal training sessions.

---

# 1. Purpose

The platform distinguishes between three athlete intentions:

- **Train** — improve performance

- **Assess** — measure current performance

- **Analyze** — understand performance and development

An assessment answers:

&gt; Where do I currently stand under consistent conditions?

It does not primarily answer:

&gt; What should I train today?

or:

&gt; How good was this individual training session?

Assessment results should be repeatable, comparable over time and transparent in their methodology.

---

# 2. Core Principles

## Standardised Execution

Comparable assessment runs must use the same:

- assessment template

- template version

- measurement mode

- target sequence

- handle sequence

- number of scored stones

- validity rules

- repeat rules

- execution protocol

If one of these elements changes, the result must not automatically be treated as directly protocol-comparable to the original assessment.

Accuracy Thresholds are not part of the physical execution protocol. They control how measured results are grouped and interpreted.

---

## Transparent Methodology

Athletes should understand:

- what the assessment measures

- what it does not measure

- why each block exists

- why the blocks are performed in a specific order

- how the timing setup must be configured

- which attempts count

- which attempts may be repeated

- how results are calculated

- how Accuracy Thresholds affect result categories

- which metrics are independent of Accuracy Thresholds

The platform must not present the assessment as scientifically validated or officially endorsed unless this has been confirmed.

---

## Athlete Control

The platform may explain and suggest.

It should not force an athlete to complete an assessment before using normal training functionality.

Assessments should remain optional unless explicitly assigned by a coach or organisation in a future workflow.

---

## No Unsupported Athlete Classification

A release-time assessment measures delivery-speed control.

It does not measure the athlete’s complete curling ability.

The result must not classify the athlete globally as:

- beginner

- intermediate

- advanced

- elite

without a broader validated assessment model.

---

## Provider-Neutral Measurement

Assessment definitions must not depend on a specific timing manufacturer.

Use domain-neutral language such as:

- timing gate

- first gate

- second gate

- external timing provider

Do not encode Brower-specific concepts in the assessment domain.

---

## Raw Data Is Authoritative

The authoritative assessment data consists of:

- planned targets

- measured times

- executed handles

- attempt validity

- protocol deviations

- timing metadata

- assessment protocol and version

Derived categories such as:

- On Target

- Acceptable

- Major Miss

are interpretations based on an Accuracy Threshold Set.

Changing the threshold used for analysis must never alter the original measured data.

---

# 3. Assessment Types

## Official Assessment

An Official Assessment is a fixed, versioned assessment definition.

Characteristics:

- not editable by the athlete

- fixed block structure

- fixed target and handle sequence

- fixed measurement mode

- fixed execution and validity rules

- directly protocol-comparable only with runs of the same version

- may later support anonymised benchmarking

The term `Official` refers to an assessment controlled by the platform or an authorised organisation.

It must not imply endorsement by Swiss Curling, Curling Canada or another federation unless such endorsement exists.

---

## Custom Assessment

A Custom Assessment is a configurable assessment definition.

Possible creators in the future:

- athlete

- coach

- team

- club

- federation

Custom Assessments may define:

- blocks

- targets

- handles

- shot types

- measurement modes

- repetition counts

- evaluation configuration

Custom runs are only directly protocol-comparable when their definitions are equivalent.

A modified Official Assessment becomes a separate Custom Assessment and must not retain the same comparison identity.

---

# 4. Core Domain Model

## Assessment Template

An Assessment Template defines the protocol.

Conceptual properties:

- id

- name

- version

- type: official | custom

- description

- status

- measurement mode

- shot type

- warm-up protocol

- block definitions

- target sequence

- handle sequence

- validity rules

- repeat rules

- estimated duration

- setup instructions

- explanation content

- creation metadata

- organisation ownership, if applicable

The template is immutable after publication.

Changes to protocol semantics require a new version.

Accuracy Threshold defaults may be recommended by the template, but they do not define the raw assessment result.

---

## Assessment Block Definition

An Assessment Block Definition describes one part of the protocol.

Conceptual properties:

- id

- name

- purpose

- sequence index

- number of scored shots

- targets

- handle sequence

- feedback behaviour

- transition instructions

- explanation content

Examples:

- Medium Reproduction

- Slow Reproduction

- Fast Reproduction

- Variable Adaptation

---

## Planned Assessment Shot

A Planned Assessment Shot defines what should be executed.

Conceptual properties:

- sequence index

- block id

- target time

- expected handle

- shot type

- measurement mode

Planned shots must not be dynamically randomised in Release Time Core Assessment v1.

---

## Assessment Attempt

An Assessment Attempt represents an actual physical attempt.

Conceptual properties:

- planned shot reference

- measured time

- executed handle

- attempt status

- timing result id

- provider metadata

- protocol deviation

- invalid reason

- captured at

A planned shot may have multiple attempts if earlier attempts were technically invalid.

Only one valid scored attempt completes the planned shot.

---

## Assessment Run

An Assessment Run is one athlete’s execution of one template version.

Conceptual properties:

- id

- assessment template id

- template version

- athlete id or local athlete identity

- status

- started at

- completed at

- current block

- current planned shot

- completed attempts

- invalid attempts

- protocol deviations

- interruption data

- warm-up status

- timing provider

- measurement mode snapshot

- selected Accuracy Threshold Set snapshot

- notes

- local or future cloud ownership metadata

The run must retain a stable reference or snapshot of the exact template version used.

The Accuracy Threshold Set selected before the run begins is stored for historical transparency. It does not alter the underlying protocol or raw measurements.

---

## Accuracy Threshold Set

An Accuracy Threshold Set defines how absolute timing errors are grouped for interpretation.

Conceptual properties:

- id or preset name

- type: standard | tight | custom

- on-target threshold

- acceptable threshold

- display precision

- selected at

- source: default | athlete-selected | future coach-selected

Rules:

- On Target threshold must be smaller than Acceptable threshold.

- Threshold values must be positive.

- Category boundaries must be explicit.

- Thresholds affect category metrics only.

- Thresholds do not affect MAE, Bias, Standard Deviation or measured times.

---

## Assessment Result

An Assessment Result is the derived evaluation of an Assessment Run.

Conceptual properties:

- run id

- template id

- template version

- threshold-independent metrics

- threshold-dependent category metrics

- fixed-control metrics

- variable-adaptation metrics

- target-specific metrics

- handle-specific metrics

- protocol quality information

- protocol comparison eligibility

- category comparison context

Results should preferably be derived from the run rather than stored as the sole source of truth.

---

# 5. Run Status

Supported conceptual statuses:

## Not Started

The template has been selected, but the run has not begun.

## Warm-up

The standard warm-up protocol is active.

## In Progress

Scored assessment shots are being executed.

## Paused

The run has been temporarily interrupted.

## Completed

All planned scored shots have valid attempts.

## Incomplete

The run was abandoned before completion.

Incomplete runs:

- remain visible

- do not count as completed assessment results

- do not enter completed assessment trends

- do not qualify for future benchmarking

## Invalidated

Reserved for future controlled workflows in which an entire run is excluded because the protocol was materially compromised.

This status should not be introduced without clear product need.

---

# 6. Release Time Core Assessment v1

## Product Name

**Release Time Core Assessment v1**

## Purpose

Measure the athlete’s ability to:

- reproduce a known delivery speed

- control slower and faster delivery speeds

- adapt between different target speeds

- maintain consistency across both handles

The assessment measures delivery-speed control.

It does not measure:

- final stone position

- line accuracy

- rotation quality

- sweeping performance

- tactical decision-making

- complete shot-making ability

---

## Measurement Mode

**Backline–Hog**

The measured segment begins at the backline timing gate and ends at the hogline timing gate.

---

## Shot Type

**Draw**

The assessment uses draw-oriented delivery speeds.

The target labels do not claim a universal final stone destination.

Avoid labels such as:

- guard

- tee-line draw

- back-house draw

because the relationship between Backline–Hog time and final stone distance depends on ice, stone and release conditions.

---

## Target Speeds

- **Slow Delivery:** 4.00 seconds

- **Medium Delivery:** 3.75 seconds

- **Fast Delivery:** 3.50 seconds

These are standardised delivery-speed targets for assessment v1.

They are not presented as official international curling standards.

---

## Total Scored Stones

**32**

Distribution:

- 16 In Handle

- 16 Out Handle

---

## Warm-up Stones

**6 unscored stones**

Distribution:

- 3 In Handle

- 3 Out Handle

- 2 attempts at each target speed

---

## Estimated Duration

Approximately **25–35 minutes**, excluding setup and longer interruptions.

The duration is descriptive, not a strict time limit.

---

# 7. Assessment Structure

## Block 1 — Medium Reproduction

### Purpose

Establish a stable baseline at the central target speed.

### Configuration

- Target: 3.75 seconds

- Scored stones: 8

- In Handle: 4

- Out Handle: 4

### Handle Sequence

1. In

2. Out

3. In

4. Out

5. In

6. Out

7. In

8. Out

### Measures

- baseline accuracy

- consistency

- directional bias in time

- handle difference

---

## Block 2 — Slow Reproduction

### Purpose

Measure the ability to reduce delivery speed while maintaining controlled delivery mechanics.

### Configuration

- Target: 4.00 seconds

- Scored stones: 8

- In Handle: 4

- Out Handle: 4

### Handle Sequence

1. Out

2. In

3. Out

4. In

5. Out

6. In

7. Out

8. In

### Measures

- slow-delivery accuracy

- slow-delivery consistency

- bias at the slow target

- ability to reproduce a slower delivery speed

The application should not claim to detect the athlete’s exact technical cause solely from timing data.

---

## Block 3 — Fast Reproduction

### Purpose

Measure the ability to generate a faster delivery in a controlled and repeatable way.

### Configuration

- Target: 3.50 seconds

- Scored stones: 8

- In Handle: 4

- Out Handle: 4

### Handle Sequence

1. In

2. Out

3. In

4. Out

5. In

6. Out

7. In

8. Out

### Measures

- fast-delivery accuracy

- fast-delivery consistency

- bias at the fast target

- ability to increase delivery speed while remaining repeatable

---

## Block 4 — Variable Adaptation

### Purpose

Measure the ability to switch between previously established delivery speeds.

### Configuration

- Scored stones: 8

- In Handle: 4

- Out Handle: 4

- fixed, versioned sequence

### Sequence

| Shot | Target | Handle |

|---:|---:|---|

| 1 | 3.75 s | In |

| 2 | 4.00 s | Out |

| 3 | 3.50 s | In |

| 4 | 4.00 s | Out |

| 5 | 3.50 s | Out |

| 6 | 3.75 s | In |

| 7 | 4.00 s | In |

| 8 | 3.50 s | Out |

### Measures

- adaptation accuracy

- adaptation consistency

- performance after target changes

- faster-to-slower transitions

- slower-to-faster transitions

- handle differences under variable demand

---

# 8. Why This Structure

The assessment begins with the medium target because it provides a central baseline.

The slow and fast targets are then tested separately so that performance at each delivery speed can be evaluated without constant target switching.

The variable block follows last because the athlete has already experienced all three target speeds during the same run.

This allows the final block to focus more clearly on adaptation between known targets.

Both handles are evenly represented to reveal handle-specific differences without allowing one handle to dominate the overall result.

---

# 9. Warm-up Protocol

## Standard Warm-up

Before scored shots begin, the athlete completes the following fixed sequence:

| Warm-up Shot | Target | Handle |

|---:|---:|---|

| 1 | 3.75 s | In |

| 2 | 3.75 s | Out |

| 3 | 4.00 s | In |

| 4 | 4.00 s | Out |

| 5 | 3.50 s | In |

| 6 | 3.50 s | Out |

Total:

**6 unscored warm-up stones**

Warm-up times may be visible.

Warm-up attempts:

- do not count toward the assessment result

- do not appear as scored assessment shots

- do not affect comparison metrics

- do not replace scored attempts

- follow the fixed target and handle sequence

The fixed sequence ensures that both handles and all three target speeds are experienced before scored execution begins.

---

## Warm-up Skipping

The long-term product may allow an athlete to confirm that an equivalent warm-up has already been completed.

If supported, the run should record:

- warm-up skipped

- warm-up skip confirmation

- whether the run remains eligible for specific future comparison or benchmarking contexts

For Release Time Core Assessment v1, the preferred behaviour is to guide the user through the standard warm-up.

---

# 10. Accuracy Threshold Selection Before Starting

Before an Assessment Run begins, the athlete must visibly select or confirm an Accuracy Threshold Set.

The selection is required before entering the scored execution flow.

Standard may be preselected, but it must remain visibly presented and must not be silently inherited without appearing in the start flow.

---

## Purpose of Thresholds

Accuracy Thresholds control how absolute timing errors are grouped in the result.

They do not change:

- target times

- measured times

- block structure

- handle sequence

- assessment difficulty

- raw metrics

- protocol comparison eligibility

Required explanatory copy should communicate:

&gt; Accuracy Thresholds control how results are grouped. They do not change the measured times or assessment protocol.

---

## Standard Preset

Initial proposed values:

- On Target: absolute error of 0.10 seconds or less

- Acceptable: absolute error above 0.10 and up to 0.20 seconds

- Major Miss: absolute error above 0.20 seconds

These values are configurable interpretation defaults.

They are not presented as scientifically validated performance standards.

---

## Tight Preset

Initial proposed values:

- On Target: absolute error of 0.05 seconds or less

- Acceptable: absolute error above 0.05 and up to 0.10 seconds

- Major Miss: absolute error above 0.10 seconds

These values provide a stricter interpretation.

They do not represent a different or harder assessment protocol.

---

## Custom Thresholds

Custom allows the athlete to define:

- On Target threshold

- Acceptable threshold

Major Miss is derived as any absolute error above the Acceptable threshold.

Validation rules:

- values must be positive

- On Target must be smaller than Acceptable

- values must use a supported precision

- technically unreasonable values may be rejected by product validation

- no custom selection may alter the planned target times

Exact allowed numeric limits should be decided during implementation based on existing training-threshold validation.

---

## Threshold Snapshot

At run start, store an immutable snapshot containing:

- preset type: standard | tight | custom

- exact On Target threshold

- exact Acceptable threshold

- selection source

- selection timestamp or run-start association

This snapshot preserves historical context.

It does not prevent later re-analysis using different Comparison Thresholds.

---

# 11. Feedback During the Assessment

After a valid scored attempt, show:

- actual time

- target time

- difference to target

- category according to the selected Run Thresholds, if category feedback is shown

- next planned target

- next expected handle

- current block progress

- total assessment progress

Do not show during execution:

- live ranking

- benchmark percentile

- personal-best comparison

- synthetic overall score

- current assessment grade

- automatic training recommendation

The assessment is not blind.

Timing feedback remains visible because Blind Weight should be assessed separately.

---

# 12. Invalid Attempts

A technically invalid attempt may be repeated.

Valid invalid reasons may include:

- first gate did not trigger

- second gate did not trigger

- duplicate timing result

- clearly corrupted timing value

- another person or object triggered a gate

- timing-provider failure

- app failure

- external interruption before release

- stone was not played due to an objective interruption

The reason must be recorded.

Invalid attempts do not count toward scored metrics.

---

## Invalid Repeat Limit

Maximum:

**2 invalid repeats per planned shot**

After repeated technical failure:

- pause the run

- require the athlete to resolve the setup

- or mark the run incomplete

The product must not encourage continuing an assessment with an unreliable timing setup.

---

# 13. Valid but Poor Attempts

The following remain valid scored attempts and may not be repeated:

- wrong delivery speed

- balance error

- arm push

- poor release

- missed target

- athlete-controlled technical mistake

- subjective dissatisfaction

- poor execution

Allowing such attempts to be repeated would undermine comparability.

---

# 14. Wrong Handle

If the athlete uses the wrong handle:

- the attempt remains scored

- the executed handle is recorded

- the planned handle remains recorded

- a protocol deviation is added

- the shot is not automatically repeated

Suggested deviation:

`wrong_handle`

This prevents poor attempts from being indirectly retried by claiming a handle error.

The result view should clearly disclose protocol deviations.

---

# 15. Pause and Interruption Rules

## Short Pause

A run may be paused.

The platform must retain:

- current block

- next planned shot

- completed attempts

- invalid attempts

- protocol deviations

- selected Run Threshold snapshot

Targets and sequence must not be regenerated after pause.

---

## Between-Block Pause

The athlete may pause between blocks.

A short rest of approximately one to two minutes may be suggested but should not be enforced.

---

## Reload Recovery

The application should be able to restore an in-progress run after reload.

Restoration must not:

- change the sequence

- duplicate an attempt

- lose a valid shot

- reset progress

- reassign shot IDs

- generate new targets

- change the selected Run Threshold snapshot

---

## Long Interruption

An assessment should ideally be completed within one ice session.

The domain should prepare for recording:

- interruption duration

- resumed after reload

- completed in one session

A run resumed on another day should not automatically qualify as directly comparable to a single-session completed run.

Exact eligibility rules may be implemented later.

---

# 16. Abandoning an Assessment

If the athlete stops before completion:

- status becomes `incomplete`

- valid attempts remain visible

- the run is not included in completed assessment trends

- the run is not eligible for future benchmark comparisons

- restarting creates a new Assessment Run

The user should receive a clear confirmation before abandoning.

The confirmation must explain that completed attempts will remain recorded but the run will not count as a completed assessment.

---

# 17. Completed Run Immutability

After completion, scored assessment data should be treated as immutable.

Do not allow:

- editing measured times

- changing targets

- reordering shots

- changing planned handles

- deleting individual poor attempts

- converting valid shots into invalid shots

- adding replacement shots

- changing the original Run Threshold snapshot

Potentially allowed:

- add or edit a note

- delete the entire run after explicit confirmation

- analyze the run using a different Comparison Threshold Set

Re-analysis does not mutate the completed run.

If a completed run is deleted, derived comparisons must be recalculated.

---

# 18. Metrics

## Threshold-Independent Core Metrics

These metrics are directly comparable across protocol-comparable runs regardless of their original Run Threshold selections:

- Mean Absolute Error

- Standard Deviation

- Bias

- completed scored shots

- invalid attempt count

- protocol deviation count

These are the primary transparent performance metrics.

---

## Threshold-Dependent Category Metrics

Calculated using a clearly identified Threshold Set:

- On Target %

- Acceptable %

- Major Miss %

These may be shown using:

- the original Run Threshold Set

- Standard

- Tight

- a shared Custom Comparison Threshold Set

The applied threshold context must always be visible.

---

## Fixed Control Metrics

Calculated across Blocks 1–3:

- MAE

- Standard Deviation

- Bias

- category percentages under the selected analysis threshold

- performance by target

- performance by handle

---

## Variable Adaptation Metrics

Calculated for Block 4:

- MAE

- Standard Deviation

- Bias

- category percentages under the selected analysis threshold

- performance by target

- performance after target change

- faster-to-slower transition error

- slower-to-faster transition error

- handle difference

Transition metrics should only be added if they are clearly defined and statistically meaningful.

Do not overstate conclusions from eight variable shots.

---

## Handle Metrics

- In Handle MAE

- In Handle Standard Deviation

- In Handle Bias

- Out Handle MAE

- Out Handle Standard Deviation

- Out Handle Bias

- absolute handle difference

- optional category rates under a shared threshold context

Do not label one handle as technically incorrect solely from timing data.

---

## Target Metrics

Separate metrics for:

- 4.00 seconds

- 3.75 seconds

- 3.50 seconds

---

# 19. Run Thresholds and Comparison Thresholds

## Run Thresholds

Run Thresholds are the thresholds selected or confirmed before the Assessment Run begins.

They are:

- stored as an immutable snapshot

- used for the original result presentation

- visible in the completed run

- preserved for historical transparency

They do not define the assessment protocol.

---

## Comparison Thresholds

Comparison Thresholds are the shared thresholds currently applied when analyzing one or more runs.

Possible options:

- Original, for a single-run view

- Standard

- Tight

- Custom

When comparing multiple runs, one shared Comparison Threshold Set must be applied to all selected runs for threshold-dependent category metrics.

---

## Comparison Rule

Threshold-independent metrics may be compared regardless of original Run Threshold selection.

This includes:

- MAE

- Bias

- Standard Deviation

Threshold-dependent metrics may only be compared when recalculated with the same Comparison Threshold Set.

This includes:

- On Target %

- Acceptable %

- Major Miss %

The platform must not compare category percentages from different original threshold sets as though they used the same interpretation.

---

## Different Original Thresholds

Runs with different original Run Thresholds are not automatically protocol-ineligible.

They may still be directly compared if they use the same:

- Assessment Template

- template version

- measurement mode

- target sequence

- handle sequence

- scored-shot count

- execution protocol

For category comparisons, apply one shared Comparison Threshold Set.

---

# 20. Overall Score

Release Time Core Assessment v1 should not introduce a synthetic overall score as its primary result.

Primary results should remain transparent metrics and subscores.

A future score may be introduced only if:

- its formula is transparent

- weighting is justified

- user testing confirms it improves understanding

- it does not hide meaningful weaknesses

- version changes are controlled

---

# 21. Result Presentation

The result screen should present:

## Summary

- completed status

- date

- assessment version

- measurement mode

- total scored stones

- invalid attempts

- protocol deviations

- original Run Threshold Set

## Core Results

- overall MAE

- overall Standard Deviation

- overall Bias

- On Target %

- Acceptable %

- Major Miss %

- active analysis threshold context

## Subsections

- Medium Reproduction

- Slow Reproduction

- Fast Reproduction

- Variable Adaptation

- Handle Comparison

- Target Comparison

## Threshold Control

The result view should allow the athlete to inspect results using:

- Original Run Thresholds

- Standard

- Tight

- Custom

Changing this selection recalculates threshold-dependent category metrics only.

It must not change:

- measured times

- raw metrics

- stored Run Threshold snapshot

- protocol status

- comparison eligibility

## Progress

When comparable prior runs exist:

- current run

- previous comparable run

- long-term trend for the same template version

No improvement statement should be generated from non-comparable versions.

---

# 22. Comparison Eligibility

## Protocol Comparison Eligibility

Direct protocol comparison requires:

- same Assessment Template

- same template version

- same measurement mode

- same target sequence

- same handle sequence

- same scored-shot count

- completed run status

- acceptable protocol integrity

Potential future exclusions:

- excessive protocol deviations

- resumed on another day

- non-standard warm-up

- changed physical setup

- unreliable timing provider

These rules must be transparent.

---

## Category Comparison Eligibility

Category-based metrics may be compared only when:

- the runs are protocol-comparable

- one shared Comparison Threshold Set is applied to all runs

Original Run Threshold Sets may differ.

The app must make the active Comparison Threshold Set visible.

---

# 23. Assessment Explanation Experience

## Assessment Overview

Before starting, show:

- assessment name

- version

- number of scored stones

- number of warm-up stones

- number of blocks

- measurement mode

- estimated duration

- high-level purpose

- Accuracy Threshold selection

Example:

**Release Time Core Assessment v1**

- 32 scored stones

- 6 warm-up stones

- Backline–Hog

- 4 test blocks

- Approximately 25–35 minutes

---

## What This Assessment Measures

Explain:

- medium delivery reproduction

- slow delivery control

- fast delivery control

- adaptation between target speeds

- consistency across both handles

---

## Why This Structure

Suggested copy:

&gt; The assessment starts with a medium target to establish a stable baseline. It then tests slower and faster deliveries separately before measuring how accurately you can switch between them. Both handles are evenly represented so that handle-specific differences can be identified.

---

## Accuracy Threshold Explanation

Before starting, explain:

&gt; Accuracy Thresholds control how results are grouped. They do not change the measured times or assessment protocol.

The user should be able to inspect the exact values for:

- Standard

- Tight

- Custom

The assessment cannot begin until a valid threshold selection is present.

---

## Guided Introduction

At the first start, the platform may show a short explanation of the four blocks.

### Medium Reproduction

&gt; Establishes your baseline at 3.75 seconds.

### Slow Reproduction

&gt; Measures how accurately you can reproduce a slower delivery.

### Fast Reproduction

&gt; Measures controlled reproduction of a faster delivery.

### Variable Adaptation

&gt; Measures how accurately you can switch between known delivery speeds.

Actions:

- Continue

- Skip explanation

- Do not show this automatically again

Skipping the explanation must not skip:

- threshold selection

- warm-up

- setup confirmation

- validity rules

- required safety or protocol information

---

## Explanation Preference

Suggested preference:

`Show assessment introduction before starting`

Behaviour:

- enabled by default for first use

- may be disabled by the athlete

- may be re-enabled later

- does not remove permanent access to the protocol

- does not remove visible threshold selection

The preference may initially be stored locally and later migrated to an authenticated profile.

---

## Permanent Access

The explanation must remain available through:

- assessment overview

- info action during the run

- result view

- assessment protocol view

Product rule:

&gt; Explanation is optional in presentation, but permanently available in content.

---

# 24. Assessment Setup Transparency

Every Official Assessment must clearly document the required physical setup.

The setup explanation includes:

- measurement mode

- timing-gate positions

- measured segment

- direction of delivery

- standardisation notes

- provider-neutral setup diagram

- warning that changed setup may reduce comparability

---

## Setup Requirements for Release Time Core Assessment v1

- Measurement mode: Backline–Hog

- First timing gate positioned at the backline

- Second timing gate positioned at the hogline

- Both gates aligned to reliably detect the stone

- Same gate positions used for every assessment run

- Timing provider configured for the same measurement sequence

- Clear delivery path between gates

- No intentional mixing of incompatible timing methods within the same Official Run

Exact physical placement guidance should be validated with timing hardware and coaching experts before publication.

---

## Setup Diagram

The diagram should be:

- schematic

- simple

- provider-neutral

- mobile-readable

- visually consistent with the platform

- understandable without detailed technical knowledge

The diagram should show:

- hack

- direction of delivery

- backline

- first timing gate

- hogline

- second timing gate

- measured Backline–Hog segment

- stone path

Suggested label:

`Measured segment: Backline to Hogline`

The diagram should not use Brower branding unless a separate provider-specific help view is intentionally added.

---

## Setup Notes

Suggested copy:

&gt; Use the same timing-gate positions for every assessment run. This assessment measures delivery-speed control between the backline and hogline. It does not evaluate the final position of the stone. Changes to the physical setup may reduce comparability between runs.

---

## Setup Confirmation

Before starting the first scored run, the platform may ask the athlete to confirm:

- gates are positioned correctly

- Backline–Hog mode is selected

- the timing system has been tested

- the delivery path is clear

This should be a brief confirmation, not a complex checklist.

The setup diagram should remain accessible even if the automatic introduction has been disabled.

---

# 25. Setup Guidance Placement

Setup guidance should be available in three locations.

## Assessment Overview

Show a compact Setup Requirements section and:

`View setup diagram`

## How This Assessment Works

Include the full diagram and explanatory notes.

## Assessment Protocol

Provide permanent access before and after completion.

The diagram should not occupy a large permanent area on the main Assess landing page.

---

# 26. Analyze Integration

Completed Assessment Runs belong under Analyze.

Potential Analyze sections:

- Training

- Assessments

Assessment analysis may include:

- latest assessment

- comparable history

- metric trends

- target trends

- handle trends

- block comparison

- protocol deviations

- Run Threshold context

- shared Comparison Threshold controls

Training Sessions and Assessment Runs must remain distinct domain concepts even if they reuse common charts or metric utilities.

---

# 27. Reuse of Existing Training Infrastructure

The assessment implementation may reuse:

- shot representation

- target times

- handle types

- shot types

- measurement modes

- timing providers

- timing-result processing

- chart components

- metric utilities

- existing Accuracy Threshold validation where appropriate

However, an Assessment Run must not simply be represented as an ordinary editable Training Session.

Assessments require additional guarantees:

- fixed sequence

- template version

- immutable completion

- invalid-attempt history

- protocol deviations

- protocol comparison eligibility

- Run Threshold snapshot

- stricter deletion and editing rules

Reuse infrastructure, not semantics.

---

# 28. Future: Blind Weight Assessment

Blind Weight should be a separate assessment.

It may measure:

- actual delivery accuracy

- predicted-time accuracy

- calibration error

- confidence

- handle differences

- perception across target speeds

It should not be merged into Release Time Core Assessment v1 because it evaluates an additional capability: self-perception.

---

# 29. Future: Complete Release Performance Assessment

A future combined assessment may bundle:

- Release Time Core

- Blind Weight

- Rotation

- Direction

- Line

- Release quality

Each module should retain separate results.

A combined overall profile should not erase the underlying domain-specific metrics.

---

# 30. Future: Baseline Assessment

A new athlete may optionally be invited to establish a baseline.

Suggested positioning:

**Establish your baseline**

&gt; Complete a standardised assessment to understand your current delivery control and track progress over time.

Actions:

- Start Baseline Assessment

- Maybe later

The baseline must not be mandatory for using the platform.

---

# 31. Future: Capability Profile

A completed baseline may support descriptive observations such as:

- medium delivery is currently the most consistent target

- slower delivery shows the largest bias

- fast-to-slow adaptation produces larger errors

- handles differ in consistency

Do not infer the athlete’s complete curling level.

---

# 32. Future: Training Focus Suggestions

Future suggestions may include:

- Slow Delivery Reproduction

- Variable Adaptation

- Handle Balance

- Medium Delivery Consistency

Suggestions must be:

- traceable to assessment data

- presented as optional

- explainable

- dismissible

- compatible with Coach Guided workflows

- replaceable by coach-defined priorities

Do not automatically create prescriptive training plans from one unvalidated Assessment Run.

---

# 33. Future: Benchmarking

Anonymised benchmarking may later compare completed protocol-comparable runs.

Potential dimensions:

- overall distribution

- age group

- competition level

- athlete-selected cohort

- federation cohort

- club cohort

Benchmarking should only launch when:

- enough high-quality data exists

- cohort sizes protect anonymity

- assessment execution is sufficiently standardised

- category comparisons use a shared threshold context

- users understand what is being compared

- demotivating effects have been evaluated

- opt-in and privacy rules are clear

Avoid public leaderboards by default.

---

# 34. Future: Organisations and Coaches

Organisations may later publish controlled Assessment Templates.

Examples:

- Swiss Curling Assessment

- Club Assessment

- Junior Development Assessment

- National Team Assessment

Coaches may:

- assign assessments

- review completed runs

- compare runs over time

- choose or recommend threshold views

- add interpretation

- create Custom Assessments

Organisation ownership, permissions and publishing workflows require authentication and are outside the current MVP.

---

# 35. Open Validation Questions

Before Release Time Core Assessment v1 is labelled as a validated platform standard, confirm:

- target times with elite athletes and coaches

- 32-stone duration and fatigue impact

- six-stone warm-up adequacy

- warm-up order and handle sequence

- block order

- fixed handle sequences

- variable target sequence

- manual versus automatic timing comparability

- precise gate placement

- invalid-attempt rules

- acceptable protocol deviation threshold

- usefulness of Standard and Tight threshold presets

- suitable Custom threshold validation ranges

- metric usefulness

- whether repeat runs show acceptable reliability

- whether results are stable across different days

- whether one run is sufficient for a baseline

- whether visible categories affect execution behaviour

---

# 36. Pilot Recommendation

Pilot Release Time Core Assessment v1 with a small group.

Suggested participants:

- current app owner

- at least one elite athlete

- one experienced coach

- players with different skill levels

Collect:

- completion time

- perceived difficulty

- fatigue

- confusing instructions

- invalid-attempt frequency

- setup errors

- hardware problems

- target suitability

- repeated-run reliability

- usefulness of result metrics

- emotional response to the results

- selected Accuracy Threshold Sets

- whether threshold categories are understood correctly

- whether athletes mistake Tight for a harder protocol

- whether users change thresholds after seeing results

Do not change the official v1 definition during an individual run.

Pilot changes should result in:

- revised draft before publication

- or a new version after publication

Changes to threshold presets alone do not necessarily require a new Assessment Template version if raw protocol semantics remain unchanged, but preset changes must be versioned or historically traceable.

---

# 37. Versioning Rules

Examples:

- Release Time Core Assessment v1

- Release Time Core Assessment v2

A new Assessment Template version is required when changing:

- target speeds

- number of scored shots

- block order

- handle sequence

- target sequence

- measurement mode

- repeat rules

- validity rules

- protocol comparison eligibility rules

Minor copy corrections and non-semantic visual changes do not require a new Assessment Template version.

Accuracy Threshold presets are interpretation configuration rather than physical protocol.

Changes to preset values must be historically traceable but do not automatically require a new Assessment Template version, provided:

- raw protocol remains unchanged

- exact Run Threshold snapshots remain stored

- comparisons use explicit shared thresholds

---

# 38. Product Success Criteria

The assessment is successful when:

- athletes understand what is being measured

- athletes understand what is not being measured

- the setup can be reproduced consistently

- the full protocol can be completed in a practical ice session

- poor attempts cannot be selectively removed

- technical failures can be handled fairly

- completed runs remain trustworthy

- repeated runs show useful development over time

- both handles and all targets are meaningfully represented

- Accuracy Thresholds are understood as interpretation settings

- threshold-independent metrics remain central

- category comparisons use a shared threshold context

- the result supports training decisions without overstating conclusions

---

# 39. Current Product Decision

Release Time Core Assessment v1 uses:

- Backline–Hog measurement

- Draw shot type

- 3.50, 3.75 and 4.00 second targets

- 32 scored stones

- 6 unscored warm-up stones

- fixed warm-up sequence:

  - 3.75 In

  - 3.75 Out

  - 4.00 In

  - 4.00 Out

  - 3.50 In

  - 3.50 Out

- 4 assessment blocks

- equal In and Out Handle distribution

- fixed scored-shot sequences

- visible timing feedback

- strict invalid-attempt rules

- mandatory visible Accuracy Threshold selection before starting

- Standard, Tight and Custom threshold options

- immutable Run Threshold snapshot

- flexible later re-analysis using shared Comparison Thresholds

- threshold-independent MAE, Bias and Standard Deviation

- no synthetic overall score

- no benchmarking

- no athlete-level classification

- optional introduction

- permanently accessible explanation

- provider-neutral setup diagram and setup guidance

This specification defines the proposed v1 protocol.

It does not claim external federation approval or scientific validation.