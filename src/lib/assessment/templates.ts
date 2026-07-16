// Official Assessment Templates. Immutable, versioned, deterministic — see
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md sections 3-9.
//
// Release Time Core Assessment v1 is the first (and, for Phase A, only)
// official template. Its exact shot sequence is specified in that document
// and must never be dynamically randomised or regenerated — every field
// below is a literal, hand-authored value, not derived from any random
// source.
import type { Handle } from "../../types";
import { validateAssessmentTemplate } from "./templateValidation";
import type {
  AssessmentBlockDefinition,
  AssessmentTemplate,
  PlannedAssessmentShot,
} from "./types";

const RELEASE_TIME_CORE_V1_ID = "release-time-core-assessment-v1";
const RELEASE_TIME_CORE_V1_MEASUREMENT_MODE = "back-hog" as const;
const RELEASE_TIME_CORE_V1_SHOT_TYPE = "draw" as const;

const TARGET_FAST = 3.5;
const TARGET_MEDIUM = 3.75;
const TARGET_SLOW = 4.0;

type ShotSpec = { targetTime: number; handle: Handle };

const WARMUP_SEQUENCE: ShotSpec[] = [
  { targetTime: TARGET_MEDIUM, handle: "in" },
  { targetTime: TARGET_MEDIUM, handle: "out" },
  { targetTime: TARGET_SLOW, handle: "in" },
  { targetTime: TARGET_SLOW, handle: "out" },
  { targetTime: TARGET_FAST, handle: "in" },
  { targetTime: TARGET_FAST, handle: "out" },
];

const BLOCK_1_MEDIUM_REPRODUCTION: ShotSpec[] = [
  { targetTime: TARGET_MEDIUM, handle: "in" },
  { targetTime: TARGET_MEDIUM, handle: "out" },
  { targetTime: TARGET_MEDIUM, handle: "in" },
  { targetTime: TARGET_MEDIUM, handle: "out" },
  { targetTime: TARGET_MEDIUM, handle: "in" },
  { targetTime: TARGET_MEDIUM, handle: "out" },
  { targetTime: TARGET_MEDIUM, handle: "in" },
  { targetTime: TARGET_MEDIUM, handle: "out" },
];

const BLOCK_2_SLOW_REPRODUCTION: ShotSpec[] = [
  { targetTime: TARGET_SLOW, handle: "out" },
  { targetTime: TARGET_SLOW, handle: "in" },
  { targetTime: TARGET_SLOW, handle: "out" },
  { targetTime: TARGET_SLOW, handle: "in" },
  { targetTime: TARGET_SLOW, handle: "out" },
  { targetTime: TARGET_SLOW, handle: "in" },
  { targetTime: TARGET_SLOW, handle: "out" },
  { targetTime: TARGET_SLOW, handle: "in" },
];

const BLOCK_3_FAST_REPRODUCTION: ShotSpec[] = [
  { targetTime: TARGET_FAST, handle: "in" },
  { targetTime: TARGET_FAST, handle: "out" },
  { targetTime: TARGET_FAST, handle: "in" },
  { targetTime: TARGET_FAST, handle: "out" },
  { targetTime: TARGET_FAST, handle: "in" },
  { targetTime: TARGET_FAST, handle: "out" },
  { targetTime: TARGET_FAST, handle: "in" },
  { targetTime: TARGET_FAST, handle: "out" },
];

const BLOCK_4_VARIABLE_ADAPTATION: ShotSpec[] = [
  { targetTime: TARGET_MEDIUM, handle: "in" },
  { targetTime: TARGET_SLOW, handle: "out" },
  { targetTime: TARGET_FAST, handle: "in" },
  { targetTime: TARGET_SLOW, handle: "out" },
  { targetTime: TARGET_FAST, handle: "out" },
  { targetTime: TARGET_MEDIUM, handle: "in" },
  { targetTime: TARGET_SLOW, handle: "in" },
  { targetTime: TARGET_FAST, handle: "out" },
];

function buildPlannedShots(
  specs: ShotSpec[],
  idPrefix: string,
  blockId: string | null,
  phase: PlannedAssessmentShot["phase"],
  startingSequenceIndex: number
): PlannedAssessmentShot[] {
  return specs.map((spec, index) => ({
    id: `${idPrefix}-${index + 1}`,
    sequenceIndex: startingSequenceIndex + index,
    blockId,
    blockSequenceIndex: index,
    targetTime: spec.targetTime,
    expectedHandle: spec.handle,
    shotType: RELEASE_TIME_CORE_V1_SHOT_TYPE,
    measurementMode: RELEASE_TIME_CORE_V1_MEASUREMENT_MODE,
    phase,
  }));
}

function buildBlock(
  id: string,
  name: string,
  purpose: string,
  sequenceIndex: number,
  specs: ShotSpec[],
  startingSequenceIndex: number,
  explanation?: string
): AssessmentBlockDefinition {
  return {
    id,
    name,
    purpose,
    sequenceIndex,
    plannedShots: buildPlannedShots(specs, `${id}-shot`, id, "scored", startingSequenceIndex),
    explanation,
  };
}

