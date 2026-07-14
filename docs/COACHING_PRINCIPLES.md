# Coaching Principles

## Purpose

This document defines the coaching philosophy of the application.

The goal is not simply to display measurements, but to help athletes improve through meaningful, trustworthy feedback.

The application should support better decisions while remaining honest about what the data can and cannot show.

This document complements:

- PRODUCT_DIRECTION_AND_[PRINCIPLES.md](http://PRINCIPLES.md)
- SYSTEM_[ARCHITECTURE.md](http://ARCHITECTURE.md)
- UX_WRITING_[GUIDELINES.md](http://GUIDELINES.md)
- DESIGN_[SYSTEM.md](http://SYSTEM.md)

---

# Coaching Philosophy

The application is a performance coach, not a statistics viewer.

Its purpose is to answer questions that help athletes train more effectively.

Whenever possible, the application should transform measurements into understanding.

---

# Core Principles

## Measure first

Every coaching insight must be grounded in observable data.

Never generate coaching advice that is not supported by measurements.

---

## Explain before recommending

Users should understand what happened before they are told what to change.

The application should first answer:

- What happened?

Then:

- Why might it have happened?

Finally:

- What could be worth investigating?

---

## Patterns over individual shots

One shot rarely tells a meaningful story.

The application should prioritise stable patterns over isolated events.

Avoid strong conclusions based on small samples.

---

## Trends over snapshots

Long-term improvement matters more than individual good or bad sessions.

The application should help athletes recognise sustainable trends.

---

## Compare comparable things

Meaningful coaching requires comparable data.

Whenever possible compare:

- the same training category
- the same measurement mode
- similar target ranges
- similar thresholds

Avoid comparisons that are likely to mislead.

---

## Show uncertainty honestly

Measurements have limitations.

The application should communicate uncertainty whenever conclusions become weaker.

Examples:

- small sample size
- varying thresholds
- mixed training categories
- mixed measurement modes

---

# Coaching Hierarchy

Whenever possible the application should answer questions in this order.

## Level 1

What happened?

Examples:

- Average Error
- Bias
- Consistency
- Major Misses

---

## Level 2

Is this normal?

Examples:

- compared to previous blocks
- compared to previous periods
- compared to the other handle

---

## Level 3

Is this improving?

Examples:

- Progress
- Long-term trends
- Reduced Major Misses
- Improved On Target rate

---

## Level 4

What should I investigate?

Examples:

"This pattern may indicate..."

The application should never claim certainty.

---

# Interpretation Principles

## Describe observations

Good:

The Out Handle shows a larger spread than the In Handle.

Bad:

Your Out Handle technique is poor.

---

## Separate measurement from interpretation

Facts:

- Bias
- Standard Deviation
- Average Error

Interpretation:

- may indicate
- suggests
- consider observing

These should always remain separate.

---

## Never diagnose technique directly

The application cannot know:

- body position
- balance
- line of delivery
- release quality
- sweeping execution
- tactical intention

Therefore it should never diagnose these directly.

---

## Prefer possibilities

Use wording such as:

- may indicate
- could suggest
- consider comparing
- worth investigating

Avoid:

- is caused by
- proves
- confirms

---

# Progress

Progress is not one number.

The application should recognise multiple dimensions of improvement.

Examples:

- reduced Bias
- reduced Average Error
- reduced Major Misses
- improved Consistency
- improved Weight Awareness
- improved Prediction Accuracy

Different athletes may improve in different dimensions.

---

# Coaching Goals

The application should help athletes answer questions such as:

- Am I improving?
- Where am I improving?
- Where am I still inconsistent?
- Which handle needs attention?
- Which weights are most difficult?
- Am I adapting well to changing targets?
- Am I accurately judging my own releases?

---

# Bias

Bias should be treated as a coaching concept rather than simply a mathematical value.

The application should help athletes recognise:

- systematic tendencies
- stable directional errors
- improvement towards zero

Bias alone is never sufficient.

Consistency must always be considered alongside it.

---

# Consistency

Consistency describes repeatability.

It does not necessarily imply accuracy.

Examples:

Low Bias + Low Consistency

Different errors may cancel each other out.

High Bias + High Consistency

The athlete may repeatedly produce the same systematic error.

---

# Major Misses

Major Misses deserve special attention.

Reducing severe mistakes often represents meaningful progress even before precision improves.

The application should therefore treat:

- Major Miss Rate
- Largest Miss
- Major Miss trends

as first-class coaching metrics.

---

# Blind Weight

Blind Weight measures awareness rather than execution alone.

The application should clearly distinguish:

Execution Accuracy

Did the athlete hit the intended target?

Prediction Accuracy

Did the athlete correctly judge their own release?

These are different coaching questions.

---

# Historical Comparison

Historical comparisons should encourage fair evaluation.

Prefer:

- comparable blocks
- comparable thresholds
- comparable target ranges

Avoid encouraging conclusions based on fundamentally different training conditions.

---

# Training Categories

Different training categories answer different questions.

Fixed Weight

Can I repeatedly reproduce the same release?

Variable Weight

Can I adapt to changing targets?

Blind Weight

Can I accurately judge my own release?

The application should never imply that one category is inherently better than another.

---

# Coaching Suggestions

Whenever suggestions are shown they should:

- be optional
- remain concise
- be evidence-based

Suggestions should never interrupt training.

---

# Future Coaching

Future versions of the application may generate richer coaching insights.

These insights should always remain:

- transparent
- explainable
- traceable back to measurements

The athlete should always be able to understand why a suggestion was made.

---

# Design Rule

The application should make athletes think.

It should not think for them.

The goal is to improve judgement, not replace it.

---

# Final Principle

A good coach does not merely tell athletes what happened.

A good coach helps athletes notice patterns they might otherwise have missed.

The application should strive to do the same.



---

# Long-term Athlete Development

The application's ultimate goal is not to create dependence on the software.

Its purpose is to help athletes develop their own judgement.

Over time, athletes should increasingly recognise patterns themselves before consulting the analytics.

Examples:

- recognising systematic bias during practice

- noticing reduced consistency before reviewing the data

- improving weight awareness through Blind Weight training

- learning to adapt weight instinctively under changing targets

The application should reinforce these learning processes rather than replace them.

A successful athlete should become better at interpreting their own performance, with the application acting as a trusted training partner rather than an authority.

The application supports learning.

It does not replace experience.