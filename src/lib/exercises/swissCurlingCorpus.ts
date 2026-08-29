import { buildPublicSwissCurlingDiagram } from "./diagrams";
import {
  RELEASE_TIME_BACK_HOG_PROTOCOL_ID,
  ROTATION_COUNT_PROTOCOL_ID,
} from "./measurementProtocols";
import { swissCurlingExerciseAssetId } from "./restrictedAssetCatalog";
import {
  EXERCISE_CONTENT_SCHEMA_VERSION,
  type Exercise,
  type ExerciseDifficulty,
  type ExerciseDiagram,
  type ExerciseScoreScaleEntry,
  type ExerciseShotFamily,
  type ExerciseTrainingPurpose,
  type ExerciseVersion,
} from "./types";

type SourceFamily = "guard" | "draw" | "softshot";

type CorpusDefinition = {
  id: string;
  family: SourceFamily;
  number: number;
  page: number;
  originalTitle: string;
  title: string;
  focus?: "shotmaking" | "measured";
  shotFamily: ExerciseShotFamily;
  difficulty: ExerciseDifficulty;
  primaryPurpose: ExerciseTrainingPurpose;
  additionalPurposes: readonly ExerciseTrainingPurpose[];
  goal: string;
  whyItMatters: string;
  setup: readonly string[];
  execution: readonly string[];
  sourceGoal: string;
  stones: number;
  variations: readonly string[];
  diagramSummary: string;
  overlays?: Extract<
    ExerciseDiagram,
    { kind: "attributed-source-image" }
  >["localizedTextOverlays"];
  sourceNote?: string;
};

const CURLING_SCORE_SCALE: readonly ExerciseScoreScaleEntry[] = [
  { score: 0, percentage: 0 },
  { score: 1, percentage: 25 },
  { score: 2, percentage: 50 },
  { score: 3, percentage: 75 },
  { score: 4, percentage: 100 },
];

const COMMON_HANDLE_VARIATIONS = [
  "Use the same handle for every stone.",
  "Change handle after every two stones.",
  "Change handle after every stone.",
  "Slide with the stone and without a broom.",
] as const;

const SOFTSHOT_VARIATIONS = [
  "Change handle after two stones.",
  "Change handle after every stone.",
  "Slide with the stone and without a broom.",
] as const;

function overlay(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  backgroundColor = "#a6ddef",
  fontSize = 0.03
) {
  return {
    id,
    x,
    y,
    width,
    height,
    text,
    backgroundColor,
    textColor: "#000000",
    fontSize,
  };
}

const TARGET_BOTTOM_RIGHT = [
  overlay("target-zone", 0.72, 0.925, 0.25, 0.045, "Target zone"),
];
const TARGET_TOP_RIGHT_SOFT = [
  overlay("target-zone", 0.67, 0.075, 0.28, 0.04, "Target zone", "#a6ddef", 0.026),
];

