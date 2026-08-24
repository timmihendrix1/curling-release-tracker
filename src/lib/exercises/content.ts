// Curated Stage A Exercise content (spec sections 5.6, 10.1-10.3, 11).
//
// Three Exercises, each with exactly one immutable Exercise Version. Every
// user-facing string here is English. Original German source titles appear
// only inside `nonDisplayedSourceMetadata`, which no component renders — they
// exist for attribution traceability and Library search (spec 3.6).
//
// Nothing in this file invents a target time, tolerance, sporting standard,
// hardware capability or scoring rubric. Where the approved content states no
// value (difficulty for the two unrated Exercises, recommended volume, source
// reference goal, variations), the field is simply absent rather than filled
// with a plausible-looking default.
import { buildEightGuardsDiagram } from "./diagrams";
import {
  RELEASE_TIME_BACK_HOG_PROTOCOL_ID,
  RELEASE_TIME_HOG_HOG_PROTOCOL_ID,
} from "./measurementProtocols";
import {
  EXERCISE_CONTENT_SCHEMA_VERSION,
  type Exercise,
  type ExerciseScoreScaleEntry,
  type ExerciseVersion,
} from "./types";

export const RELEASE_POINT_EXERCISE_ID = "release-point";
export const EIGHT_GUARDS_EXERCISE_ID = "eight-guards-progressively-longer";
export const RELEASE_TIME_EXERCISE_ID = "release-time";

export const RELEASE_POINT_VERSION_ID = "release-point-v1";
export const EIGHT_GUARDS_VERSION_ID = "eight-guards-progressively-longer-v1";
export const RELEASE_TIME_VERSION_ID = "release-time-v1";

/** Curling's familiar 0-4 scale (spec 11.1). Zero is a valid scored result, never missing data. */
const CURLING_SCORE_SCALE: readonly ExerciseScoreScaleEntry[] = [
  { score: 0, percentage: 0 },
  { score: 1, percentage: 25 },
  { score: 2, percentage: 50 },
  { score: 3, percentage: 75 },
  { score: 4, percentage: 100 },
];

// ---------------------------------------------------------------------------
// 1. Release Point — Technique Exercise
// ---------------------------------------------------------------------------

