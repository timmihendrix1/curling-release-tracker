// Shared fixtures for the Fixed Weight measured-quantity tests (ADR-0051).
//
// Deliberately built through the real domain constructors where one exists
// (createTrainingBlock), so a fixture can never describe a block the application
// itself would refuse to create.
import type {
  BlockMeasurementConfiguration,
  Session,
  Shot,
  TrainingBlock,
} from "../../../types";
import { STANDARD_ACCURACY_THRESHOLDS } from "../../accuracyThresholds";
import { createTrainingBlock } from "../../trainingBlocks";
import { canonicalShot } from "../canonicalShape";
import { DEFAULT_SPEED_TOLERANCE, symmetricTolerance } from "../tolerance";

export const TIME_CONFIGURATION: BlockMeasurementConfiguration = {
  quantities: ["time"],
  time: { target: 3.75, tolerance: symmetricTolerance(0.1, 0.2) },
};

export const SPEED_CONFIGURATION: BlockMeasurementConfiguration = {
  quantities: ["speed"],
  speed: { target: 2.4, tolerance: DEFAULT_SPEED_TOLERANCE },
};

export const BOTH_CONFIGURATION: BlockMeasurementConfiguration = {
  quantities: ["time", "speed"],
  time: { target: 3.75, tolerance: symmetricTolerance(0.1, 0.2) },
  speed: { target: 2.4, tolerance: DEFAULT_SPEED_TOLERANCE },
};

/** The historical time-only block: no `measurement` field at all. */
export function legacyTimeBlock(overrides: Partial<TrainingBlock> = {}): TrainingBlock {
  return {
    ...createTrainingBlock({
      name: "Legacy",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
      accuracyThresholds: STANDARD_ACCURACY_THRESHOLDS,
    }),
    ...overrides,
  };
}

export function timeBlock(overrides: Partial<TrainingBlock> = {}): TrainingBlock {
  return {
    ...createTrainingBlock({
      name: "Time",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
      accuracyThresholds: STANDARD_ACCURACY_THRESHOLDS,
      measurement: TIME_CONFIGURATION,
    }),
    ...overrides,
  };
}

export function speedBlock(overrides: Partial<TrainingBlock> = {}): TrainingBlock {
  return {
    ...createTrainingBlock({
      name: "Speed",
      mode: "fixed",
      accuracyThresholds: STANDARD_ACCURACY_THRESHOLDS,
      measurement: SPEED_CONFIGURATION,
    }),
    ...overrides,
  };
}

export function bothBlock(overrides: Partial<TrainingBlock> = {}): TrainingBlock {
  return {
    ...createTrainingBlock({
      name: "Both",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
      accuracyThresholds: STANDARD_ACCURACY_THRESHOLDS,
      measurement: BOTH_CONFIGURATION,
    }),
    ...overrides,
  };
}

let shotCounter = 0;

/**
 * The id every fixture Session uses. Shots default to it so a fixture stone is always
 * genuinely owned by the fixture session — a stone stamped with a different session's
 * id is rejected at the persistence and completion boundaries, as it should be.
 */
export const FIXTURE_SESSION_ID = "11111111-1111-4111-8111-111111111111";

export function shot(block: TrainingBlock, overrides: Partial<Shot> = {}): Shot {
  shotCounter += 1;
  // Canonicalised like every real producer, so a fixture can never be arranged in
  // migration's preferred order by accident and hide an ordering defect.
  return canonicalShot({
    id: `shot-${shotCounter}`,
    sessionId: FIXTURE_SESSION_ID,
    blockId: block.id,
    shotNumber: shotCounter,
    handle: "in",
    createdAt: "2026-10-06T10:00:00.000Z",
    ...overrides,
  });
}

export function timeShot(block: TrainingBlock, releaseTime: number, overrides: Partial<Shot> = {}): Shot {
  return shot(block, { releaseTime, targetTime: 3.75, ...overrides });
}

export function speedShot(block: TrainingBlock, speed: number, overrides: Partial<Shot> = {}): Shot {
  return shot(block, { speed, targetSpeed: 2.4, speedSource: "manual", ...overrides });
}

export function bothShot(
  block: TrainingBlock,
  releaseTime: number,
  speed: number,
  overrides: Partial<Shot> = {}
): Shot {
  return shot(block, {
    releaseTime,
    targetTime: 3.75,
    speed,
    targetSpeed: 2.4,
    speedSource: "manual",
    ...overrides,
  });
}

export function session(blocks: TrainingBlock[], shots: Shot[]): Session {
  return {
    id: FIXTURE_SESSION_ID,
    title: "Training Session",
    date: "2026-10-06T10:00:00.000Z",
    notes: "",
    blocks,
    activeBlockId: blocks.at(-1)?.id ?? "",
    shots,
  };
}