const DEFINITIONS: readonly CorpusDefinition[] = [
  {
    id: "guards-in-front-of-house",
    family: "guard", number: 1, page: 8,
    originalTitle: "Übung 1: Draws vors Haus",
    title: "Guards in Front of the House",
    shotFamily: "guard",
    difficulty: { kind: "level", level: 1 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Place as many stones as possible in play between the hog line and the house, without biting the house.",
    whyItMatters: "A controlled centre guard gives the team a usable stone in front of the house without accidentally drawing into it.",
    setup: ["One athlete has eight stones and no sweepers.", "Use the full area between the hog line and the front of the house as the target zone."],
    execution: ["Play four in-turns and then four out-turns toward the centre.", "Judge and remove each stone after it stops."],
    sourceGoal: "8 of 8 stones in play in front of the house, with no biter.",
    stones: 8,
    variations: [...COMMON_HANDLE_VARIATIONS, "Play away from the centre line."],
    diagramSummary: "A top-down sheet with three example centre guards in the blue target zone between the hog line and the house.",
    overlays: TARGET_BOTTOM_RIGHT,
  },
  {
    id: "guards-in-mixed-doubles-position",
    family: "guard", number: 2, page: 9,
    originalTitle: "Übung 2: Draws ins MD-Feld",
    title: "Guards into the Mixed Doubles Position",
    shotFamily: "guard",
    difficulty: { kind: "level", level: 2 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Place as many stones as possible fully inside the Mixed Doubles positioning zone.",
    whyItMatters: "The narrow positioning zone demands controlled guard weight and a repeatable centre-line delivery.",
    setup: ["Mark the Mixed Doubles positioning zone with the six reference points shown.", "One athlete has eight stones and no sweepers."],
    execution: ["Play four in-turns and then four out-turns toward the centre.", "Judge and remove each stone after it stops."],
    sourceGoal: "8 of 8 stones fully inside the Mixed Doubles positioning zone.",
    stones: 8,
    variations: [...COMMON_HANDLE_VARIATIONS, "Play away from the centre line."],
    diagramSummary: "The Mixed Doubles positioning rectangle is highlighted below the house, with three example stones fully inside it.",
    overlays: [overlay("target-zone", 0.68, 0.59, 0.28, 0.045, "Target zone")],
  },
  {
    id: "guards-in-left-mixed-doubles-zone",
    family: "guard", number: 3, page: 10,
    originalTitle: "Übung 3: Draws ins linke MD-Feld",
    title: "Guards into the Left Mixed Doubles Zone",
    shotFamily: "guard",
    difficulty: { kind: "level", level: 3 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Place as many stones as possible fully inside the left Mixed Doubles target zone.",
    whyItMatters: "Hitting one side of the positioning area combines guard weight with deliberate lateral placement.",
    setup: ["Mark the left Mixed Doubles rectangle shown in the diagram.", "One athlete has eight stones and no sweepers."],
    execution: ["Play four in-turns and then four out-turns.", "Judge and remove each stone after it stops."],
    sourceGoal: "6 of 8 stones fully inside the left Mixed Doubles target zone.",
    stones: 8,
    variations: COMMON_HANDLE_VARIATIONS,
    diagramSummary: "A blue Mixed Doubles target rectangle sits to the left of the centre line below the house.",
    overlays: [overlay("target-zone", 0.70, 0.59, 0.27, 0.045, "Target zone")],
  },
  {
    id: "guards-in-right-mixed-doubles-zone",
    family: "guard", number: 4, page: 11,
    originalTitle: "Guard Übung 4: Draws ins rechte MD-Feld",
    title: "Guards into the Right Mixed Doubles Zone",
    shotFamily: "guard",
    difficulty: { kind: "level", level: 3 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Place as many stones as possible fully inside the right Mixed Doubles target zone.",
    whyItMatters: "Hitting one side of the positioning area combines guard weight with deliberate lateral placement.",
    setup: ["Mark the right Mixed Doubles rectangle shown in the diagram.", "One athlete has eight stones and no sweepers."],
    execution: ["Play four in-turns and then four out-turns.", "Judge and remove each stone after it stops."],
    sourceGoal: "6 of 8 stones fully inside the right Mixed Doubles target zone.",
    stones: 8,
    variations: COMMON_HANDLE_VARIATIONS,
    diagramSummary: "A blue Mixed Doubles target rectangle sits to the right of the centre line below the house.",
    overlays: [overlay("target-zone", 0.70, 0.59, 0.27, 0.045, "Target zone")],
  },
  {
    id: "guard-before-then-beyond-mixed-doubles-zone",
    family: "guard", number: 5, page: 12,
    originalTitle: "Guard Übung 5: 1. Stein vor MD-Feld, 2. Stein nach MD-Feld",
    title: "Guard Before, Then Beyond the Mixed Doubles Zone",
    shotFamily: "sequence",
    difficulty: { kind: "level", level: 4 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["progressive-distance-control", "line-control"],
    goal: "Alternate between a guard before the Mixed Doubles zone and a guard beyond it but still in front of the house.",
    whyItMatters: "Two clearly separated guard depths train deliberate weight changes while keeping the same general line.",
    setup: ["Mark the two target zones shown in the diagram.", "One athlete has eight stones and no sweepers."],
    execution: ["Stone 1 goes in the zone before the Mixed Doubles position.", "Stone 2 goes beyond that position and remains in front of the house.", "Repeat the two-stone sequence and judge each stone after it stops."],
    sourceGoal: "6 of 8 stones in their assigned target zones.",
    stones: 8,
    variations: COMMON_HANDLE_VARIATIONS,
    diagramSummary: "Two blue centre-line guard zones are numbered: stone 1 before the Mixed Doubles zone and stone 2 beyond it.",
    overlays: [
      overlay("near-zone", 0.67, 0.58, 0.30, 0.045, "Target zone 2"),
      overlay("far-zone", 0.67, 0.90, 0.30, 0.045, "Target zone 1"),
    ],
    sourceNote: "The source scoring line accidentally names the right Mixed Doubles field; the diagram and goal clearly define two depth zones.",
  },
  {
    id: "guard-beyond-then-before-mixed-doubles-zone",
    family: "guard", number: 6, page: 13,
    originalTitle: "Guard Übung 6: 1. Stein nach MD-Feld, 2. Stein vor MD-Feld",
    title: "Guard Beyond, Then Before the Mixed Doubles Zone",
    shotFamily: "sequence",
    difficulty: { kind: "range", min: 3, max: 4 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["progressive-distance-control", "line-control"],
    goal: "Alternate between a guard beyond the Mixed Doubles zone and a shorter guard before it.",
    whyItMatters: "Moving from the longer guard back to the shorter one trains an intentional reduction in weight.",
    setup: ["Mark the two target zones shown in the diagram.", "One athlete has eight stones and no sweepers."],
    execution: ["Stone 1 goes beyond the Mixed Doubles position and remains in front of the house.", "Stone 2 goes in the zone before the Mixed Doubles position.", "Repeat the two-stone sequence and judge each stone after it stops."],
    sourceGoal: "6 of 8 stones in their assigned target zones.",
    stones: 8,
    variations: COMMON_HANDLE_VARIATIONS,
    diagramSummary: "Two blue centre-line guard zones are numbered: stone 1 beyond the Mixed Doubles zone and stone 2 before it.",
    overlays: [
      overlay("near-zone", 0.67, 0.58, 0.30, 0.045, "Target zone 1"),
      overlay("far-zone", 0.67, 0.90, 0.30, 0.045, "Target zone 2"),
    ],
    sourceNote: "The source index labels this Level 4 while the exercise page footer labels it Level 3; the catalog preserves that conflict as a Level 3–4 range.",
  },
  {
    id: "matching-depth-corner-guards",
    family: "guard", number: 7, page: 14,
    originalTitle: "Guard Übung 7: Cornerguards gleiche Höhe",
    title: "Matching-Depth Corner Guards",
    shotFamily: "guard",
    difficulty: { kind: "range", min: 4, max: 5 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["repeatability", "line-control"],
    goal: "Place two corner guards on opposite sides at matching depth, within one broom length.",
    whyItMatters: "Matching depth on different lines tests whether guard weight can be reproduced when the handle and side change.",
    setup: ["One athlete has eight stones and no sweepers.", "Use one broom length as the source collection's depth reference."],
    execution: ["Alternate in-turn and out-turn.", "Play a corner guard on one side, then match its depth on the other side.", "Judge and remove each pair after both stones stop."],
    sourceGoal: "6 of 8 stones at the intended matching depth.",
    stones: 8,
    variations: ["Slide with the stone and without a broom."],
    diagramSummary: "Two numbered corner guards sit on opposite sides of the centre line at the same depth.",
    sourceNote: "The source index labels this Level 5 while the exercise page footer labels it Level 4; the catalog preserves that conflict as a Level 4–5 range.",
  },
  {
    id: "short-then-long-corner-guard",
    family: "guard", number: 8, page: 15,
    originalTitle: "Guard Übung 8: Kurze Cornerguard, lange Cornerguard",
    title: "Short, Then Long Corner Guard",
    shotFamily: "sequence",
    difficulty: { kind: "level", level: 5 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["progressive-distance-control", "line-control"],
    goal: "Play a short corner guard, then a longer corner guard whose line overlaps the first.",
    whyItMatters: "The pair combines a deliberate depth change with a consistent corner-guard line.",
    setup: ["One athlete has eight stones and no sweepers.", "Plan two pairs on the left and two pairs on the right."],
    execution: ["Play stone 1 as a short corner guard close to the house.", "Play stone 2 as the longer corner guard on an overlapping line.", "Judge and remove each pair after both stones stop."],
    sourceGoal: "6 of 8 stones at the intended length and line.",
    stones: 8,
    variations: ["Slide with the stone and without a broom."],
    diagramSummary: "A short corner guard numbered 1 is followed by a longer guard numbered 2 on the same side and overlapping line.",
  },
  {
    id: "long-then-short-corner-guard",
    family: "guard", number: 9, page: 16,
    originalTitle: "Guard Übung 9: Lange Cornerguard, kurze Cornerguard",
    title: "Long, Then Short Corner Guard",
    shotFamily: "sequence",
    difficulty: { kind: "level", level: 5 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["progressive-distance-control", "line-control"],
    goal: "Play a long corner guard, then a shorter corner guard whose line overlaps the first.",
    whyItMatters: "The pair trains a controlled reduction in guard weight without losing the intended line.",
    setup: ["One athlete has eight stones and no sweepers.", "Plan two pairs on the left and two pairs on the right."],
    execution: ["Play stone 1 as the longer corner guard.", "Play stone 2 as the shorter corner guard close to the house on an overlapping line.", "Judge and remove each pair after both stones stop."],
    sourceGoal: "6 of 8 stones at the intended length and line.",
    stones: 8,
    variations: ["Slide with the stone and without a broom."],
    diagramSummary: "A long corner guard numbered 1 is followed by a shorter guard numbered 2 on the same side and overlapping line.",
  },
  {
    id: "eight-guards-progressively-shorter",
    family: "guard", number: 11, page: 18,
    originalTitle: "Guard Übung 11: 8 Steine Guard, immer kürzer",
    title: "Eight Guards, Progressively Shorter",
    shotFamily: "guard",
    difficulty: { kind: "level", level: 6 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["progressive-distance-control", "line-control"],
    goal: "Play eight guards in front of the house, with each stone finishing shorter than the previous one.",
    whyItMatters: "Reducing the weight a little on every shot trains deliberate control across the full guard zone.",
    setup: ["One athlete has eight stones and no sweepers."],
    execution: ["Play the first stone just in front of the house.", "The next target zone lies between the previous stone's depth and the hog line.", "After each stone stops, move it aside at the same depth to mark the next boundary."],
    sourceGoal: "6 of 8 stones at the correct progressively shorter length.",
    stones: 8,
    variations: COMMON_HANDLE_VARIATIONS,
    diagramSummary: "Eight numbered guards progress from the house toward the hog line, with a side marker showing each previous depth.",
    overlays: [overlay("move-aside", 0.22, 0.58, 0.42, 0.12, "After each stone stops,\nmove it aside as a marker.", "#ffffff", 0.026)],
  },
  {
    id: "draws-into-house-outside-in",
    family: "draw", number: 1, page: 20,
    originalTitle: "Übung 1: Draws ins Haus von aussen nach innen",
    title: "Draws into the House, Outside to Inside",
    shotFamily: "draw",
    difficulty: { kind: "level", level: 1 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Place as many outside-to-inside draws as possible in the house.",
    whyItMatters: "A full-house target keeps the first draw exercise simple while both weight and curling path are practised.",
    setup: ["One athlete has eight stones and no sweepers.", "Use the whole house, including a biter, as the target."],
    execution: ["Play four in-turns and then four out-turns from outside toward the centre.", "Judge and remove each stone after it stops."],
    sourceGoal: "8 of 8 stones in the house, including biters.",
    stones: 8,
    variations: COMMON_HANDLE_VARIATIONS,
    diagramSummary: "The whole house is highlighted as the target, with an example outside-to-inside draw.",
    overlays: [overlay("target-zone", 0.42, 0.31, 0.27, 0.045, "Target zone")],
  },
  {
    id: "draws-into-house-inside-out",
    family: "draw", number: 2, page: 21,
    originalTitle: "Übung 2: Draws ins Haus von innen nach aussen",
    title: "Draws into the House, Inside to Outside",
    shotFamily: "draw",
    difficulty: { kind: "level", level: 1 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Place as many inside-to-outside draws as possible in the house.",
    whyItMatters: "The broad target introduces the opposite draw path without adding a narrow finishing zone.",
    setup: ["One athlete has eight stones and no sweepers.", "Use the whole house, including a biter, as the target."],
    execution: ["Play four in-turns and then four out-turns from inside toward the outside.", "Judge and remove each stone after it stops."],
    sourceGoal: "8 of 8 stones in the house, including biters.",
    stones: 8,
    variations: COMMON_HANDLE_VARIATIONS,
    diagramSummary: "The whole house is highlighted as the target, with an example inside-to-outside draw.",
    overlays: [overlay("target-zone", 0.72, 0.31, 0.25, 0.045, "Target zone")],
  },
  {
    id: "draws-before-t-line-outside-in",
    family: "draw", number: 3, page: 22,
    originalTitle: "Übung 3: Draws vor die T-Line von aussen nach innen",
    title: "Draws Before the T-Line, Outside to Inside",
    shotFamily: "draw",
    difficulty: { kind: "level", level: 2 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Place outside-to-inside draws in the front half of the house, from a front-twelve-foot biter to the T-line.",
    whyItMatters: "A front-half target adds depth control while keeping the stone useful in front of the T-line.",
    setup: ["One athlete has eight stones and no sweepers.", "Use the front half of the house as the target zone."],
    execution: ["Play four in-turns and then four out-turns toward the centre.", "Judge and remove each stone after it stops."],
    sourceGoal: "6 of 8 stones in the house before the T-line.",
    stones: 8,
    variations: COMMON_HANDLE_VARIATIONS,
    diagramSummary: "The front half of the house is highlighted, with an example outside-to-inside draw.",
    overlays: [overlay("target-zone", 0.42, 0.31, 0.27, 0.045, "Target zone")],
  },
  {
    id: "draws-before-t-line-inside-out",
    family: "draw", number: 4, page: 23,
    originalTitle: "Übung 4: Draws vor die T-Line von innen nach aussen",
    title: "Draws Before the T-Line, Inside to Outside",
    shotFamily: "draw",
    difficulty: { kind: "level", level: 2 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Place inside-to-outside draws in the front half of the house, from a front-twelve-foot biter to the T-line.",
    whyItMatters: "The front-half target combines controlled draw weight with the opposite curling path.",
    setup: ["One athlete has eight stones and no sweepers.", "Use the front half of the house as the target zone."],
    execution: ["Play four in-turns and then four out-turns toward the outside.", "Judge and remove each stone after it stops."],
    sourceGoal: "6 of 8 stones in the house before the T-line.",
    stones: 8,
    variations: COMMON_HANDLE_VARIATIONS,
    diagramSummary: "The front half of the house is highlighted, with an example inside-to-outside draw.",
    overlays: [overlay("target-zone", 0.01, 0.31, 0.28, 0.045, "Target zone")],
  },
  {
    id: "four-stones-in-each-house-quarter",
    family: "draw", number: 5, page: 24,
    originalTitle: "Übung 5: Draws je 4 Stein in ein Haus-Viertel",
    title: "Four Stones in Each House Quarter",
    shotFamily: "draw",
    difficulty: { kind: "level", level: 3 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Place four stones in each quarter of the house.",
    whyItMatters: "Changing both depth and side develops deliberate placement across the full house.",
    setup: ["Divide the house into four quarters as shown.", "One athlete has sixteen stones and no sweepers."],
    execution: ["Play two in-turns and then two out-turns at a time.", "Target the two front quarters first, then the two back quarters.", "Judge and remove each stone after it stops."],
    sourceGoal: "12 of 16 stones in their assigned house quarters.",
    stones: 16,
    variations: ["Play eight stones with one handle, then eight with the other.", "Change handle after four stones.", "Change handle after every stone.", "Start with the back quarters.", "Play four consecutive stones into the same quarter.", "Slide with the stone and without a broom."],
    diagramSummary: "The house is divided into four numbered target quarters.",
    overlays: [
      overlay("q2", 0.10, 0.015, 0.28, 0.04, "House quarter 2", "#f7e2a2", 0.026),
      overlay("q4", 0.62, 0.015, 0.28, 0.04, "House quarter 4", "#f7e2a2", 0.026),
      overlay("q1", 0.10, 0.43, 0.28, 0.04, "House quarter 1", "#f7e2a2", 0.026),
      overlay("q3", 0.62, 0.43, 0.28, 0.04, "House quarter 3", "#f7e2a2", 0.026),
    ],
    sourceNote: "The source diagram repeats 'House quarter 4' in the lower-right label; the numbered sequence identifies that quarter as number 3.",
  },
  {
    id: "come-around-inside-out-before-t-line",
    family: "draw", number: 7, page: 26,
    originalTitle: "Übung 7: Comearound von innen nach aussen, vor T-Line",
    title: "Come-around from Inside to Outside, Before the T-Line",
    shotFamily: "draw",
    difficulty: { kind: "level", level: 3 },
    primaryPurpose: "line-control",
    additionalPurposes: ["weight-control", "handle-control"],
    goal: "Play inside-to-outside come-arounds that finish in the house before the T-line and at least half hidden behind the guard.",
    whyItMatters: "The shot combines a guard-clearing path with draw weight and a useful finish in the front of the house.",
    setup: ["Place one guard as shown.", "One athlete has eight stones and no sweepers."],
    execution: ["Play four in-turns and then four out-turns from inside toward the outside.", "Judge and remove each delivered stone after it stops; reset the guard if needed."],
    sourceGoal: "6 of 8 stones in the house before the T-line and at least half hidden.",
    stones: 8,
    variations: COMMON_HANDLE_VARIATIONS,
    diagramSummary: "A guard protects the outside edge of a blue front-house target zone, with a curved come-around path behind it.",
  },
  {
    id: "draw-then-freeze-outside-in",
    family: "draw", number: 8, page: 27,
    originalTitle: "Übung 8: 1. Draw ins Haus von aussen nach innen, 2. Stein Freeze",
    title: "Outside-to-Inside Draw, Then Freeze",
    shotFamily: "freeze",
    difficulty: { kind: "level", level: 3 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Draw into the house, then freeze a second stone in front of it without a bounce.",
    whyItMatters: "The paired shots combine draw placement with the fine weight control needed to finish close to another stone.",
    setup: ["One athlete has eight stones and no sweepers.", "Use the whole house as the first-stone target."],
    execution: ["Stone 1 is an outside-to-inside draw into the house.", "Stone 2 freezes in front of stone 1, no more than one broom length away and without a bounce.", "Judge and remove each pair after the second stone stops."],
    sourceGoal: "6 of 8 stones achieve their assigned draw or freeze outcome.",
    stones: 8,
    variations: ["Use the same handle for all eight stones.", "Change handle after stone 1.", "Change handle after every stone.", "Slide with the stone and without a broom."],
    diagramSummary: "Stone 1 sits in the house and stone 2 freezes immediately in front, with a one-broom-length maximum gap marked.",
    overlays: [overlay("distance", 0.63, 0.57, 0.32, 0.13, "Maximum gap:\none broom length", "#ffffff", 0.025)],
  },
  {
    id: "draw-then-freeze-inside-out",
    family: "draw", number: 9, page: 28,
    originalTitle: "Übung 9: 1. Draw ins Haus von aussen nach innen, 2. Stein Freeze",
    title: "Inside-to-Outside Draw, Then Freeze",
    shotFamily: "freeze",
    difficulty: { kind: "level", level: 3 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Draw inside-to-outside into the house, then freeze a second stone in front of it without a bounce.",
    whyItMatters: "The paired shots train fine weight control on the opposite curling path.",
    setup: ["One athlete has eight stones and no sweepers.", "Use the whole house as the first-stone target."],
    execution: ["Stone 1 is an inside-to-outside draw into the house.", "Stone 2 freezes in front of stone 1, no more than one broom length away and without a bounce.", "Judge and remove each pair after the second stone stops."],
    sourceGoal: "6 of 8 stones achieve their assigned draw or freeze outcome.",
    stones: 8,
    variations: ["Use the same handle for all eight stones.", "Change handle after stone 1.", "Change handle after every stone.", "Slide with the stone and without a broom."],
    diagramSummary: "Stone 1 sits in the house and stone 2 freezes immediately in front on an inside-to-outside path, with a one-broom-length maximum gap marked.",
    overlays: [overlay("distance", 0.63, 0.57, 0.32, 0.13, "Maximum gap:\none broom length", "#ffffff", 0.025)],
    sourceNote: "The page contains a duplicated text block from Draw Exercise 7; the second block and diagram define this inside-to-outside freeze exercise.",
  },
  {
    id: "draw-split-time",
    family: "draw", number: 10, page: 29,
    originalTitle: "Übung 10: Draw-Split-Time",
    title: "Draw Split Time",
    focus: "measured",
    shotFamily: "draw",
    difficulty: { kind: "range", min: 3, max: 5 },
    primaryPurpose: "repeatability",
    additionalPurposes: ["weight-control-awareness"],
    goal: "Play eight house-weight draws with the same chosen backline-to-hog target time.",
    whyItMatters: "Repeating one measured split time gives direct feedback on how consistently the intended delivery speed was reproduced.",
    setup: ["Choose one backline-to-hog target time in Timing Setup; Fixed Weight matches the standard exercise.", "Use one consistent manual timing method. A second person may operate the stopwatch."],
    execution: ["Play eight stones with the same handle, outside to inside.", "Record each measured split time against the same chosen target."],
    sourceGoal: "6 of 8 stones within 0.10 seconds of the chosen target time.",
    stones: 8,
    variations: ["Change the target time.", "Use a smaller tolerance as a personal variation.", "Play inside to outside.", "Slide with the stone and without a broom."],
    diagramSummary: "A house-weight draw is shown above an English note to play eight consecutive stones at the same target split time.",
    overlays: [overlay("timing-note", 0.12, 0.43, 0.76, 0.09, "Play 8 consecutive stones\nwith the same target split time.", "#ffffff", 0.025)],
  },
  {
    id: "draw-split-time-ladder",
    family: "draw", number: 11, page: 30,
    originalTitle: "Übung 11: Draw-Split-Leiter",
    title: "Draw Split-Time Ladder",
    focus: "measured",
    shotFamily: "draw",
    difficulty: { kind: "range", min: 4, max: 6 },
    primaryPurpose: "weight-control-awareness",
    additionalPurposes: ["repeatability", "progressive-distance-control"],
    goal: "Play eight draws against a new backline-to-hog target time for every stone.",
    whyItMatters: "A measured ladder trains intentional speed changes while preserving the actual target that applied to every shot.",
    setup: ["Choose Variable Weight with Coach / Manual in Timing Setup.", "Enter this source ladder one target at a time: 3.6, 3.7, 3.8, 3.9, 3.9, 3.8, 3.7 and 3.6 seconds.", "Use one consistent manual timing method. A second person may operate the stopwatch."],
    execution: ["Play eight stones with the same handle, outside to inside.", "Before every stone, enter the next ladder target; then record the measured split time."],
    sourceGoal: "6 of 8 stones within 0.10 seconds of their assigned target time.",
    stones: 8,
    variations: ["Reverse the ladder by starting at 3.9 seconds.", "Change the ladder endpoints.", "Use a smaller tolerance as a personal variation.", "Play inside to outside.", "Slide with the stone and without a broom."],
    diagramSummary: "A draw is shown above the eight-step target-time ladder: 3.6, 3.7, 3.8, 3.9, 3.9, 3.8, 3.7 and 3.6 seconds.",
    overlays: [overlay("ladder", 0.11, 0.42, 0.78, 0.24, "Target split-time ladder\n1  3.6s     5  3.9s\n2  3.7s     6  3.8s\n3  3.8s     7  3.7s\n4  3.9s     8  3.6s", "#ffffff", 0.023)],
  },
  {
    id: "guard-come-around-freeze-tap-sequence",
    family: "draw", number: 12, page: 31,
    originalTitle: "Übung 12: Guard, Comearound vor T-Line, Freeze",
    title: "Guard, Come-around, Freeze and Tap",
    shotFamily: "sequence",
    difficulty: { kind: "level", level: 6 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Play a four-stone sequence: guard, come-around before the T-line, freeze and tap to back-eight-foot or back-twelve-foot depth.",
    whyItMatters: "The sequence links four distinct weights and outcomes without resetting the developing situation.",
    setup: ["One athlete has eight stones and no sweepers.", "Each set uses four stones; clear the setup after stone 4."],
    execution: ["Stone 1: play a guard in front of the house.", "Stone 2: come around into the house before the T-line.", "Stone 3: freeze to stone 2.", "Stone 4: tap stone 3 to back-eight-foot or back-twelve-foot depth."],
    sourceGoal: "6 of 8 stones achieve their assigned outcome in the two four-stone sequences.",
    stones: 8,
    variations: ["Change handle after every stone.", "Slide with the stone and without a broom."],
    diagramSummary: "Four numbered stones and arrows show the guard, come-around, freeze and tap sequence.",
    overlays: [
      overlay("stone-1", 0.02, 0.66, 0.34, 0.045, "Stone 1: Guard", "#ffffff", 0.024),
      overlay("stone-2", 0.02, 0.21, 0.34, 0.045, "Stone 2: Come-around", "#ffffff", 0.022),
      overlay("stone-3", 0.02, 0.28, 0.34, 0.045, "Stone 3: Freeze", "#ffffff", 0.024),
      overlay("stone-4", 0.02, 0.36, 0.34, 0.08, "Stone 4: Tap to\nback 8/12-foot", "#ffffff", 0.022),
    ],
  },
  {
    id: "long-draws-outside-in",
    family: "softshot", number: 1, page: 33,
    originalTitle: "Übung 1: Lange Draws von aussen nach innen",
    title: "Long Draws, Outside to Inside",
    shotFamily: "draw",
    difficulty: { kind: "range", min: 1, max: 2 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Play outside-to-inside long draws into the zone from out-weight depth to the boards.",
    whyItMatters: "The long target zone develops control of weight beyond the house.",
    setup: ["One athlete has eight stones and no sweepers.", "Use the blue zone from out-weight depth to the boards."],
    execution: ["Play four in-turns and then four out-turns toward the centre.", "Judge and remove each stone after it stops."],
    sourceGoal: "6 of 8 stones in the long-draw target zone.",
    stones: 8,
    variations: [...COMMON_HANDLE_VARIATIONS, "Narrow the target to out-weight through hack depth.", "Narrow the target to hack through board depth."],
    diagramSummary: "A blue long-draw target zone extends beyond the house toward the boards, with two smaller optional zones.",
    overlays: [
      overlay("target", 0.31, 0.01, 0.38, 0.055, "Target zone", "#a6ddef", 0.027),
      overlay("alt-2", 0.70, 0.01, 0.29, 0.10, "Alternative 2\nHack–Board", "#e8e8f2", 0.022),
      overlay("alt-1", 0.70, 0.12, 0.29, 0.10, "Alternative 1\nOut–Hack", "#f7eee7", 0.022),
    ],
  },
  {
    id: "long-draws-inside-out",
    family: "softshot", number: 2, page: 34,
    originalTitle: "Übung 2: Lange Draws von innen nach aussen",
    title: "Long Draws, Inside to Outside",
    shotFamily: "draw",
    difficulty: { kind: "range", min: 1, max: 2 },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: "Play inside-to-outside long draws into the zone from out-weight depth to the boards.",
    whyItMatters: "The long target zone develops control of weight beyond the house on the opposite curling path.",
    setup: ["One athlete has eight stones and no sweepers.", "Use the blue zone from out-weight depth to the boards."],
    execution: ["Play four in-turns and then four out-turns toward the outside.", "Judge and remove each stone after it stops."],
    sourceGoal: "6 of 8 stones in the long-draw target zone.",
    stones: 8,
    variations: [...COMMON_HANDLE_VARIATIONS, "Narrow the target to out-weight through hack depth.", "Narrow the target to hack through board depth."],
    diagramSummary: "A blue long-draw target zone extends beyond the house toward the boards, with two smaller optional zones.",
    overlays: [
      overlay("target", 0.70, 0.01, 0.29, 0.055, "Target zone", "#a6ddef", 0.027),
      overlay("alt-2", 0.01, 0.01, 0.29, 0.10, "Alternative 2\nHack–Board", "#e8e8f2", 0.022),
      overlay("alt-1", 0.01, 0.12, 0.29, 0.10, "Alternative 1\nOut–Hack", "#f7eee7", 0.022),
    ],
  },
  ...([
    [3, 35, "soft-takeout-centre-line-back-12-foot", "Soft Take-out on the Centre Line at the Back 12-Foot", "Übung 3: Soft-Take-out auf Centerline hinten 12-Fuss", 2, "back twelve-foot"],
    [4, 36, "soft-takeout-centre-line-back-8-foot", "Soft Take-out on the Centre Line at the Back 8-Foot", "Übung 4: Soft-Take-out auf Centerline hinten 8-Fuss", 3, "back eight-foot"],
    [6, 38, "soft-takeout-centre-line-front-8-foot", "Soft Take-out on the Centre Line at the Front 8-Foot", "Übung 6: Soft-Take-out auf Centerline vorne 8-Fuss", 5, "front eight-foot"],
    [7, 39, "soft-takeout-centre-line-front-12-foot", "Soft Take-out on the Centre Line at the Front 12-Foot", "Übung 7: Soft-Take-out auf Centerline vorne 12-Fuss", 6, "front twelve-foot"],
    [8, 40, "soft-takeout-eight-foot-width-back-12-foot", "Soft Take-out at 8-Foot Width, Back 12-Foot", "Übung 8: Soft-Take-out auf Höhe 8-Fuss hinten 12-Fuss", 2, "back twelve-foot at eight-foot width"],
    [9, 41, "soft-takeout-eight-foot-width-back-8-foot", "Soft Take-out at 8-Foot Width, Back 8-Foot", "Übung 9: Soft-Take-out auf Höhe 8-Fuss hinten 8-Fuss", 3, "back eight-foot at eight-foot width"],
    [10, 42, "soft-takeout-eight-foot-width-t-line", "Soft Take-out at 8-Foot Width on the T-Line", "Übung 10: Soft-Take-out auf Höhe 8-Fuss T-Line", 4, "T-line at eight-foot width"],
    [11, 43, "soft-takeout-eight-foot-width-front-8-foot", "Soft Take-out at 8-Foot Width, Front 8-Foot", "Übung 11: Soft-Take-out auf Höhe 8-Fuss vorne 8-Fuss", 5, "front eight-foot at eight-foot width"],
    [12, 44, "soft-takeout-eight-foot-width-front-12-foot", "Soft Take-out at 8-Foot Width, Front 12-Foot", "Übung 12: Soft-Take-out auf Höhe 8-Fuss hinten 12-Fuss", 6, "front twelve-foot at eight-foot width"],
  ] as const).map(([number, page, id, title, originalTitle, level, position]): CorpusDefinition => ({
    id,
    family: "softshot",
    number,
    page,
    originalTitle,
    title,
    shotFamily: "soft-take-out",
    difficulty: { kind: "level", level },
    primaryPurpose: "weight-control",
    additionalPurposes: ["line-control", "handle-control"],
    goal: `Move the target stone from the ${position} position into the marked zone with soft take-out weight.`,
    whyItMatters: "The exercise combines precise contact, line and controlled take-out weight so the target stone finishes in a useful area.",
    setup: [`Place one target stone at the ${position} position shown.`, "One athlete has four stones and no sweepers."],
    execution: ["Play four stones with the same handle.", "After every stone stops, judge the outcome, clear the stones and reset the target."],
    sourceGoal: "3 of 4 target stones finish in the marked zone.",
    stones: 4,
    variations: SOFTSHOT_VARIATIONS,
    diagramSummary: `A target stone at ${position} is struck with soft take-out weight and shown finishing in the blue zone beyond the house.`,
    overlays: TARGET_TOP_RIGHT_SOFT,
    ...(number === 12
      ? { sourceNote: "The source repeats the title 'back 12-foot' from Exercise 8, while the ordered Level 2–6 series and diagram place Exercise 12 at the front 12-foot position." }
      : {}),
  })),
  {
    id: "soft-shot-behind-centre-guard",
    family: "softshot", number: 13, page: 45,
    originalTitle: "Übung 13: Soft-Shot auf versteckte Steine hinter Centerguard",
    title: "Soft Shot Around a Centre Guard",
    shotFamily: "soft-take-out",
    difficulty: { kind: "range", min: 4, max: 6 },
    primaryPurpose: "line-control",
    additionalPurposes: ["weight-control", "handle-control"],
    goal: "Remove a partially hidden opposing shot from the house while keeping the shooter in the house.",
    whyItMatters: "The shot requires enough curl to reach a protected stone and controlled weight to keep the shooter in play.",
    setup: ["Place a centre guard, then place the opposing shot on the T-line only one-quarter visible.", "One athlete has four stones and no sweepers."],
    execution: ["Play four stones with the same handle.", "After every stone stops, judge the outcome, clear the stones and reset the setup."],
    sourceGoal: "3 of 4 attempts remove the opposing shot from the house while the shooter remains in the house.",
    stones: 4,
    variations: ["On straighter ice, leave the shot half visible.", "On highly curling ice, hide the shot completely.", "Slide with the stone and without a broom."],
    diagramSummary: "A centre guard protects a shot on the T-line; the curved soft-shot path removes it while the shooter remains in the house.",
  },
  {
    id: "soft-shot-behind-corner-guard",
    family: "softshot", number: 14, page: 46,
    originalTitle: "Übung 14: Soft-Shot auf versteckte Steine hinter Cornerguard",
    title: "Soft Shot Around a Corner Guard",
    shotFamily: "soft-take-out",
    difficulty: { kind: "range", min: 4, max: 6 },
    primaryPurpose: "line-control",
    additionalPurposes: ["weight-control", "handle-control"],
    goal: "Remove a partially hidden opposing shot from the house around a corner guard while keeping the shooter in the house.",
    whyItMatters: "The shot combines a guarded line with controlled take-out weight and shooter placement.",
    setup: ["Place a corner guard, then place the opposing shot on the T-line only one-quarter visible on the inside.", "One athlete has four stones and no sweepers."],
    execution: ["Play four inside-to-outside stones with the same handle.", "After every stone stops, judge the outcome, clear the stones and reset the setup."],
    sourceGoal: "3 of 4 attempts remove the opposing shot from the house while the shooter remains in the house.",
    stones: 4,
    variations: ["On straighter ice, leave the shot half visible.", "On highly curling ice, hide the shot completely.", "Leave the shot visible on the outside and play outside to inside.", "Slide with the stone and without a broom."],
    diagramSummary: "A corner guard protects a shot on the T-line; the curved soft-shot path removes it while the shooter remains in the house.",
  },
];

function instructionSteps(prefix: string, values: readonly string[]) {
  return values.map((text, index) => ({ id: `${prefix}-${index + 1}`, text }));
}

function sourceReference(definition: CorpusDefinition): string {
  const family = definition.family === "softshot"
    ? "Softshot"
    : definition.family[0].toUpperCase() + definition.family.slice(1);
  return `${family} Exercise ${definition.number}`;
}

function buildVersion(definition: CorpusDefinition): ExerciseVersion {
  const measured = definition.focus === "measured";
  const reference = sourceReference(definition);
  return {
    id: `${definition.id}-v1`,
    exerciseId: definition.id,
    version: 1,
    contentSchemaVersion: EXERCISE_CONTENT_SCHEMA_VERSION,
    contentLanguage: "en",
    title: definition.title,
    primaryFocus: measured ? "measured" : "shotmaking",
    shotFamily: definition.shotFamily,
    primaryTrainingPurpose: definition.primaryPurpose,
    additionalTrainingPurposes: definition.additionalPurposes,
    difficulty: definition.difficulty,
    goal: definition.goal,
    whyItMatters: definition.whyItMatters,
    setupInstructions: instructionSteps("setup", definition.setup),
    executionInstructions: instructionSteps("step", definition.execution),
    guidance: measured
      ? {
          kind: "observation",
          observations: [
            "Use Backline – Hog for every stone in this exercise.",
            "The source collection's tolerance is descriptive context, not an app-prescribed standard.",
            "Release time is a measurement and does not by itself explain technique or the final stone position.",
          ],
          noScoringNote:
            "The app records the measured time and target for each stone. It does not turn the source collection's reference goal into a pass/fail result.",
        }
      : {
          kind: "generic-shotmaking-score",
          scale: CURLING_SCORE_SCALE,
          explanation: [
            "Judge each stone on curling's 0 to 4 scale against this exercise's goal and the handle actually played.",
            "The team applies its own judgement — there is no platform-standardised rubric for this exercise.",
            "Because each team judges for itself, 0 to 4 values from different teams are not comparable with each other.",
          ],
          evaluationBasis: "team-defined-unstructured",
          evaluationBasisNote:
            "This is a team-defined judgement of the exercise goal, not a platform-standardised score.",
        },
    sourceReferenceGoal: {
      text: `The source collection suggests ${definition.sourceGoal} This is descriptive context only and is not evaluated by the app.`,
      evaluated: false,
    },
    recommendedVolume: {
      kind: "stone-count",
      stones: definition.stones,
    },
    variations: definition.variations.map((label, index) => ({
      id: `variation-${index + 1}`,
      label,
    })),
    participation: {
      supportedModes: ["solo", "team"],
      minTrainingAthletes: 1,
      maxTrainingAthletes: null,
      roles: [
        { role: "delivering-athlete", requirement: "required" },
        ...(measured
          ? [{
              role: "timekeeper" as const,
              requirement: "optional" as const,
              note: "A second person can take the time consistently.",
            }]
          : []),
      ],
      summary: measured
        ? "Solo or in a Team. A second person can take the time."
        : "Solo or in a Team. One athlete delivers at a time.",
    },
    sweeping: {
      policy: "forbidden",
      allowedSweeperCounts: [0],
      recommendedSweeperCount: 0,
      note: "No sweeping. The source exercise compares the delivered weight and line without sweeping adjustment.",
    },
    equipment: [
      { id: "stones", label: "Curling stones", requirement: "required" },
      ...(measured
        ? [{
            id: "timing",
            label: "A consistent way to take backline-to-hog time",
            requirement: "required" as const,
          }]
        : []),
    ],
    compatibleMeasurementProtocols: measured
      ? [{
          protocolId: RELEASE_TIME_BACK_HOG_PROTOCOL_ID,
          protocolVersion: 1,
          requirement: "required",
        }]
      : [{
          protocolId: ROTATION_COUNT_PROTOCOL_ID,
          protocolVersion: 1,
          requirement: "optional",
        }],
    diagram: buildPublicSwissCurlingDiagram({
      id: `${definition.id}-source-diagram-v1`,
      assetId: swissCurlingExerciseAssetId(definition.family, definition.number),
      caption: `${reference} — Swiss Curling diagram.`,
      accessibleSummary: definition.diagramSummary,
      sourceExerciseReference: reference,
      sourcePage: definition.page,
      localizedTextOverlays: definition.overlays,
    }),
    source: {
      kind: "external-collection",
      attribution:
        "Swiss Curling, Individual On-Ice Training – Exercise Collection, version 2.0.",
      organization: "Swiss Curling",
      collectionName: "Individual On-Ice Training – Exercise Collection",
      collectionVersion: "2.0",
      sourceExerciseReference: reference,
      sourcePage: definition.page,
      provenanceNote: [
        "English exercise copy and application presentation are adapted from the source collection.",
        definition.sourceNote,
      ].filter(Boolean).join(" "),
      nonDisplayedSourceMetadata: {
        originalTitles: [definition.originalTitle],
        searchAliases: [reference, definition.originalTitle],
      },
    },
  };
}

export const SWISS_CURLING_CORPUS_EXERCISE_IDS = DEFINITIONS.map(
  ({ id }) => id
);

export const SWISS_CURLING_CORPUS_VERSION_IDS = DEFINITIONS.map(
  ({ id }) => `${id}-v1`
);

export function buildSwissCurlingCorpusExercises(): Exercise[] {
  return DEFINITIONS.map(({ id }) => ({
    id,
    currentVersionId: `${id}-v1`,
  }));
}

export function buildSwissCurlingCorpusVersions(): ExerciseVersion[] {
  return DEFINITIONS.map(buildVersion);
}
