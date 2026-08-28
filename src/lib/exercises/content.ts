// Curated Stage A + Stage E Exercise content (spec sections 5.6, 10.1-10.3, 11).
//
// Seven Exercises with immutable Exercise Versions; Eight Guards retains v1/v2
// and publishes v3 for the approved restricted source diagram. Every
// user-facing string here is English. Original German source titles appear
// only inside `nonDisplayedSourceMetadata`, which no component renders — they
// exist for attribution traceability and Library search (spec 3.6).
//
// Nothing in this file invents a target time, tolerance, sporting standard,
// hardware capability or scoring rubric. Where the approved content states no
// value (difficulty for the two unrated Exercises, recommended volume, source
// reference goal, variations), the field is simply absent rather than filled
// with a plausible-looking default.
import {
  buildEightGuardsDiagram,
  buildReleaseGatesDiagram,
  buildRestrictedSwissCurlingDiagram,
} from "./diagrams";
import {
  RELEASE_TIME_BACK_HOG_PROTOCOL_ID,
  RELEASE_TIME_HOG_HOG_PROTOCOL_ID,
  ROTATION_COUNT_PROTOCOL_ID,
} from "./measurementProtocols";
import {
  EXERCISE_CONTENT_SCHEMA_VERSION,
  type Exercise,
  type ExerciseScoreScaleEntry,
  type ExerciseVersion,
} from "./types";
import {
  SWISS_CURLING_DRAW_6_ASSET_ID,
  SWISS_CURLING_GUARD_10_ASSET_ID,
  SWISS_CURLING_SOFTSHOT_5_ASSET_ID,
} from "./restrictedAssetCatalog";

export const RELEASE_POINT_EXERCISE_ID = "release-point";
export const EIGHT_GUARDS_EXERCISE_ID = "eight-guards-progressively-longer";
export const RELEASE_TIME_EXERCISE_ID = "release-time";
export const RELEASE_GATES_EXERCISE_ID = "release-gates";
export const ROTATION_COUNT_EXERCISE_ID = "stone-rotation-count";
export const COME_AROUND_EXERCISE_ID = "come-around-outside-in-before-t-line";
export const SOFT_TAKEOUT_EXERCISE_ID = "soft-takeout-centre-line-t-line";

export const RELEASE_POINT_VERSION_ID = "release-point-v1";
export const EIGHT_GUARDS_V1_VERSION_ID = "eight-guards-progressively-longer-v1";
export const EIGHT_GUARDS_VERSION_ID = "eight-guards-progressively-longer-v2";
export const EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID =
  "eight-guards-progressively-longer-v3";
export const RELEASE_TIME_VERSION_ID = "release-time-v1";
export const RELEASE_GATES_VERSION_ID = "release-gates-v1";
export const ROTATION_COUNT_VERSION_ID = "rotation-count-v1";
export const COME_AROUND_VERSION_ID = "come-around-outside-in-before-t-line-v1";
export const SOFT_TAKEOUT_VERSION_ID = "soft-takeout-centre-line-t-line-v1";

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

