# UX Writing Guidelines

&gt; Language, Interface Copy and Performance Communication

&gt;

&gt; This document defines how the Curling Performance Platform communicates with athletes.

&gt;

&gt; Its purpose is to make every feature understandable, every action predictable and every result appropriately interpreted.

&gt;

&gt; The interface should help athletes focus on training, understand their data and make informed decisions without overstating what the platform can prove.

---

# 1. Scope

This document defines:

- terminology

- tone of voice

- titles and subtitles

- button labels

- navigation labels

- form labels and helper text

- validation messages

- empty states

- loading, success and error messages

- destructive confirmations

- analytics explanations

- threshold language

- comparison language

- Assessment language

- coaching-oriented interpretation

- accessibility requirements for copy

- internationalisation principles

This document complements:

- `docs/MOBILE_UX_AND_DESIGN_[PRINCIPLES.md](http://PRINCIPLES.md)`

- `docs/DESIGN_[SYSTEM.md](http://SYSTEM.md)`

- `docs/COACHING_[PRINCIPLES.md](http://PRINCIPLES.md)`

- `docs/DOMAIN_[GLOSSARY.md](http://GLOSSARY.md)`

- `docs/PRODUCT_DIRECTION_AND_[PRINCIPLES.md](http://PRINCIPLES.md)`

- `docs/ASSESSMENT_PRODUCT_AND_DOMAIN_[SPECIFICATION.md](http://SPECIFICATION.md)`

It does not define:

- visual layout

- spacing

- colour

- component styling

- data formulas

- domain rules

- Assessment protocol

- coaching methodology

Those remain authoritative in their respective documents.

---

# 2. Communication Objective

Every user-facing message should help the athlete answer at least one of these questions:

1. What is this?

2. Why would I use it?

3. What should I do now?

4. What happened?

5. What does this result mean?

6. What does this result not mean?

7. What can I inspect next?

Copy should reduce uncertainty.

It should not add unnecessary explanation, technical terminology or motivational noise.

---

# 3. Core Principles

## Explain, Do Not Overwhelm

The interface should be understandable without requiring external documentation.

Prefer:

- short titles

- one-sentence descriptions

- contextual helper text

- progressive disclosure

- Info actions for deeper explanations

Avoid:

- long paragraphs on primary task screens

- repeated explanations

- permanent display of advanced details

- documentation-style text inside forms

Product rule:

&gt; Show the shortest explanation that allows the athlete to act correctly.

---

## Explain Purpose Before Mechanics

First explain why the feature matters.

Then explain how it works.

Poor:

&gt; Targets are generated automatically.

Better:

&gt; Train your ability to reproduce different weights under changing targets.

&gt; Targets are generated automatically.

---

## Every Feature Should Explain Itself

A user should understand:

- what the feature does

- why it exists

- when to use it

- what input is required

- what output to expect

without needing another person to explain the interface.

Example:

Poor:

&gt; Blind Weight

Better:

&gt; Blind Weight

&gt; Predict your release time before seeing the measured result.

---

## Short First, Detailed Second

Preferred information hierarchy:

1. title

2. one-sentence description

3. immediate action or result

4. optional Info action

5. detailed explanation

Do not expose every explanation permanently.

---

## Be Precise

Do not exaggerate or imply more certainty than the data supports.

Avoid:

- proves

- guarantees

- always

- never

- definitely

- scientifically proven

- perfect

- objective truth

Prefer:

- shows

- describes

- suggests

- may indicate

- could be related to

- is consistent with

- consider reviewing

Use `always` or `never` only for actual product or domain rules.

---

## Describe Observations Before Interpretation

Analytics show measured patterns.

They do not automatically identify technical causes.

Poor:

&gt; Your release is wrong.

Better:

&gt; Your average time was 0.08 seconds above the target.

Optional interpretation:

&gt; This pattern may be worth reviewing across additional sessions.

---

## Separate Facts from Interpretation

Facts include:

- Mean Absolute Error

- Bias

- Standard Deviation

- On Target Rate

- measured time

- target time

- handle difference

- shot count

Interpretations include:

- may indicate fatigue

- may indicate a handle-specific pattern

- may indicate difficulty adapting between targets

- may be worth discussing with a coach

Facts and interpretations must be visually and linguistically distinct.

Do not present an interpretation as a measured fact.

---

## Do Not Diagnose Technique from Timing Alone

Timing data may reveal:

- systematic error

- consistency differences

- handle differences

- target-specific differences

- change over time

Timing data alone does not identify:

- balance error

- arm push

- line error

- release mechanics

- rotation quality

- technical cause