/** Recursively freezes a plain data structure — used only for the static, official template. */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}

/** Exported (unfrozen) purely so tests can verify the builder is deterministic across independent calls. Product code should always use RELEASE_TIME_CORE_ASSESSMENT_V1 below. */
export function buildReleaseTimeCoreAssessmentV1(): AssessmentTemplate {
  const warmupShots = buildPlannedShots(WARMUP_SEQUENCE, `${RELEASE_TIME_CORE_V1_ID}-warmup`, null, "warmup", 0);

  let cursor = warmupShots.length;

  const block1 = buildBlock(
    "block-1-medium-reproduction",
    "Medium Reproduction",
    "Reproduce the medium (3.75s) delivery speed consistently.",
    0,
    BLOCK_1_MEDIUM_REPRODUCTION,
    cursor
  );
  cursor += block1.plannedShots.length;

  const block2 = buildBlock(
    "block-2-slow-reproduction",
    "Slow Reproduction",
    "Reproduce the slow (4.00s) delivery speed consistently.",
    1,
    BLOCK_2_SLOW_REPRODUCTION,
    cursor
  );
  cursor += block2.plannedShots.length;

  const block3 = buildBlock(
    "block-3-fast-reproduction",
    "Fast Reproduction",
    "Reproduce the fast (3.50s) delivery speed consistently.",
    2,
    BLOCK_3_FAST_REPRODUCTION,
    cursor
  );
  cursor += block3.plannedShots.length;

  const block4 = buildBlock(
    "block-4-variable-adaptation",
    "Variable Adaptation",
    "Adapt to a changing target speed and handle from shot to shot.",
    3,
    BLOCK_4_VARIABLE_ADAPTATION,
    cursor
  );

  const template: AssessmentTemplate = {
    id: RELEASE_TIME_CORE_V1_ID,
    name: "Release Time Core Assessment",
    version: 1,
    type: "official",
    description:
      "Assesses release-time control at three fixed delivery speeds, with reproduction and variable-adaptation blocks, using a standardized Backline-Hog Draw protocol.",
    status: "published",
    measurementMode: RELEASE_TIME_CORE_V1_MEASUREMENT_MODE,
    shotType: RELEASE_TIME_CORE_V1_SHOT_TYPE,
    warmupShots,
    blocks: [block1, block2, block3, block4],
    validityRules: { maxInvalidRepeatsPerShot: 2 },
    repeatRules: { invalidAttemptsCountTowardCompletion: false },
    estimatedDurationMinutes: { min: 25, max: 35 },
    recommendedThresholds: "standard",
    protocolMetadata: {
      warmupShotCount: warmupShots.length,
      scoredShotCount: block1.plannedShots.length + block2.plannedShots.length + block3.plannedShots.length + block4.plannedShots.length,
    },
  };

  return template;
}

function assertReleaseTimeCoreV1Invariants(template: AssessmentTemplate): void {
  const genericValidation = validateAssessmentTemplate(template);
  if (!genericValidation.valid) {
    throw new Error(
      `Release Time Core Assessment v1 failed generic template validation: ${genericValidation.issues
        .map((issue) => issue.message)
        .join("; ")}`
    );
  }

  if (template.warmupShots.length !== 6) {
    throw new Error(
      `Release Time Core Assessment v1 must have exactly 6 warm-up shots, found ${template.warmupShots.length}.`
    );
  }

  const scoredShots = template.blocks.flatMap((block) => block.plannedShots);
  if (scoredShots.length !== 32) {
    throw new Error(
      `Release Time Core Assessment v1 must have exactly 32 scored shots, found ${scoredShots.length}.`
    );
  }

  const inCount = scoredShots.filter((shot) => shot.expectedHandle === "in").length;
  const outCount = scoredShots.filter((shot) => shot.expectedHandle === "out").length;
  if (inCount !== 16 || outCount !== 16) {
    throw new Error(
      `Release Time Core Assessment v1 must have exactly 16 In and 16 Out scored shots, found ${inCount} In / ${outCount} Out.`
    );
  }

  if (template.blocks.length !== 4) {
    throw new Error(
      `Release Time Core Assessment v1 must have exactly 4 blocks, found ${template.blocks.length}.`
    );
  }
}

export const RELEASE_TIME_CORE_ASSESSMENT_V1: AssessmentTemplate = deepFreeze(
  buildReleaseTimeCoreAssessmentV1()
);

// Validated once, at module import time — not on every render (see
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 9). A failure
// here means the literal shot sequence above was mistyped; it must never
// ship silently broken.
assertReleaseTimeCoreV1Invariants(RELEASE_TIME_CORE_ASSESSMENT_V1);

/** Every template known to the app. Only the official v1 template exists in Phase A. */
export const OFFICIAL_ASSESSMENT_TEMPLATES: readonly AssessmentTemplate[] = deepFreeze([
  RELEASE_TIME_CORE_ASSESSMENT_V1,
]);

export function findOfficialAssessmentTemplate(
  id: string,
  version: number
): AssessmentTemplate | undefined {
  return OFFICIAL_ASSESSMENT_TEMPLATES.find(
    (template) => template.id === id && template.version === version
  );
}
