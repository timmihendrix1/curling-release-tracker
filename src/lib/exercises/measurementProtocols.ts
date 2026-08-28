// Reusable, versioned Measurement Protocols (spec section 12.1). A protocol
// defines what is measured and how, independently of the Exercise that uses it
// — it is never duplicated as ad-hoc fields inside each Exercise.
//
// The initial catalog defines the two release-time protocols that correspond to the
// Measurement Modes this application already implements. Their semantics come
// straight from the existing Training domain (`MeasurementMode`,
// `measurementModeLabel`, and the approved copy in
// docs/UX_WRITING_GUIDELINES.md section 19.2), so this file adds no second,
// competing definition of Backline-Hog or Hog-Hog.
import { measurementModeLabel } from "../trainingBlocks";
import type { MeasurementProtocol } from "./types";

export const RELEASE_TIME_BACK_HOG_PROTOCOL_ID = "release-time-back-hog";
export const RELEASE_TIME_HOG_HOG_PROTOCOL_ID = "release-time-hog-hog";
export const ROTATION_COUNT_PROTOCOL_ID = "rotation-count-manual";

/**
 * The curated catalog lists only `"manual"` as an allowed source. That is the honest
 * current state: manual entry (including the manual fallback inside a Capture
 * Sequence) is the one real release-time source, `"simulator"` is a
 * development-only Timing Provider, and `"external"` hardware is reserved but
 * not implemented (see docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md). No
 * curated protocol may imply hardware support that does not exist.
 */
const MANUAL_ONLY_SOURCES = ["manual"] as const;

const RELEASE_TIME_BACK_HOG: MeasurementProtocol = {
  id: RELEASE_TIME_BACK_HOG_PROTOCOL_ID,
  version: 1,
  name: `Release Time (${measurementModeLabel("back-hog")})`,
  metricType: "release-time",
  unit: "seconds",
  measurementMode: "back-hog",
  referencePoints: "Release time from the back line to the hog line.",
  allowedSources: MANUAL_ONLY_SOURCES,
  guidance:
    "Use the same timing method and the same reference points for every shot in one execution, so the values can be compared with each other.",
  target: null,
};

const RELEASE_TIME_HOG_HOG: MeasurementProtocol = {
  id: RELEASE_TIME_HOG_HOG_PROTOCOL_ID,
  version: 1,
  name: `Release Time (${measurementModeLabel("hog-hog")})`,
  metricType: "release-time",
  unit: "seconds",
  measurementMode: "hog-hog",
  referencePoints: "Release time between the two hog lines.",
  allowedSources: MANUAL_ONLY_SOURCES,
  guidance:
    "This measures a different stretch of ice than the back line to hog line protocol, so values from the two are not directly comparable. Keep one protocol for a whole execution.",
  target: null,
};

const ROTATION_COUNT_MANUAL: MeasurementProtocol = {
  id: ROTATION_COUNT_PROTOCOL_ID,
  version: 1,
  name: "Rotation Count",
  metricType: "rotation-count",
  unit: "rotations",
  referencePoints: "Count the stone's rotations from release until it stops or leaves play.",
  allowedSources: MANUAL_ONLY_SOURCES,
  guidance:
    "Count full and half rotations. Use increments of 0.5 and keep the same start and end points throughout one execution.",
  target: null,
};

/** Every Measurement Protocol the curated catalog knows about. */
export const CURATED_MEASUREMENT_PROTOCOLS: readonly MeasurementProtocol[] = [
  RELEASE_TIME_BACK_HOG,
  RELEASE_TIME_HOG_HOG,
  ROTATION_COUNT_MANUAL,
];