Avoid:

&gt; Your slide is too aggressive.

Prefer:

&gt; Faster target deliveries showed a larger measured error in this run.

---

# 4. Tone of Voice

The platform should sound:

- calm

- factual

- professional

- direct

- supportive

- respectful of athlete expertise

It should not sound:

- patronising

- sarcastic

- overly enthusiastic

- dramatic

- competitive without context

- judgemental

- childish

- artificially motivational

---

## 4.1 Calm

Avoid unnecessary exclamation marks.

Poor:

&gt; Great job! Amazing assessment!

Better:

&gt; Assessment complete.

---

## 4.2 Direct

Prefer short, actionable sentences.

Poor:

&gt; In order to proceed with starting your training session, you will first need to confirm your current configuration.

Better:

&gt; Confirm the setup to start training.

---

## 4.3 Professional

Use recognised curling terminology.

Avoid casual substitutes when a domain term already exists.

---

## 4.4 Encouraging Without Judgement

Encouragement should support action, not evaluate the athlete globally.

Good:

&gt; Complete another comparable assessment to see development over time.

Avoid:

&gt; Keep going — you are becoming an elite player.

---

# 5. Terminology

Use terminology defined in `docs/DOMAIN_[GLOSSARY.md](http://GLOSSARY.md)`.

Do not invent synonyms for established domain concepts.

---

## 5.1 Required Terms

Use consistently:

- Training Session

- Training Block

- Training Category

- Assessment

- Assessment Run

- Assessment Template

- Measurement Mode

- Target Time

- Actual Time

- Handle

- In Handle

- Out Handle

- Draw

- Takeout

- Accuracy Thresholds

- Run Thresholds

- Comparison Thresholds

- Protocol Deviation

- Invalid Attempt

- Timing Provider

---

## 5.2 Avoid Inconsistent Synonyms

Do not alternate unnecessarily between:

- Training Category / Mode / Exercise Type

- Assessment Run / Test / Session

- Target Time / Goal Time / Desired Time

- Handle / Rotation Side

- Invalid Attempt / Bad Shot

- Protocol Deviation / Error

Use a different term only when it has a distinct domain meaning.

---

## 5.3 Capitalisation

Capitalise official product concepts consistently when they are used as named features:

- Fixed Weight

- Variable Weight

- Blind Weight

- Release Time Core Assessment

- Backline–Hog

- Hog–Hog

Use sentence case for general UI labels unless the existing interface pattern requires title case.

---

## 5.4 Units and Formatting

Use:

- `3.75 s` in explanatory copy and tables

- established compact formatting in metric components where space is limited

- `±0.10 s` for symmetric thresholds

- `0.02 s` for measured differences

- `6 percentage points` when comparing rates

Do not write:

- `6% better` when the metric increased from 70% to 76%

- `0.1 seconds` in one location and `0.10s` elsewhere without reason

Numeric formatting should follow central formatting utilities where possible.

---

# 6. Titles and Headings

Titles should be short and descriptive.

Good:

- Bias

- Consistency

- Target vs Actual

- Handle Comparison

- Protocol Integrity

- Current Shot

- Accuracy Thresholds

Avoid:

- Understanding How Your Performance Compares Across Different Handles

- Detailed Information About Your Current Assessment Run

---

## 6.1 Page Titles

Page titles identify the destination or current task.

Examples:

- Home

- Train

- Assess

- Analyze

- Settings

- Assessment Results

Do not repeat the product name unnecessarily on every functional page.

---

## 6.2 Section Titles

Section titles should identify one coherent responsibility.

Examples:

- Session Details

- Training Block

- Block Results

- Target Results

- Data &amp; Privacy

---

## 6.3 Eyebrow Labels

Use short eyebrow labels only when they add context.

Examples:

- Active Training Block

- Current Assessment

- Original Thresholds

Avoid decorative all-caps labels without informational value.

---

# 7. Subtitles and Descriptions

A subtitle should explain purpose, not repeat the title.

Poor:

&gt; Handle Comparison

&gt; Compares handles.

Better:

&gt; Shows measured timing differences between In and Out Handle.

Keep subtitles to one sentence where possible.

---

## 7.1 Chart Subtitles

Every chart should answer one athlete question.

Examples:

### Release Trend

&gt; Shows how your release times changed across the selected shots.

### Target Error by Shot

&gt; Shows how far each measured time was from its target.

### Target vs Actual

&gt; Shows how closely different target times were reproduced.

### Handle Comparison

&gt; Compares measured timing performance between In and Out Handle.

Avoid rhetorical questions where a direct explanation is clearer.

