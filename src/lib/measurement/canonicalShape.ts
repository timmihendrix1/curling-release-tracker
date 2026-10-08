// The ONE definition of the property order a persisted Shot and TrainingBlock are
// written in.
//
// Why property order is a correctness concern, not cosmetics: a terminal cloud record
// stores `JSON.stringify(session)` and is identified by the SHA-256 of exactly those
// bytes. `SportingCloudSyncManager.reconcile` compares the stored payload string and
// digest against a freshly serialized one, and restore performs the same exact
// comparison. So if a Session is constructed with one property order and then
// reconstructed by migration with another, the values are identical but the bytes are
// not — and an already-uploaded, unmodified record is reported as a sync conflict.
//
// Migration is the authority on that order because it is the function every stored
// Session passes through on load. These builders are used BY migration and by every
// producer, so there is a single definition and the two cannot drift apart.
//
// Pure reordering: no value is changed, defaulted or repaired here. Keys whose value
// is `undefined` are dropped, exactly as `JSON.stringify` already drops them.
//
// See docs/adr/0051-fixed-weight-measured-quantities-and-per-side-tolerances.md and
// docs/PERSISTENCE_BOUNDARY_DESIGN.md.
import type {
  PlanExecutionState,
  PlanExecutionStepSnapshot,
  Shot,
  TrainingBlock,
} from "../../types";

function assign<T extends object, K extends keyof T>(
  target: Partial<T>,
  source: T,
  key: K
): void {
  if (source[key] !== undefined) target[key] = source[key];
}

/**
 * A Shot with its properties in canonical persisted order:
 *
 *   identity -> measurements -> prediction/classification -> capture provenance
 *
 * The measurement block keeps time before speed, and each measured value immediately
 * before the target it was judged against.
 */
export function canonicalShot(shot: Shot): Shot {
  const canonical: Partial<Shot> = {
    id: shot.id,
    sessionId: shot.sessionId,
    blockId: shot.blockId,
    shotNumber: shot.shotNumber,
  };

  assign(canonical, shot, "releaseTime");
  assign(canonical, shot, "targetTime");
  assign(canonical, shot, "speed");
  assign(canonical, shot, "targetSpeed");
  assign(canonical, shot, "speedSource");
  assign(canonical, shot, "speedRecordedAt");
  assign(canonical, shot, "predictedTime");

  canonical.handle = shot.handle;

  assign(canonical, shot, "shotType");
  assign(canonical, shot, "comment");

  canonical.createdAt = shot.createdAt;

  assign(canonical, shot, "measurementSource");
  assign(canonical, shot, "captureSequenceId");
  assign(canonical, shot, "timingResultId");
  assign(canonical, shot, "deviceId");
  assign(canonical, shot, "laneId");

  return canonical as Shot;
}

/**
 * A TrainingBlock with its properties in canonical persisted order.
 *
 * The target-source fields (`pendingTargetTime`, the Smart Random range) sit before
 * the tolerance snapshot, which is where migration emits them — `createTrainingBlock`
 * used to append them afterwards, so a Variable Weight block serialized differently
 * before and after a reload.
 */
export function canonicalTrainingBlock(block: TrainingBlock): TrainingBlock {
  const canonical: Partial<TrainingBlock> = {
    id: block.id,
    name: block.name,
    mode: block.mode,
  };

  assign(canonical, block, "measurementMode");
  assign(canonical, block, "targetTime");

  canonical.createdAt = block.createdAt;

  assign(canonical, block, "completedAt");
  assign(canonical, block, "variableTargetMode");
  assign(canonical, block, "blindTargetMode");
  assign(canonical, block, "pendingTargetTime");
  assign(canonical, block, "smartRandomMin");
  assign(canonical, block, "smartRandomMax");
  assign(canonical, block, "accuracyThresholds");
  assign(canonical, block, "measurement");

  return canonical as TrainingBlock;
}

/**
 * A Training Plan execution in canonical persisted order.
 *
 * `activeStepIndex` is emitted AFTER `steps`, which is where migration puts it;
 * `startPlanExecution`/`advanceToNextPlanStep` used to put it before, so a planned
 * Session serialized differently before and after a reload — even one whose plan the
 * athlete had not touched.
 */
export function canonicalPlanExecution(
  planExecution: PlanExecutionState
): PlanExecutionState {
  const canonical: Partial<PlanExecutionState> = {
    sourcePlanId: planExecution.sourcePlanId,
    sourcePlanName: planExecution.sourcePlanName,
  };

  assign(canonical, planExecution, "sourcePlanUpdatedAt");

  canonical.steps = planExecution.steps.map(canonicalPlanExecutionStep);
  canonical.activeStepIndex = planExecution.activeStepIndex;

  return canonical as PlanExecutionState;
}

function canonicalPlanExecutionStep(
  snapshot: PlanExecutionStepSnapshot
): PlanExecutionStepSnapshot {
  const canonical: Partial<PlanExecutionStepSnapshot> = { step: snapshot.step };
  assign(canonical, snapshot, "runtime");
  return canonical as PlanExecutionStepSnapshot;
}