function buildEightGuardsVersion1(): ExerciseVersion {
  return {
    id: EIGHT_GUARDS_V1_VERSION_ID,
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

/** Version 2 adds the approved optional half-rotation measurement without rewriting v1. */
function buildEightGuardsVersion2(): ExerciseVersion {
  return {
    ...buildEightGuardsVersion1(),
    id: EIGHT_GUARDS_VERSION_ID,
    version: 2,
    compatibleMeasurementProtocols: [{
      protocolId: ROTATION_COUNT_PROTOCOL_ID,
      protocolVersion: 1,
      requirement: "optional",
    }],
  };
}

/** Version 3 replaces the platform schematic with the approved closed-beta source diagram. */
function buildEightGuardsVersion3(): ExerciseVersion {
  return {
    ...buildEightGuardsVersion2(),
    id: EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
    version: 3,
    diagram: buildRestrictedSwissCurlingDiagram({
      id: "eight-guards-progressively-longer-source-diagram-v1",
      assetId: SWISS_CURLING_GUARD_10_ASSET_ID,
      caption: "Guard Exercise 10 — original Swiss Curling diagram.",
      accessibleSummary:
        "A top-down house and centre line with eight numbered guard positions progressing from just over the hog line toward the house. After each stone stops, it is moved sideways at the same depth to mark the next boundary.",
      sourceExerciseReference: "Guard Exercise 10, page 17",
      localizedTextOverlays: [{
        id: "move-stone-aside",
        x: 0.047,
        y: 0.757,
        width: 0.382,
        height: 0.117,
        text: "After each stone stops, move it aside as a marker.",
        backgroundColor: "#ffffff",
        textColor: "#000000",
        fontSize: 0.031,
      }],
    }),
    source: {
      ...buildEightGuardsVersion2().source,
      provenanceNote:
        "English exercise copy and application presentation are platform-authored. The attributed source diagram is reproduced for the configured one-Team closed beta with its embedded German instruction covered by a faithful English overlay.",
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
// 4. Release Gates — Technique Exercise
// ---------------------------------------------------------------------------

function buildReleaseGatesVersion(): ExerciseVersion {
  return {
    id: RELEASE_GATES_VERSION_ID,
    exerciseId: RELEASE_GATES_EXERCISE_ID,
    version: 1,
    contentSchemaVersion: EXERCISE_CONTENT_SCHEMA_VERSION,
    contentLanguage: "en",
    title: "Release Gates",
    primaryFocus: "technique",
    primaryTrainingPurpose: "line-control",
    additionalTrainingPurposes: ["release-location-control", "repeatability"],
    goal: "Observe whether the stone continues through two aligned gates after release.",
    whyItMatters:
      "Two close reference gates make the stone's direction immediately after release easier for the athlete or an observer to see and discuss.",
    setupInstructions: [
      {
        id: "first-gate",
        text: "Place one gate across the agreed delivery line at the Release Point.",
      },
      {
        id: "second-gate",
        text: "Place a second gate on the same line, approximately 30 cm farther along the sheet.",
      },
      {
        id: "safe-clearance",
        text: "Make both gates wide enough for the stone to pass through without touching the markers.",
      },
    ],
    executionInstructions: [
      { id: "deliver", text: "Deliver the stone normally through the two gates." },
      {
        id: "observe",
        text: "The athlete or an observer watches how the stone travels after release and whether it passes through both gates.",
      },
      {
        id: "feedback",
        text: "Describe what was observed, adjust if useful, and repeat the delivery.",
      },
    ],
    guidance: {
      kind: "observation",
      observations: [
        "Observe the stone's path through the first and second gate.",
        "Describe visible changes in direction after release without assigning a technique score or diagnosing their cause.",
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
          note: "An observer can watch the stone pass the gates and describe what they saw.",
        },
      ],
      summary: "Usable Solo or in a Team. An observer is optional.",
    },
    sweeping: {
      policy: "optional",
      allowedSweeperCounts: [0, 1, 2],
      recommendedSweeperCount: 0,
      note: "Sweeping is not part of the observation between the two gates. It may begin later if the Team continues the shot.",
    },
    equipment: [
      { id: "stones", label: "Curling stones", requirement: "required" },
      {
        id: "gates",
        label: "Two release gates or four markers",
        requirement: "required",
        note: "Use them to mark two openings on the agreed delivery line.",
      },
    ],
    compatibleMeasurementProtocols: [],
    diagram: buildReleaseGatesDiagram(),
    source: {
      kind: "platform-curated",
      attribution: "Platform-curated from the closed-beta Elite Team technique reference.",
      provenanceNote:
        "Written for this application in English. The original German source alias is retained only as non-displayed metadata.",
      nonDisplayedSourceMetadata: {
        originalTitles: ["Törli"],
        searchAliases: ["Törli", "Toerli", "release gate"],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Rotation Count — standalone Measured Exercise
// ---------------------------------------------------------------------------

function buildRotationCountVersion(): ExerciseVersion {
  return {
    id: ROTATION_COUNT_VERSION_ID,
    exerciseId: ROTATION_COUNT_EXERCISE_ID,
    version: 1,
    contentSchemaVersion: EXERCISE_CONTENT_SCHEMA_VERSION,
    contentLanguage: "en",
    title: "Rotation Count",
    primaryFocus: "measured",
    primaryTrainingPurpose: "rotation-control",
    additionalTrainingPurposes: ["repeatability", "handle-control"],
    goal: "Practise reproducing a chosen stone rotation by counting full and half rotations.",
    whyItMatters:
      "A factual rotation count lets the athlete compare deliveries without turning the observation into a technique rating or a pass/fail result.",
    setupInstructions: [
      {
        id: "choose-reference-points",
        text: "Count from release until the stone stops or leaves play, and keep those reference points for the whole execution.",
      },
      {
        id: "choose-counter",
        text: "The athlete, a teammate or another observer may count the rotations.",
      },
    ],
    executionInstructions: [
      { id: "deliver", text: "Deliver the stone normally." },
      {
        id: "count",
        text: "Count each full rotation and include a final half rotation when applicable.",
      },
      {
        id: "record",
        text: "Record the observed Rotation Count in increments of 0.5 and repeat.",
      },
    ],
    guidance: {
      kind: "observation",
      observations: [
        "Compare only values counted with the same start and end points.",
        "The Team may choose its own intended rotation count; the app does not prescribe one.",
        "A Rotation Count is an observation of the stone, not an automatic diagnosis of the athlete's technique.",
      ],
      noScoringNote:
        "The app records the measured rotations but awards no score, percentage, target attainment, or pass/fail result.",
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
          note: "Another participant can count and report the observed rotations.",
        },
      ],
      summary: "Usable Solo or in a Team. Another participant may count the rotations.",
    },
    sweeping: {
      policy: "optional",
      allowedSweeperCounts: [0, 1, 2],
      recommendedSweeperCount: 0,
      note: "Sweeping is optional. Record the actual Sweeper context so later interpretation does not assume the stone was unswept.",
    },
    equipment: [
      { id: "stones", label: "Curling stones", requirement: "required" },
    ],
    compatibleMeasurementProtocols: [{
      protocolId: ROTATION_COUNT_PROTOCOL_ID,
      protocolVersion: 1,
      requirement: "required",
    }],
    source: {
      kind: "platform-curated",
      attribution: "Platform-curated for this application's manual Rotation Count training.",
      provenanceNote: "Written for this application in English.",
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Come-around from Outside to Inside, Before the T-Line — Shotmaking
// ---------------------------------------------------------------------------

function buildComeAroundVersion(): ExerciseVersion {
  return {
    id: COME_AROUND_VERSION_ID,
    exerciseId: COME_AROUND_EXERCISE_ID,
    version: 1,
    contentSchemaVersion: EXERCISE_CONTENT_SCHEMA_VERSION,
    contentLanguage: "en",
    title: "Come-around from Outside to Inside, Before the T-Line",
    primaryFocus: "shotmaking",
    shotFamily: "draw",
    primaryTrainingPurpose: "weight-control",
    additionalTrainingPurposes: ["line-control", "handle-control"],
    difficulty: { kind: "level", level: 3 },
    goal:
      "Play come-arounds from outside to inside so the stones finish in the house before the T-line and are covered by the guard.",
    whyItMatters:
      "The exercise combines draw weight and line control with the need to use a guard effectively from both handles.",
    setupInstructions: [
      {
        id: "place-guard",
        text: "Place the guard shown in the diagram outside the centre line.",
      },
      {
        id: "target-zone",
        text: "Use the area from the front edge of the 12-foot ring to the T-line as the finishing zone.",
      },
    ],
    executionInstructions: [
      {
        id: "first-handle",
        text: "Play four come-arounds with one handle, working from outside toward the centre line.",
      },
      {
        id: "second-handle",
        text: "Play four come-arounds with the other handle, again working from outside toward the centre line.",
      },
      {
        id: "clear",
        text: "Judge and record each stone after it stops, then clear it before the next delivery.",
      },
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
      text: "The source collection uses 6 of 8 stones finishing before the T-line and at least half hidden behind the guard as its reference goal. This is descriptive context only and is not evaluated by the app.",
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
      roles: [{ role: "delivering-athlete", requirement: "required" }],
      summary: "Solo or in a Team. One athlete delivers at a time.",
    },
    sweeping: {
      policy: "forbidden",
      allowedSweeperCounts: [0],
      recommendedSweeperCount: 0,
      note: "No sweeping. Judge the delivered stone without changing its path through sweeping.",
    },
    equipment: [
      { id: "stones", label: "Eight curling stones", requirement: "required" },
      { id: "guard", label: "One guard stone", requirement: "required" },
      {
        id: "broom",
        label: "Delivery broom or stabiliser",
        requirement: "optional",
        note: "One of the curated variations slides without a broom.",
      },
    ],
    compatibleMeasurementProtocols: [{
      protocolId: ROTATION_COUNT_PROTOCOL_ID,
      protocolVersion: 1,
      requirement: "optional",
    }],
    diagram: buildRestrictedSwissCurlingDiagram({
      id: "come-around-outside-in-before-t-line-source-diagram-v1",
      assetId: SWISS_CURLING_DRAW_6_ASSET_ID,
      caption: "Draw Exercise 6 — original Swiss Curling diagram.",
      accessibleSummary:
        "A top-down house with one guard outside the centre line, eight numbered curved paths alternating handles, and finishing positions progressing from outside toward the centre before the T-line.",
      sourceExerciseReference: "Draw Exercise 6, page 25",
    }),
    source: {
      kind: "external-collection",
      attribution:
        "Adapted by this application from Swiss Curling's Individual On-Ice Training – Exercise Collection, version 2.0.",
      organization: "Swiss Curling",
      collectionName: "Individual On-Ice Training – Exercise Collection",
      collectionVersion: "2.0",
      sourceExerciseReference: "Draw Exercise 6",
      sourcePage: 25,
      provenanceNote:
        "English exercise copy and application presentation are platform-authored. The attributed source diagram is reproduced unchanged for the configured one-Team closed beta.",
      nonDisplayedSourceMetadata: {
        originalTitles: [
          "Draw Übung 6: Comearound von aussen nach innen, vor T-Line",
        ],
        searchAliases: ["Draw Übung 6", "Comearound", "Come-around"],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 7. Soft Take-out on the Centre Line at the T-Line — Shotmaking
// ---------------------------------------------------------------------------

function buildSoftTakeoutVersion(): ExerciseVersion {
  return {
    id: SOFT_TAKEOUT_VERSION_ID,
    exerciseId: SOFT_TAKEOUT_EXERCISE_ID,
    version: 1,
    contentSchemaVersion: EXERCISE_CONTENT_SCHEMA_VERSION,
    contentLanguage: "en",
    title: "Soft Take-out on the Centre Line at the T-Line",
    primaryFocus: "shotmaking",
    shotFamily: "soft-take-out",
    primaryTrainingPurpose: "weight-control",
    additionalTrainingPurposes: ["line-control", "handle-control"],
    difficulty: { kind: "level", level: 4 },
    goal:
      "Use soft take-out weight to move the target stone from the T-line into the target zone behind the house.",
    whyItMatters:
      "Controlling both line and controlled take-out weight helps move a stone precisely without removing it too far from play.",
    setupInstructions: [
      {
        id: "target-stone",
        text: "Place one target stone on the centre line at the T-line, as shown in the diagram.",
      },
      {
        id: "target-zone",
        text: "Use the marked area behind the house as the finishing zone for the target stone.",
      },
    ],
    executionInstructions: [
      {
        id: "four-stones",
        text: "Play four stones with the same handle and soft take-out weight, without sweeping.",
      },
      {
        id: "assess-reset",
        text: "After each shot, judge and record the result, clear the delivered stone, and reset the target stone on the T-line.",
      },
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
      text: "The source collection uses 3 of 4 target stones finishing in the marked zone as its reference goal. This is descriptive context only and is not evaluated by the app.",
      evaluated: false,
    },
    recommendedVolume: { kind: "stone-count", stones: 4 },
    variations: [
      { id: "handle-every-two", label: "Change handle after every two stones." },
      { id: "handle-every-stone", label: "Change handle after every stone." },
      { id: "no-broom", label: "Slide with the stone and without a broom." },
    ],
    participation: {
      supportedModes: ["solo", "team"],
      minTrainingAthletes: 1,
      maxTrainingAthletes: null,
      roles: [{ role: "delivering-athlete", requirement: "required" }],
      summary: "Solo or in a Team. One athlete delivers at a time.",
    },
    sweeping: {
      policy: "forbidden",
      allowedSweeperCounts: [0],
      recommendedSweeperCount: 0,
      note: "No sweeping. The exercise uses the delivered weight and line without sweeping adjustment.",
    },
    equipment: [
      { id: "stones", label: "Curling stones", requirement: "required" },
      { id: "target-stone", label: "One target stone", requirement: "required" },
      {
        id: "broom",
        label: "Delivery broom or stabiliser",
        requirement: "optional",
        note: "One of the curated variations slides without a broom.",
      },
    ],
    compatibleMeasurementProtocols: [{
      protocolId: ROTATION_COUNT_PROTOCOL_ID,
      protocolVersion: 1,
      requirement: "optional",
    }],
    diagram: buildRestrictedSwissCurlingDiagram({
      id: "soft-takeout-centre-line-t-line-source-diagram-v1",
      assetId: SWISS_CURLING_SOFTSHOT_5_ASSET_ID,
      caption: "Softshot Exercise 5 — original Swiss Curling diagram.",
      accessibleSummary:
        "A top-down house with a target stone on the centre line at the T-line, a curved soft take-out path into it, and a marked target zone behind the house where the target stone should finish.",
      sourceExerciseReference: "Softshot Exercise 5, page 37",
      localizedTextOverlays: [{
        id: "target-zone",
        x: 0.70,
        y: 0.112,
        width: 0.255,
        height: 0.036,
        text: "Target zone",
        backgroundColor: "#b7e3f4",
        textColor: "#000000",
        fontSize: 0.035,
      }],
    }),
    source: {
      kind: "external-collection",
      attribution:
        "Adapted by this application from Swiss Curling's Individual On-Ice Training – Exercise Collection, version 2.0.",
      organization: "Swiss Curling",
      collectionName: "Individual On-Ice Training – Exercise Collection",
      collectionVersion: "2.0",
      sourceExerciseReference: "Softshot Exercise 5",
      sourcePage: 37,
      provenanceNote:
        "English exercise copy and application presentation are platform-authored. The attributed source diagram is reproduced for the configured one-Team closed beta with its embedded German label covered by a faithful English overlay.",
      nonDisplayedSourceMetadata: {
        originalTitles: [
          "Softshot Übung 5: Soft-Takeout auf Centerline T-Line",
        ],
        searchAliases: ["Softshot Übung 5", "Soft-Takeout", "Soft Take-out"],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Exported unfrozen so tests can verify the builders are deterministic; product code uses the frozen catalog. */
export function buildCuratedExercises(): Exercise[] {
  return [
    { id: RELEASE_POINT_EXERCISE_ID, currentVersionId: RELEASE_POINT_VERSION_ID },
    {
      id: EIGHT_GUARDS_EXERCISE_ID,
      currentVersionId: EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
    },
    { id: RELEASE_TIME_EXERCISE_ID, currentVersionId: RELEASE_TIME_VERSION_ID },
    { id: RELEASE_GATES_EXERCISE_ID, currentVersionId: RELEASE_GATES_VERSION_ID },
    { id: ROTATION_COUNT_EXERCISE_ID, currentVersionId: ROTATION_COUNT_VERSION_ID },
    { id: COME_AROUND_EXERCISE_ID, currentVersionId: COME_AROUND_VERSION_ID },
    { id: SOFT_TAKEOUT_EXERCISE_ID, currentVersionId: SOFT_TAKEOUT_VERSION_ID },
  ];
}

export function buildCuratedExerciseVersions(): ExerciseVersion[] {
  return [
    buildReleasePointVersion(),
    buildEightGuardsVersion1(),
    buildEightGuardsVersion2(),
    buildEightGuardsVersion3(),
    buildReleaseTimeVersion(),
    buildReleaseGatesVersion(),
    buildRotationCountVersion(),
    buildComeAroundVersion(),
    buildSoftTakeoutVersion(),
  ];
}