---

# 8. Navigation Labels

Navigation labels must remain:

- short

- stable

- recognisable

- consistent across mobile and desktop

Primary destinations:

- Home

- Train

- Assess

- Analyze

- Settings

Do not use alternate labels such as:

- Dashboard for Home

- Practice for Train

- Insights for Analyze

unless the product navigation model changes intentionally.

---

## 8.1 Contextual Back Actions

Use destination-specific labels where helpful.

Examples:

- Back to Assess

- Back to Analyze

- Back to Results

Avoid ambiguous labels such as:

- Back

- Return

when the destination is not visually obvious.

---

# 9. Button Labels

Button labels should describe the result of the action.

Use verbs.

Good:

- Start Training

- Add Shot

- Start Warm-up

- Resume Assessment

- View Full Results

- Export Assessment CSV

- Save Training Plan

- Restore Backup

Avoid vague labels:

- Submit

- Confirm

- Okay

- Proceed

- Yes

- Open

Use `Confirm` only when the action itself is confirmation.

---

## 9.1 Primary Actions

The label should reflect the immediate next state.

Examples:

- `Start Training`

- `Start Assessment`

- `Continue to Setup`

- `Start Scored Assessment`

- `View Full Results`

---

## 9.2 Secondary Actions

Examples:

- `View Protocol`

- `Edit Details`

- `View Analyze`

- `Pause Assessment`

---

## 9.3 Tertiary Actions

Examples:

- `Skip explanation`

- `Dismiss`

- `Reset`

- `View details`

---

## 9.4 Destructive Actions

Use explicit nouns.

Good:

- Delete Assessment Run

- Clear Training History

- Abandon Assessment

- Replace Local Data

Avoid:

- Delete

- Remove

- Continue

when the affected object is not obvious.

---

## 9.5 Cancel Actions

Use the safe alternative, not always `Cancel`.

Examples:

- Continue Assessment

- Keep Current Data

- Return to Training

- Keep Run

This reduces ambiguity in destructive confirmations.

---

# 10. Selection Labels

Selections describe a state or option.

They should not sound like actions.

Examples:

- Fixed Weight

- Variable Weight

- Blind Weight

- Backline–Hog

- Hog–Hog

- Standard

- Tight

- Custom

- In Handle

- Out Handle

- Draw

- Takeout

Do not label a selection:

- Select Fixed Weight

- Use Standard

- Choose In Handle

unless the control requires an instructional action label.

---

# 11. Form Labels

Labels must remain visible after input.

Good:

&gt; Session Name

&gt; Training Session

Do not rely only on placeholders.

---

## 11.1 Placeholders

Placeholders provide examples.

They must not contain:

- essential instructions

- required format information

- validation rules

- meaning that disappears after typing

Good:

&gt; e.g. Draw Weight Practice

Poor:

&gt; Required. Maximum 30 characters.

---

## 11.2 Optional Fields

Mark optional fields clearly where ambiguity is likely.

Example:

&gt; Notes — optional

Do not mark every required field unless the form contains a mix that could cause confusion.

---

## 11.3 Helper Text

Helper text should explain:

- purpose

- format

- effect

- constraint

Example:

&gt; Applies only to this Training Block.

Avoid repeating the field label.

---

## 11.4 Validation

Validation should explain:

1. what is wrong

2. how to fix it

Poor:

&gt; Invalid value.

Better:

&gt; On Target must be smaller than Acceptable.

Poor:

&gt; Error.

Better:

&gt; Enter a time between 2.50 and 4.50 seconds.

Do not blame the user.

Avoid:

&gt; You entered an invalid value.

Prefer:

&gt; Enter a valid target time.

---

# 12. Information and Help

Use Info actions when:

- a metric requires interpretation

- a feature may be misunderstood

- a protocol rule must remain accessible

- a mathematical definition matters

- the difference between two concepts is important

Do not use Info actions for:

- obvious actions

- labels that already explain themselves

- content that should be permanently visible

---

## 12.1 Help Structure

Detailed help should normally include:

1. what it measures or controls

2. how to read it

3. what it does not mean

4. relevant limitations

Example:

### Bias

&gt; Bias is the average signed difference between actual and target time.

&gt; A positive value means the measured time was higher than the target. A negative value means it was lower.

&gt; Bias shows direction, not overall accuracy.

---

# 13. Feedback Messages

The application should clearly communicate:

- successful actions

- failed actions

- saved state

- active state

- paused state

- unavailable functionality

- restored state

---

## 13.1 Routine Success

Routine actions should use subtle confirmation.

Examples:

- Shot added

- Training plan saved