function buildReleasePointVersion(): ExerciseVersion {
  return {
    id: RELEASE_POINT_VERSION_ID,
    exerciseId: RELEASE_POINT_EXERCISE_ID,
    version: 1,
    contentSchemaVersion: EXERCISE_CONTENT_SCHEMA_VERSION,
    contentLanguage: "en",
    title: "Release Point",
    primaryFocus: "technique",
    primaryTrainingPurpose: "release-location-control",
    additionalTrainingPurposes: ["repeatability"],
    goal: "Develop a repeatable release location so the delivery is easier to reproduce.",
    whyItMatters:
      "A release location that stays in the same place from shot to shot removes one source of variation, which makes the changes you do make on purpose easier to see.",
    setupInstructions: [
      {
        id: "reference-area",
        text: "Agree on a reference release area, preferably near the hog line or another point defined by the team.",
      },
    ],
    executionInstructions: [
      { id: "deliver", text: "The athlete delivers normally." },
      {
        id: "watch",
        text: "The athlete or an observer watches where the stone is released.",
      },
      {
        id: "compare",
        text: "Repeat, and compare the observed release location with the agreed reference.",
      },
      { id: "feedback", text: "Use factual feedback about what was observed." },
    ],
    guidance: {
      kind: "observation",
      observations: [
        "Look for a release location that remains close to the agreed reference.",
        "Describe visible variation without diagnosing its cause.",
      ],
      noScoringNote:
        "The app awards no score, points, percentage, pass/fail result, or technique rating for this exercise.",
    },
    variations: [],
    participation: {
      supportedModes: ["solo", "team"],
      minTrainingAthletes: 1,
      maxTrainingAthletes: null,
      roles: [
        { role: "delivering-athlete", requirement: "required" },
        {
          role: "observer",
          requirement: "optional",
          note: "An observer can watch the release location and describe what they saw.",
        },
      ],
      summary: "Usable Solo or in a Team. An observer is optional.",
    },
    sweeping: {
      policy: "optional",
      allowedSweeperCounts: [0, 1, 2],
      recommendedSweeperCount: 0,
      note: "Sweeping is not part of what this exercise trains. Sweep only if the team wants to practise the delivery in a fuller setting.",
    },
    equipment: [{ id: "stones", label: "Curling stones", requirement: "required" }],
    compatibleMeasurementProtocols: [],
    source: {
      kind: "platform-curated",
      attribution: "Platform-curated from the closed-beta Elite Team technique reference.",
      provenanceNote:
        "Written for this application in English. The original wording of the team's own reference is not reproduced.",
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Eight Guards, Progressively Longer — Shotmaking Exercise
// ---------------------------------------------------------------------------

function buildEightGuardsVersion(): ExerciseVersion {
  return {
    id: EIGHT_GUARDS_VERSION_ID,
    exerciseId: EIGHT_GUARDS_EXERCISE_ID,
    version: 1,
    contentSchemaVersion: EXERCISE_CONTENT_SCHEMA_VERSION,
    contentLanguage: "en",
    title: "Eight Guards, Progressively Longer",
    primaryFocus: "shotmaking",
    shotFamily: "guard",
    primaryTrainingPurpose: "weight-control",
    additionalTrainingPurposes: ["line-control", "progressive-distance-control"],
    difficulty: { kind: "level", level: 6 },
    goal: "Play eight guards in front of the house, with each stone finishing deeper than the previous one.",
    whyItMatters:
      "Placing every stone a little deeper than the last calls for a deliberate change in weight on each shot, instead of returning to one preferred weight.",
    setupInstructions: [
      {
        id: "one-athlete",
        text: "One delivering athlete plays eight stones without sweeping.",
      },
    ],
    executionInstructions: [
      { id: "first-stone", text: "Play the first stone just over the hog line." },
      {
        id: "next-zone",
        text: "The next target zone lies between the previous stone's depth and the house.",
      },
      { id: "assess", text: "After each stone stops, assess its finishing depth." },
      {
        id: "move-aside",
        text: "Move that stone to the side of the sheet at the same depth, so it marks the boundary for the next target.",
      },
      { id: "continue", text: "Continue until eight stones have been played." },
    ],
    guidance: {
      kind: "generic-shotmaking-score",
      scale: CURLING_SCORE_SCALE,
      explanation: [
        "Judge each stone on curling's 0 to 4 scale, against this exercise's goal and the handle actually played.",
        "The team applies its own judgement — there is no platform-standardised rubric for this exercise.",
        "Because each team judges for itself, 0 to 4 values from different teams are not comparable with each other.",
      ],
      evaluationBasis: "team-defined-unstructured",
      evaluationBasisNote:
        "This is a team-defined judgement of the exercise goal, not a platform-standardised score.",
    },
    sourceReferenceGoal: {
      text: "The source collection suggests 6 of 8 stones at the correct length. This is descriptive context only and is not evaluated by the app.",
      evaluated: false,
    },
    recommendedVolume: { kind: "stone-count", stones: 8 },
    variations: [
      { id: "same-handle", label: "Use the same handle for all eight stones." },
      { id: "handle-every-two", label: "Change handle after every two stones." },
      { id: "handle-every-stone", label: "Change handle after every stone." },
      { id: "no-broom", label: "Slide with the stone and without a broom." },
    ],
    participation: {
      supportedModes: ["solo", "team"],
      minTrainingAthletes: 1,
      maxTrainingAthletes: null,
      roles: [
        {
          role: "delivering-athlete",
          requirement: "required",
          note: "One athlete delivers at a time.",
        },
      ],
      summary: "Solo or in a Team. One athlete delivers at a time.",
    },
    sweeping: {
      policy: "forbidden",
      allowedSweeperCounts: [0],
      recommendedSweeperCount: 0,
      note: "No sweeping. Each stone's finishing depth comes from the delivery alone.",
    },
    equipment: [
      { id: "stones", label: "Eight curling stones", requirement: "required" },
      {
        id: "broom",
        label: "Delivery broom or stabiliser",
        requirement: "optional",
        note: "One of the curated variations slides without a broom.",
      },
    ],
    compatibleMeasurementProtocols: [],
    diagram: buildEightGuardsDiagram(),
    source: {
      kind: "external-collection",
      attribution:
        "Adapted by this application from Swiss Curling's Individual On-Ice Training – Exercise Collection, version 2.0.",
      organization: "Swiss Curling",
      collectionName: "Individual On-Ice Training – Exercise Collection",
      collectionVersion: "2.0",
      sourceExerciseReference: "Guard Exercise 10",
      sourcePage: 17,
      provenanceNote:
        "The wording, structure, page composition and diagram here are this application's own. The diagram is drawn independently in this application's normalised Ice Sheet coordinates and reproduces no part of the source illustration.",
      nonDisplayedSourceMetadata: {
        // Never rendered — attribution traceability and Library search only.
        originalTitles: ["Guard Übung 10: 8 Steine Guard, immer länger"],
        searchAliases: ["Guard Übung 10", "8 Steine Guard"],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Release Time — standalone Measured Exercise
// ---------------------------------------------------------------------------

function buildReleaseTimeVersion(): ExerciseVersion {
  return {
    id: RELEASE_TIME_VERSION_ID,
    exerciseId: RELEASE_TIME_EXERCISE_ID,
    version: 1,
    contentSchemaVersion: EXERCISE_CONTENT_SCHEMA_VERSION,
    contentLanguage: "en",
    title: "Release Time",
    primaryFocus: "measured",
    primaryTrainingPurpose: "repeatability",
    additionalTrainingPurposes: ["weight-control-awareness"],
    goal: "Practise reproducing a chosen delivery speed by measuring release time consistently.",
    whyItMatters:
      "Release time is a measured fact you can compare between shots, so it shows how closely you reproduced the speed you intended.",
    setupInstructions: [
      {
        id: "choose-protocol",
        // Both compatible protocols below are referenced as `optional` on
        // purpose: either may be used, and nothing in the approved content
        // makes one of them the standard for this Exercise. The requirement is
        // "pick one and keep it", which is stated here rather than fabricated
        // as a preference in the domain data.
        text: "Choose one of the supported release-time measurement modes and keep it for the whole execution.",
      },
      {
        id: "consistent-method",
        text: "Agree how the time is taken, and use the same reference points for every shot.",
      },
    ],
    executionInstructions: [
      {
        id: "deliver",
        text: "Deliver normally and record the measured release time for each shot.",
      },
      {
        id: "manual-entry",
        text: "A time taken by hand is a valid measurement for this exercise.",
      },
      {
        id: "compare",
        text: "Compare the measured times with each other across the execution.",
      },
    ],
    guidance: {
      kind: "observation",
      observations: [
        "Release time is a measured observation. It does not diagnose technique, and it does not fully predict where the stone finishes.",
        "Compare shots only when they were measured with the same mode and the same reference points.",
        "This is release-time training. It is not the Release Time Core Assessment, which has its own fixed protocol and lives under Assess.",
      ],
      noScoringNote:
        "The app awards no score, points, percentage or pass/fail result for this exercise, and prescribes no target time or accuracy tolerance.",
    },
    variations: [],
    participation: {
      supportedModes: ["solo", "team"],
      minTrainingAthletes: 1,
      maxTrainingAthletes: null,
      roles: [
        { role: "delivering-athlete", requirement: "required" },
        {
          role: "timekeeper",
          requirement: "optional",
          note: "Another person can take the time and say what they measured.",
        },
      ],
      summary: "Usable Solo or in a Team. A second person can take the time.",
    },
    sweeping: {
      policy: "optional",
      allowedSweeperCounts: [0, 1, 2],
      recommendedSweeperCount: 0,
      note: "Sweeping is not what this exercise measures. Keep it the same for every shot in one execution, so the measured times stay comparable.",
    },
    equipment: [
      { id: "stones", label: "Curling stones", requirement: "required" },
      {
        id: "timing",
        label: "A way to take the release time",
        requirement: "required",
        note: "A stopwatch or another method the team applies the same way for every shot.",
      },
    ],
    compatibleMeasurementProtocols: [
      {
        protocolId: RELEASE_TIME_BACK_HOG_PROTOCOL_ID,
        protocolVersion: 1,
        requirement: "optional",
      },
      {
        protocolId: RELEASE_TIME_HOG_HOG_PROTOCOL_ID,
        protocolVersion: 1,
        requirement: "optional",
      },
    ],
    source: {
      kind: "platform-curated",
      attribution:
        "Platform-curated from this application's existing Release Time training capability.",
      provenanceNote: "Written for this application in English.",
    },
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Exported unfrozen so tests can verify the builders are deterministic; product code uses the frozen catalog. */
export function buildStageAExercises(): Exercise[] {
  return [
    { id: RELEASE_POINT_EXERCISE_ID, currentVersionId: RELEASE_POINT_VERSION_ID },
    { id: EIGHT_GUARDS_EXERCISE_ID, currentVersionId: EIGHT_GUARDS_VERSION_ID },
    { id: RELEASE_TIME_EXERCISE_ID, currentVersionId: RELEASE_TIME_VERSION_ID },
  ];
}

export function buildStageAExerciseVersions(): ExerciseVersion[] {
  return [buildReleasePointVersion(), buildEightGuardsVersion(), buildReleaseTimeVersion()];
}
