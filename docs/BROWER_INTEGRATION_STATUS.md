# Brower Integration Status

**Status:** Technical Discovery Completed  

**Last Updated:** 2026-07-15

---

# Purpose

This document tracks the current state of the Brower Timing integration for the Curling Performance Platform.

It is a living discovery document describing what is currently known, which architectural decisions have been made, what remains unknown, and the planned next steps.

The goal is to integrate Brower Timing Systems without coupling the application to Brower-specific concepts. Brower should become one implementation of the generic Timing Provider architecture.

---

# Current Status

**Discovery phase:** Completed

The hardware architecture of the legacy Brower system has been investigated and the preferred integration strategy has changed.

The project is currently waiting for technical clarification from Brower before purchasing a TCi Timer.

---

# Project Timeline

## Initial Assumption

The initial idea was to integrate the existing Brower hardware by reverse engineering its RF communication.

The objective was to receive the same timing events as the display while leaving the Brower hardware completely untouched.

---

## Hardware Discovery

Inspection of the existing hardware revealed:

Display

- TI MSP430F448 microcontroller

- TI CC1101 RF transceiver

- Motherboard V4

- Daughterboard Rev3

Photogate

- TI CC1150 RF transmitter

Additional findings:

- RF frequency: **432.8 MHz**

- Range: approximately **300 metres**

- RF delay: **0.0005 seconds**

These findings suggested that passive RF protocol analysis would likely be feasible.

---

## Strategy Change

After discussions with Brower Timing Systems, the preferred strategy changed.

Rather than reverse engineering the legacy RF communication, the preferred implementation path is now to integrate Brower's officially supported BLE interface using the TCi Timer.

Reverse engineering remains a fallback option if required in the future.

---

# Product Vision

The Brower integration is **not** the product.

It is the first hardware integration of a much larger Curling Performance Platform.

Long-term vision includes:

- automatic timing capture

- structured training sessions

- performance analytics

- coach dashboards

- season-long athlete tracking

- video analysis

- future sensor integrations

- multiple timing providers

The application must remain completely vendor-independent.

---

# Existing Club Hardware

Current hardware available:

- Older Brower Timing System

- Blue Brower photogates

- Three timing gates

- Large display

- No Smartphone Interface

- No TCi Timer

Observed behaviour:

## Normal Mode

- Gate 1 starts timing

- Gate 2 stops timing

- Gate 3 starts a new measurement

## Split Mode

- Gate 2 displays an intermediate split

- Timer continues running

- Gate 3 displays the next split

The existing legacy system provides no official mechanism for transferring timing data to an external application.

---

# Hardware Investigation

## Display

Hardware identified:

- Motherboard V4

- Daughterboard Rev3

- TI MSP430F448

- TI CC1101 RF transceiver

## Timing Gate

Hardware identified:

- TI CC1150 RF transmitter

## RF Communication

Confirmed from the Brower manual:

- Frequency: **432.8 MHz**

- Range: approximately **300 m**

- Resolution: **1/1000 s**

- RF delay: **0.0005 s**

---

# Official Brower Response

Brower confirmed that the recommended integration path is the **TCi Timer with Smartphone Interface**.

Important information:

- Existing blue photogates remain compatible.

- Only the timer/display must be replaced.

- Previous generation photogates are supported.

- The TCi Timer costs approximately **USD 905**.

- Brower is willing to support the integration.

- Technical questions should be directed to **Dan**.

Most important statement:

&gt; "The only way forward is to use the TCi Timer with the Smartphone Interface."

Current conclusion:

The existing photogates can continue to be used.

Only the communication component (timer/display) needs to be replaced.

---

# Official BLE Documentation

Brower supplied:

**TC Timer BLE to Smartphone BLE Communication V4**

The documentation contains:

- BLE Service UUID

- Characteristic UUIDs

- command structure

- notification protocol

- memory organisation

- athlete records

- session handling

- split time format

- time base

- serial number service

- BLE advertising packets

This documentation appears sufficient to implement an official Brower integration without reverse engineering the RF communication.

---

# Why This Approach

The project now prefers the official BLE interface because it:

- is officially supported by Brower

- significantly reduces implementation risk

- is future-proof

- remains compatible with existing photogates

- avoids maintaining a reverse-engineered RF protocol

- allows development effort to focus on the product rather than hardware reverse engineering

Reverse engineering remains technically feasible but is no longer the preferred development path.

---

# Architecture Direction

The application consumes **provider-neutral timing events**.

Whether those events originate from:

- manual entry

- Brower BLE

- future Bluetooth timing systems

- future Wi-Fi timing systems

- or any other timing provider

must not affect the Capture Foundation, Training Engine or Analytics.

Target architecture:

```

Timing Provider

├── Manual

├── Simulator

├── Brower BLE

└── Future Providers

        │

        ▼

Capture Foundation

        │

        ▼

Training Engine

        │

        ▼

Analytics

```

The Brower adapter should:

- connect via BLE

- identify the TCi Timer

- retrieve new timing records

- parse Brower packets

- convert them into provider-neutral timing events

The rest of the application should remain completely unaware of Brower-specific concepts.

---

# Open Technical Questions

## High Priority

### BLE Behaviour

- Are notifications sent automatically when a new athlete is recorded?

- Or must memory locations be polled?

### Trigger Events

Can individual trigger events be received?

- Start

- Split

- Finish

Or are only completed athlete records available?

### Split Behaviour

Are split times streamed immediately?

Or only once the athlete has finished?

### Curling Workflow

How is the "New Athlete" workflow intended to be used?

Can repeated curling shots be measured efficiently without creating unnecessary friction?

---

## Medium Priority

### Protocol Stability

- Is the BLE protocol considered stable?

- Are UUIDs expected to remain stable across firmware versions?

- Are sample BLE packets available?

- Is a simulator or development device available?

---

## Low Priority

### Commercial Questions

- Are there any licensing requirements?

- May third-party software advertise Brower compatibility?

---

# Procurement Status

No purchase has been made yet.

Current recommendation:

1. Clarify all remaining technical questions with Brower.

2. Continue developing the generic Timing Provider architecture.

3. Purchase the TCi Timer only once it becomes the development bottleneck.

---

# Decision Log

## Decision 001

**Do not tightly couple the application to Brower.**

Status:

Accepted

---

## Decision 002

**Keep manual time entry permanently available as a fallback.**

Status:

Accepted

---

## Decision 003

**Prefer the officially supported BLE interface over reverse engineering.**

Status:

Accepted

---

## Decision 004

**Delay purchasing the TCi Timer until the remaining technical questions have been answered.**

Status:

Accepted

---

# Immediate Next Steps

## Brower

- Contact Dan

- Clarify the remaining technical questions

- Request sample BLE packets if available

- Request a simulator or development hardware if available

---

## Product

Continue development of:

- Timing Provider abstraction

- Analytics

- Training modes

- UX improvements

without waiting for hardware.

---

# Reverse Engineering

Reverse engineering is **no longer the preferred approach**.

However, it remains technically feasible and may become relevant if:

- the official BLE interface proves insufficient

- unsupported legacy hardware needs to be integrated

- official hardware becomes unavailable

- additional timing providers require similar work

---

# Current Conclusion

The integration strategy has fundamentally changed.

Instead of reverse engineering the legacy RF communication, the preferred implementation path is now Brower's officially supported BLE interface through the TCi Timer.

This significantly reduces implementation risk, aligns the project with Brower's future hardware roadmap and fits naturally into the existing provider-based architecture.

The only remaining blocker before hardware purchase is clarifying the outstanding technical questions with Brower.