- Backup created

Do not interrupt training with a modal after every successful action.

---

## 13.2 Completion

Use factual completion language.

Examples:

- Training complete

- Assessment complete

- Backup restored

Avoid excessive celebration unless the product intentionally introduces milestone recognition.

---

## 13.3 Active States

Examples:

- Auto Capture active

- Assessment paused

- Waiting for timing result

- Manual Timing selected

Active-state text should describe what the application is currently doing.

---

# 14. Loading States

Loading messages should describe the operation where useful.

Examples:

- Loading training history…

- Restoring assessment…

- Preparing export…

Avoid:

- Loading…

- Please wait…

for operations where clearer context is available.

Do not show loading copy for immediate local calculations.

---

# 15. Error Messages

Errors should:

- explain what failed

- preserve user input where possible

- identify the affected object

- offer the next action

- avoid raw technical language

---

## 15.1 Recoverable Error

Example:

&gt; The timing result could not be saved.

&gt; Check the connection and try again.

---

## 15.2 Invalid Saved Data

Example:

&gt; A saved assessment could not be restored because its data was invalid.

Do not display:

- stack traces

- schema names

- raw enum values

- JSON errors

---

## 15.3 Duplicate Input

Example:

&gt; This timing result has already been processed.

Only show the message when the athlete needs to act.

Silent idempotent handling may be preferable for harmless duplicates.

---

## 15.4 Connection Error

State:

- what is unavailable

- whether existing data is safe

- what remains usable

Example:

&gt; The timing device is unavailable.

&gt; Your recorded shots are safe. You can continue with Manual Timing.

---

# 16. Warnings

Warnings should be rare and actionable.

Use a warning when:

- comparison may be misleading

- data integrity may be affected

- a protocol deviation matters

- a destructive action is about to occur

- a timing setup requires attention

Avoid warnings for normal variation in athletic performance.

---

## 16.1 Warning Structure

A warning should include:

1. the issue

2. its effect

3. the next action, if needed

Example:

&gt; These runs use different Assessment versions and cannot be compared directly.

---

# 17. Confirmation Dialogs

Confirm only actions with meaningful consequences.

Examples:

- abandoning an Assessment

- deleting a completed Run

- clearing history

- restoring a backup

- replacing local data

Do not confirm routine actions such as:

- opening a result

- changing a filter

- adding a standard shot

- viewing a protocol

---

## 17.1 Confirmation Structure

A confirmation dialog should contain:

### Title

Name the action.

Example:

&gt; Abandon Assessment?

### Consequence

Explain what will happen.

&gt; Recorded attempts will remain saved as an incomplete run. The run will not count as a completed Assessment.

### Safe Action

&gt; Continue Assessment

### Destructive Action

&gt; Abandon Assessment

Avoid:

- Are you sure?

- This cannot be undone.

without specific context.

---

# 18. Empty States

Never display only:

- No data

- Empty

- Nothing here

An empty state should explain:

1. why nothing is shown

2. what is required

3. what action is available, if relevant

---

## 18.1 Analytics Empty States

Examples:

&gt; Add a shot to begin the live summary.

&gt; Add at least two shots to see the release trend.

&gt; Train at least one Variable Weight block to see Target vs Actual.

&gt; No handle data is available in this selection.

Do not show false values such as:

- Average: 0.00 s

- Standard Deviation: 0.000

- On Target: 0%

when no measured data exists.

---

## 18.2 History Empty States

Example:

&gt; No completed assessments yet.

&gt; Complete the Release Time Core Assessment to build your Assessment history.

Action:

&gt; Go to Assess

---

## 18.3 Comparison Empty States

Example:

&gt; Complete another comparable Assessment to see development over time.

---

## 18.4 Group-Level Empty States

When several related analytics are empty, prefer one shared empty state rather than repeating the same message in every card.

---

# 19. Training Language

Training copy should support deliberate practice without prescribing unnecessary behaviour.

---

## 19.1 Training Setup

Explain the decision, not the implementation detail.

### Fixed Weight

&gt; Reproduce one target time across multiple shots.

### Variable Weight

&gt; Train your ability to adapt between different target times.

### Blind Weight

&gt; Predict your release time before seeing the measured result.

---

## 19.2 Measurement Modes

### Backline–Hog

&gt; Measures the delivery from the backline to the hogline.

### Hog–Hog

&gt; Measures the stone from one hogline to the other.

Do not imply that one Measurement Mode is universally better.

---

## 19.3 Smart Random

Preferred:

&gt; Targets are generated automatically within the selected range.

If explaining purpose:

&gt; Train weight adaptation under changing targets.

Avoid:

&gt; The algorithm chooses random values.

unless technical detail is explicitly requested.

---

## 19.4 Current Shot

Current-shot copy should be extremely concise.

Prioritise:

- Target

- Expected Handle

- Actual Time

- Difference

- Next Shot

Avoid long instructions during active execution.

---

## 19.5 Auto Capture

Before start:

&gt; Automatically save incoming timing results for a defined sequence of shots.

While active:

&gt; Waiting for timing result.

After capture:

&gt; Shot 3 of 8 saved.

Avoid development-focused copy in production UI.

Do not show:

&gt; or the Simulator, in development mode

to normal users.

Development controls and explanations should be restricted to development environments.

---

# 20. Analytics Language

Analytics copy should help the athlete understand the measured pattern.

It must not turn measurements into unsupported coaching verdicts.

---

## 20.1 Mean Absolute Error

Title:

&gt; Average Error

or the established product term:

&gt; Mean Absolute Error

Description:

&gt; The average absolute difference between actual and target time.

Do not describe it as consistency.

---

## 20.2 Bias

Description:

&gt; Shows whether measured times were systematically above or below the target.

Detailed explanation:

&gt; Bias is the average signed difference between actual and target time.

---

## 20.3 Standard Deviation

Description:

&gt; Shows how consistently the timing errors are grouped around their average.

Do not describe Standard Deviation as accuracy.

---

## 20.4 On Target

Description:

&gt; The share of shots within the active On Target threshold.

Always show the active threshold context.

---

## 20.5 Major Miss

Description:

&gt; The share of shots outside the active Acceptable threshold.

Do not use Major Miss as a judgement of the athlete.

---

## 20.6 Target vs Actual

Description:

&gt; Shows how closely different target times were reproduced.

Do not say:

&gt; Can you hit different targets correctly?

The chart reports data; it does not ask or judge the athlete.

---

## 20.7 Handle Comparison

Description:

&gt; Compares measured timing performance between In and Out Handle.

Required limitation:

&gt; Timing differences between handles may reveal a pattern, but timing data alone does not identify the technical cause.

---

# 21. Threshold Language

Accuracy Thresholds are interpretation settings.

They are not validated sporting standards unless separately established.

Required principle:

&gt; Accuracy Thresholds control how results are grouped. They do not change the measured times.

---

## 21.1 Standard

Show exact values.

Example:

&gt; On Target ±0.10 s · Acceptable ±0.20 s

Do not describe Standard as:

- normal athlete level

- recommended for all players

- scientifically valid

unless validated later.

---

## 21.2 Tight

Describe as:

&gt; A stricter result grouping.

Do not describe as:

- Elite

- Professional

- Advanced player mode

---

## 21.3 Custom

Describe as:

&gt; Set your own On Target and Acceptable ranges.

Validation copy:

&gt; On Target must be smaller than Acceptable.

---

## 21.4 Original Thresholds

Use:

&gt; Original

Explanation:

&gt; Uses the thresholds selected when this Assessment Run started.

---

## 21.5 Comparison Thresholds

Use:

&gt; Comparison Thresholds

Explanation:

&gt; One shared threshold set is applied to all selected runs.

Do not compare category percentages using different threshold contexts.

---

# 22. Assessment Language

The Release Time Core Assessment v1 execution flow and Results/Analyze integration are implemented.

Authoritative product rules are defined in:

- `docs/ASSESSMENT_PRODUCT_AND_DOMAIN_[SPECIFICATION.md](http://SPECIFICATION.md)`

- `src/lib/assessmentContent.ts`

- `src/lib/assessmentResultContent.ts`

---

## 22.1 Assessment Purpose

Use:

&gt; Measure current performance under consistent conditions.

Do not use:

&gt; Test how good you are at curling.

---

## 22.2 What the Assessment Measures

Use:

&gt; This Assessment measures delivery-speed control.

Required limitation:

&gt; It does not evaluate final stone position, line, rotation, sweeping or overall curling ability.

---

## 22.3 Official Assessment

`Official Assessment` means:

- controlled definition

- versioned protocol

- non-editable published template

It does not automatically mean:

- Swiss Curling approved

- Curling Canada approved

- federation endorsed

- scientifically validated

Never use federation names without confirmed approval.

---

## 22.4 Assessment Introduction

Explain:

- purpose

- structure

- what is measured

- what is not measured

- why the blocks exist

Keep automatic introduction optional.

Keep protocol content permanently accessible.

---

## 22.5 Invalid Attempt

Use technical and objective language.

Examples:

- Timing gate did not trigger

- Timing system failure

- External interruption

- Corrupted timing result

Do not offer sporting execution errors as invalid reasons.

Avoid:

- Bad shot

- Poor release

- Wrong weight

- Athlete mistake

---

## 22.6 Wrong Handle

Required copy:

&gt; This attempt counts, but the executed handle differs from the planned handle.

Do not label the attempt invalid.

---

## 22.7 Protocol Deviation

Use factual language.

Examples:

&gt; 1 wrong-handle deviation was recorded.

&gt; This run was resumed after reload.

Avoid:

&gt; The protocol was broken.

unless the run is actually invalid according to domain rules.

---

## 22.8 Completion

Use:

&gt; Assessment complete

Show:

- completed date

- recorded shots

- invalid attempts

- Protocol Deviations

- threshold context

Do not use:

- Passed

- Failed

- Excellent

- Poor

---

# 23. Assessment Result Language

Assessment Results describe measured performance.

They must not classify the complete athlete.

---

## 23.1 Result Statements

Preferred:

- `MAE decreased by 0.02 s.`

- `Bias moved 0.01 s closer to zero.`

- `Standard Deviation increased by 0.01 s.`

- `On Target increased by 6 percentage points under Standard thresholds.`

- `The In Handle had a lower measured MAE in this run.`

Avoid:

- `You improved by 6%.`

- `Your consistency is now excellent.`

- `Your Out Handle is bad.`

- `Your technique improved.`

- `You are now an advanced player.`

---

## 23.2 Direction Without Verdict

Describe the change.

Do not automatically label it better or worse.

Examples:

- lower MAE generally indicates lower average error

- Bias closer to zero indicates less systematic directional error

- lower Standard Deviation indicates more tightly grouped errors

- higher On Target Rate depends on the applied threshold

When interpretation is not straightforward, describe only the metric movement.

---

## 23.3 Percentage Points

When comparing rates:

Use:

&gt; increased by 6 percentage points

Do not use:

&gt; increased by 6%

unless describing a relative percentage change intentionally and clearly.

---

## 23.4 One Run

Use:

- in this run

- within this Assessment

- the measured result

- this pattern

Avoid generalising one run into a persistent athlete trait.

Poor:

&gt; You struggle with slow weight.

Better:

&gt; Slow Delivery had the highest MAE in this run.

---

## 23.5 Small Samples

For Variable Adaptation:

&gt; This block contains eight scored stones. Transition breakdowns should be treated as descriptive, not definitive.

Do not use:

- statistically significant

- proven pattern

- reliable weakness

without a validated statistical basis.

---

# 24. Comparison Language

Comparisons require transparent eligibility.

---

## 24.1 Eligible Comparison

Use:

&gt; These runs use the same Assessment protocol and version.

---

## 24.2 Ineligible Comparison

Map every domain reason to plain language.

Examples:

### Different Template

&gt; These runs use different Assessment Templates.

### Different Version

&gt; These runs use different Assessment versions and cannot be compared directly.

### Different Measurement Mode

&gt; These runs use different Measurement Modes.

### Incomplete Run

&gt; Incomplete runs are not included in completed Assessment comparisons.

### Different Protocol Sequence

&gt; The planned shot sequences differ.

Never show raw codes such as:

- `different_version`

- `run_not_completed`

- `protocol_integrity_failed`

---

## 24.3 Threshold Context

Use:

&gt; Category results are recalculated using Standard thresholds for both runs.

Do not compare original category percentages from different threshold sets without explanation.

---

# 25. Trend Language

A trend describes multiple observations over time.

Do not call two data points a stable trend.

With one run:

&gt; Complete another comparable Assessment to see development over time.

With two runs:

&gt; Comparison across two completed runs.

With more runs:

&gt; Development across comparable completed runs.

Avoid:

- strong long-term trend

- consistent improvement

unless the data genuinely supports the statement and the interpretation rules allow it.

---

# 26. Coaching Language

The platform supports coaching.

It does not replace a coach.

---

## 26.1 Suggestion Structure

A useful suggestion should contain:

1. measured observation

2. uncertainty or limitation

3. optional next step

Example:

&gt; Slow Delivery showed the highest MAE in this run.

&gt; Timing data alone does not identify the technical cause.

&gt; Consider reviewing this pattern in training or with a coach.

---

## 26.2 Avoid Prescriptive Language

Avoid:

- You must train…

- You need to fix…

- Stop doing…

- Your technique is wrong.

Prefer:

- Consider reviewing…

- This may be worth practising…

- You could compare…

- A coach may help interpret…

---

## 26.3 Coach-Guided Context

When Coach workflows exist:

- coach-defined priorities take precedence over automated suggestions

- platform suggestions remain clearly identified as generated

- the athlete should understand who created or assigned a plan

Examples:

- Assigned by Coach

- Coach feedback

- Platform suggestion

Do not blur these sources.

---

# 27. Home Language

Home should help the athlete decide what to do next.

---

## 27.1 Today's Plan

No scheduled activity:

&gt; No scheduled session.

&gt; Start whenever you're ready.

Do not create an artificial training recommendation.

---

## 27.2 Active Activity

Examples:

- Resume Training

- Resume Assessment

- Assessment paused

- 12 of 32 scored stones completed

---

## 27.3 Training Overview

Use compact factual labels:

- Last Training

- Total Sessions

- Latest Assessment

Avoid showing zero values where the absence of data is more meaningful.

---

## 27.4 Coming Next

Future capabilities should use:

- Schedule

- Coach

- Team

- Coming Soon

Descriptions should remain factual.

Do not promise dates or functionality that is not committed.

---

# 28. Settings and Data Language

Data-management copy must be especially clear.

---

## 28.1 Local Storage

Use:

&gt; Your training and Assessment data is stored locally on this device.

If there is no cloud sync:

&gt; No account or cloud sync is currently used.

---

## 28.2 Export

Distinguish:

### CSV Export

&gt; Export data for analysis in spreadsheet or statistical software.

### Backup

&gt; Create a complete backup for restoration or transfer to another device.

Do not use `Export` and `Backup` as interchangeable concepts.

---

## 28.3 Restore

Explain:

- what will be restored

- whether current data will be replaced or merged

- whether a safety backup will be created

- compatibility issues

Example:

&gt; Restoring this backup will replace the current local data on this device.

---

## 28.4 Delete and Clear

Use explicit object names.

Examples:

- Clear Training History

- Delete Assessment Run

- Delete All Local Data

Do not use:

- Reset

- Clear

- Remove

without context.

---

# 29. Devices and Timing Providers

Use provider-neutral language in core workflows.

Preferred:

- Timing System

- Timing Provider

- External Timing

- Manual Timing

- Timing Gate

Avoid embedding manufacturer-specific terminology into domain-level copy.

Manufacturer names may appear in provider-specific setup or connection views.

---

## 29.1 Device Status

Examples:

- Manual Timing

- Timing System Connected

- Waiting for Timing Result

- Timing System Unavailable

---

## 29.2 Future Support

Avoid vague copy such as:

&gt; External timing systems will be supported here.

Prefer, where useful:

&gt; Connect and manage supported timing systems here.

Do not show this as available functionality before it exists.

---

# 30. Accessibility

Copy must remain understandable without relying on visual styling.

---

## 30.1 Do Not Rely on Colour

Combine colour with:

- text

- label

- icon

- state description

- pattern

---

## 30.2 Screen Reader Labels

Icon-only controls require clear accessible names.

Examples:

- Open Bias explanation

- Close Assessment Protocol

- Delete Assessment Run

- Show more filters

Do not use:

- Info

- Button

- Close

without context where ambiguity exists.

---

## 30.3 Progress

Progress must include readable text.

Examples:

- Warm-up shot 3 of 6

- Block 2 of 4

- 18 of 32 scored stones completed

---

## 30.4 Status

Do not rely on position or style alone.

Use explicit state copy:

- Selected

- Active

- Paused

- Incomplete

- Connected

- Unavailable

where semantic attributes alone are insufficient for understanding.

---

## 30.5 Error Identification

Error messages should identify the affected field or action in text.

Do not rely only on a red border.

---

# 31. Internationalisation

All user-facing text should originate from central content sources where practical.

Avoid long strings embedded directly inside React components.

Preferred central sources include:

- feature content modules

- result content modules

- shared validation-message mapping

- comparison-reason mapping

- export-label mapping

---

## 31.1 Writing for Translation

Use:

- complete sentences

- clear placeholders

- explicit nouns

- consistent terminology

Avoid:

- sentence fragments assembled from multiple strings

- pluralisation through string concatenation

- culturally specific idioms

- wordplay

- ambiguous pronouns

---

## 31.2 Dynamic Values

Prefer parameterised messages.

Example conceptually:

&gt; `{count} scored stones completed`

Do not build:

&gt; count + " stones completed"

where pluralisation or word order may differ by language.

---

# 32. Centralised Copy

Long or domain-sensitive copy should be centralised.

Current examples include:

- `src/lib/assessmentContent.ts`

- `src/lib/assessmentResultContent.ts`

- comparison-ineligibility copy

- validation-message mapping

Centralisation is especially important for:

- Assessment protocol

- metric definitions

- threshold explanations

- error messages

- comparison eligibility

- destructive confirmations

Short local labels may remain in components when centralisation would reduce clarity rather than improve it.

---

# 33. Content Reuse

Reuse established messages when the meaning is identical.

Do not create slightly different versions of the same explanation across:

- Training

- Assessment

- Analyze

- Help overlays

If context changes the meaning, write a context-specific version rather than forcing an inaccurate generic message.

---

# 34. Current Refactor Priorities

The planned mobile design-refinement pass should also improve copy.

---

## Priority 1 — Remove Development Copy from Production

Review visible text such as:

- Simulator

- development mode

- internal provider terminology

- technical debug status

Development-only functionality must not appear as normal production copy.

---

## Priority 2 — Replace False Zero States

Remove copy that presents missing data as real measurement.

Examples to remove:

- Average 0.00 s

- Release SD 0.000

- Target Accuracy: Not enough shots inside a metric tile

Use one compact group-level empty state instead.

---

## Priority 3 — Shorten Execution Copy

During active Training and Assessment:

- reduce instructional paragraphs

- keep current target and action labels concise

- move deeper explanations to Info actions

---

## Priority 4 — Clarify Analytics Questions

Replace vague or judgement-oriented subtitles.

Example:

Current style:

&gt; Can I hit different targets correctly?

Preferred:

&gt; Shows how closely different target times were reproduced.

---

## Priority 5 — Clarify Auto Capture

Separate:

- configuration copy

- active-state copy

- provider status

- development controls

Do not explain development infrastructure to athletes.

---

## Priority 6 — Align Terminology

Review visible UI for inconsistent use of:

- Mode

- Category

- Session

- Assessment

- Average Error

- Mean Absolute Error

- Release SD

- Standard Deviation

- Inhandle

- In Handle

- Outhandle

- Out Handle

Use the terms defined in the Domain Glossary.

---

# 35. Writing Review Checklist

Before approving new copy, verify:

## Purpose

- Does the user understand what this is?

- Does the user understand why it exists?

- Does the user understand what to do next?

## Clarity

- Is the text shorter than necessary, but not shorter than useful?

- Is the main point in the first sentence?

- Is the terminology consistent?

- Are units and formatting consistent?

## Precision

- Does the copy distinguish fact from interpretation?

- Does it avoid unsupported certainty?

- Does it avoid diagnosing technique?

- Does it avoid global athlete classification?

## Actions

- Does the button describe what will happen?

- Is the affected object named in destructive actions?

- Is the safe alternative clear?

## Errors

- Does the message explain what failed?

- Does it explain how to recover?

- Is entered data preserved where possible?

- Are raw technical errors hidden?

## Analytics

- Does every metric explain what it measures?

- Is threshold context visible?

- Are percentage-point comparisons correct?

- Are small samples described cautiously?

## Empty States

- Does the state explain why it is empty?

- Does it explain what is required?

- Does it avoid false zero values?

- Is there one relevant action where useful?

## Accessibility

- Does the copy make sense without colour or position?

- Are icon-only controls labelled?

- Is progress expressed in text?

- Are errors identified in words?

## Internationalisation

- Is the sentence complete?

- Can it be translated without reconstructing fragments?

- Are dynamic values parameterised?

---

# 36. Definition of Done

User-facing copy is complete only when:

- terminology matches `DOMAIN_[GLOSSARY.md](http://GLOSSARY.md)`

- purpose is clear

- the next action is clear

- button labels describe outcomes

- explanations use progressive disclosure

- facts and interpretations are separated

- no technical cause is inferred from timing alone

- threshold context is explicit

- comparison language is neutral and precise

- destructive consequences are explained

- errors support recovery

- empty states are useful

- accessibility labels are present

- production UI contains no development-only copy

- copy is centralised where practical

- wording is suitable for translation

---

# 37. Current Product Decision

The Curling Performance Platform communicates using:

- calm, factual and professional language

- short titles

- one-sentence purpose descriptions

- progressive disclosure

- explicit action labels

- consistent curling terminology

- visible threshold context

- observations before interpretations

- neutral comparison language

- cautious small-sample language

- no unsupported technical diagnosis

- no global athlete classification

- no federation endorsement claims without approval

- compact and actionable empty states

- specific recoverable error messages

- explicit destructive confirmations

- accessible text alternatives

- centralised domain-sensitive copy

- production language free from development terminology

These rules apply to all new features and to the planned mobile UX and design-refinement pass.