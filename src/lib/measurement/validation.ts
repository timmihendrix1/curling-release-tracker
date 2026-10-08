// Strict validation of the measurement-aware parts of persisted Training Sessions and
// Training Plans.
//
// Deliberately separate from sessionMigration.ts's field-by-field repair style, and
// used the same way validateSessionExerciseState is: the repository, the plan
// repository and the cloud record boundary REJECT data that fails this, rather than
// letting migration quietly repair malformed new-format data into something that looks
// legacy.
//
// Everything here inspects the RAW persisted value and validates it BEFORE any
// normalization, so a malformed shape can never be partially accepted, silently
// filtered down to the subset this build understands, or throw past the repository's
// protected failure path.
//
// The format discriminator is `TrainingBlock.measurement`:
//   - absent  -> the historical time-only block. Untouched by this validator and by
//               migration; its existing repair rules (and therefore its stored bytes
//               and cloud digest) are exactly what they have always been.
//   - present -> a measurement-aware block. Everything about it and its stones is
//               validated strictly; nothing is defaulted, repaired or fabricated.
//
// See docs/adr/0051-fixed-weight-measured-quantities-and-per-side-tolerances.md.
import type { MeasuredQuantity, Shot, TrainingBlock } from "../../types";
import { normalizeBlockMeasurementConfiguration } from "./quantities";
import { isValidQuantityValue } from "./tolerance";

export type MeasurementValidationIssue = {
  path: string;
  message: string;
};

export type MeasurementValidationResult =
  | { valid: true; issues: [] }
  | { valid: false; issues: MeasurementValidationIssue[] };

const VALID_TIMING_SOURCES = new Set(["simulator", "manual", "external"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ok(): MeasurementValidationResult {
  return { valid: true, issues: [] };
}

function fail(issues: MeasurementValidationIssue[]): MeasurementValidationResult {
  return issues.length > 0 ? { valid: false, issues } : ok();
}

/**
 * Whether this value declares a block measurement configuration anywhere — the single
 * condition that selects the newer cloud wire version. A session that is entirely
 * time-only AND carries no explicit configuration continues to serialize exactly as it
 * always did. See src/lib/cloudSporting/records.ts.
 */
export function usesBlockMeasurementConfiguration(value: unknown): boolean {
  if (!isRecord(value)) return false;

  const blocks = value.blocks;
  if (
    Array.isArray(blocks) &&
    blocks.some((block) => isRecord(block) && block.measurement !== undefined)
  ) {
    return true;
  }

  // Embedded plan-step snapshots count too, even for a step whose Block has not been
  // materialised yet. Finishing a mixed plan during step 1 archives a Session whose
  // blocks are all legacy but whose planExecution still carries step 2's measurement
  // configuration — an old client's plan validator cannot read that step, so calling
  // the payload legacy-compatible would be untrue.
  const steps = planExecutionSteps(value.planExecution);
  return steps.some((step) => {
    const configuration = isRecord(step) ? step.configuration : undefined;
    return isRecord(configuration) && configuration.measurement !== undefined;
  });
}

/** The raw `step` objects reachable from a raw `planExecution`, if any. */
function planExecutionSteps(rawExecution: unknown): unknown[] {
  if (!isRecord(rawExecution)) return [];
  const steps = rawExecution.steps;
  if (!Array.isArray(steps)) return [];
  return steps
    .map((snapshot) => (isRecord(snapshot) ? snapshot.step : undefined))
    .filter((step): step is Record<string, unknown> => isRecord(step));
}

/**
 * Validates one raw measurement-aware configuration together with the legacy time
 * fields it must agree with. Shared by the block and the plan-step boundaries, which
 * carry structurally identical configuration.
 *
 *   - only Fixed Weight may declare one (Variable and Blind Weight keep their existing
 *     time-only semantics untouched);
 *   - a configuration that includes time MUST still carry `measurementMode` and
 *     `targetTime`, which keep their exact historical meaning, and `targetTime` must
 *     EQUAL `measurement.time.target` — one target authority, never two that disagree;
 *   - a speed-only configuration must carry NEITHER, because something measuring no
 *     time has no timing interval and no time target to record.
 */
function validateRawMeasurementCarrier(
  raw: Record<string, unknown>,
  path: string,
  issues: MeasurementValidationIssue[]
): MeasuredQuantity[] | undefined {
  const normalized = normalizeBlockMeasurementConfiguration(raw.measurement);

  // `quantities` must already be stored in canonical order. Normalization sorts it,
  // so a differently-ordered stored array would be rewritten by migration — which
  // changes the payload bytes and makes the cloud reader's exact-equality check fail
  // on a record the writer had accepted. Rejecting here keeps writer and reader in
  // agreement instead of silently repairing stored data on load.
  if (normalized) {
    const stored = (raw.measurement as { quantities?: unknown } | undefined)?.quantities;
    if (
      !Array.isArray(stored) ||
      stored.length !== normalized.quantities.length ||
      stored.some((quantity, index) => quantity !== normalized.quantities[index])
    ) {
      issues.push({
        path: `${path}.measurement.quantities`,
        message:
          "Measured quantities must be stored in canonical order (time before speed).",
      });
    }
  }

  if (!normalized) {
    issues.push({
      path: `${path}.measurement`,
      message:
        "Measurement configuration must declare only known quantities, without duplicates or undeclared entries, each with a positive target and a valid per-side tolerance.",
    });
    return undefined;
  }

  if (raw.mode !== "fixed") {
    issues.push({
      path: `${path}.mode`,
      message:
        "Only Fixed Weight may declare a measurement configuration; Variable and Blind Weight keep their existing time-only semantics.",
    });
  }

  const includesTime = normalized.quantities.includes("time");

  if (includesTime) {
    if (raw.measurementMode !== "back-hog" && raw.measurementMode !== "hog-hog") {
      issues.push({
        path: `${path}.measurementMode`,
        message: "Something that measures time must record its timing interval.",
      });
    }
    if (!isValidQuantityValue(raw.targetTime)) {
      issues.push({
        path: `${path}.targetTime`,
        message: "Something that measures time must record a positive time target.",
      });
    } else if (raw.targetTime !== normalized.time?.target) {
      // Two stored representations of the same target that disagree. Rejected rather
      // than silently resolved one way — capture and explicit completion would
      // otherwise judge the same stone against different targets.
      issues.push({
        path: `${path}.targetTime`,
        message:
          "The time target and the measured-quantity time target disagree; there is no way to tell which one a recorded stone was judged against.",
      });
    }
  } else {
    if (raw.measurementMode !== undefined) {
      issues.push({
        path: `${path}.measurementMode`,
        message:
          "Something that measures no time must not carry a timing interval.",
      });
    }
    if (raw.targetTime !== undefined) {
      issues.push({
        path: `${path}.targetTime`,
        message: "Something that measures no time must not carry a time target.",
      });
    }
  }

  return normalized.quantities;
}

/**
 * Validates one raw stone against its block's declared quantities. A stone must carry
 * at least one real measurement, must carry each measured value together with the
 * target it was judged against, and must never carry a measurement its block does not
 * record. Missing is explicitly permitted for at most one of two declared quantities —
 * that is the partial-Both stone the product allows — and is never the same as zero.
 */
function validateRawShot(
  raw: Record<string, unknown>,
  quantities: MeasuredQuantity[],
  path: string,
  issues: MeasurementValidationIssue[]
): void {
  const hasTime = raw.releaseTime !== undefined || raw.targetTime !== undefined;
  const hasSpeed = raw.speed !== undefined || raw.targetSpeed !== undefined;

  if (hasTime && !quantities.includes("time")) {
    issues.push({
      path: `${path}.releaseTime`,
      message: "This stone records a time its block does not measure.",
    });
  }
  if (hasSpeed && !quantities.includes("speed")) {
    issues.push({
      path: `${path}.speed`,
      message: "This stone records a speed its block does not measure.",
    });
  }

  let measurements = 0;

  if (hasTime) {
    if (!isValidQuantityValue(raw.releaseTime) || !isValidQuantityValue(raw.targetTime)) {
      issues.push({
        path: `${path}.releaseTime`,
        message:
          "A recorded time must be a positive number stored together with the positive target it was judged against.",
      });
    } else {
      measurements += 1;
    }
  }

  if (hasSpeed) {
    if (!isValidQuantityValue(raw.speed) || !isValidQuantityValue(raw.targetSpeed)) {
      issues.push({
        path: `${path}.speed`,
        message:
          "A recorded speed must be a positive number stored together with the positive target it was judged against.",
      });
    } else {
      measurements += 1;
    }
  }

  if (measurements === 0) {
    issues.push({
      path,
      message: "A recorded stone must carry at least one real measurement.",
    });
  }

  if (
    raw.measurementSource !== undefined &&
    !VALID_TIMING_SOURCES.has(raw.measurementSource as string)
  ) {
    issues.push({ path: `${path}.measurementSource`, message: "Unknown time source." });
  }

  if (raw.measurementSource !== undefined && !hasTime) {
    issues.push({
      path: `${path}.measurementSource`,
      message: "A time source cannot be recorded without a time.",
    });
  }

  if (
    raw.speedSource !== undefined &&
    !VALID_TIMING_SOURCES.has(raw.speedSource as string)
  ) {
    issues.push({ path: `${path}.speedSource`, message: "Unknown speed source." });
  }

  if (raw.speedSource !== undefined && !hasSpeed) {
    issues.push({
      path: `${path}.speedSource`,
      message: "A speed source cannot be recorded without a speed.",
    });
  }

  if (
    raw.speedRecordedAt !== undefined &&
    (typeof raw.speedRecordedAt !== "string" ||
      !Number.isFinite(Date.parse(raw.speedRecordedAt)))
  ) {
    issues.push({
      path: `${path}.speedRecordedAt`,
      message: "Speed recording timestamp must be a valid date.",
    });
  }
}

/**
 * Validates every measurement-aware plan step configuration reachable from a raw
 * `planExecution`, so a plan step can never be persisted in a shape the loader would
 * silently drop. Each step's configuration is validated exactly like a block's.
 */
function validateRawPlanExecution(
  rawExecution: unknown,
  issues: MeasurementValidationIssue[]
): void {
  planExecutionSteps(rawExecution).forEach((step, index) => {
    const configuration = isRecord(step) ? step.configuration : undefined;
    if (!isRecord(configuration) || configuration.measurement === undefined) return;
    validateRawMeasurementCarrier(
      configuration,
      `planExecution.steps[${index}].step.configuration`,
      issues
    );
  });
}

/**
 * Validates a raw persisted Training Session's measurement state.
 *
 * A session with no measurement-aware block anywhere is valid by construction and is
 * never inspected further — except that a stone may not carry speed fields when no
 * block declares speed, which would be malformed new-format data masquerading as
 * legacy. Every additional strictness rule below (dangling block references, duplicate
 * identities) applies ONLY once the session is measurement-aware, so purely legacy data
 * keeps its existing repair behaviour exactly.
 */
const VALID_BLOCK_MODES = new Set(["fixed", "variable", "blind"]);
const VALID_HANDLES = new Set(["in", "out"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * The required STRUCTURE of a measurement-aware session, validated before migration's
 * repair rules can alter or discard any of it.
 *
 * Containers themselves are part of that structure: treating a non-array `shots` as an
 * empty one, or skipping a `null` entry, is exactly how a malformed session passes
 * validation and then has a stone fabricated for it on load. Every required identity,
 * field, enum and reference is checked here; the canonical-shape invariant in
 * canonicalSession.ts is the systematic backstop that catches anything else migration
 * would still change.
 */
function validateRawSessionStructure(
  value: Record<string, unknown>,
  issues: MeasurementValidationIssue[]
): { blocks: Record<string, unknown>[]; shots: Record<string, unknown>[] } {
  const blocks: Record<string, unknown>[] = [];
  const shots: Record<string, unknown>[] = [];

  if (!isNonEmptyString(value.id)) {
    issues.push({ path: "id", message: "A training session must have an identity." });
  }
  if (!isValidTimestamp(value.date)) {
    issues.push({ path: "date", message: "A training session must have a valid date." });
  }

  if (!Array.isArray(value.blocks)) {
    issues.push({ path: "blocks", message: "Exercises must be stored as a list." });
  } else {
    for (const [index, candidate] of value.blocks.entries()) {
      const path = `blocks[${index}]`;
      if (!isRecord(candidate)) {
        issues.push({ path, message: "Each exercise must be an object." });
        continue;
      }
      if (!isNonEmptyString(candidate.id)) {
        issues.push({ path: `${path}.id`, message: "Every exercise must have a stable identity." });
      }
      if (typeof candidate.name !== "string") {
        issues.push({ path: `${path}.name`, message: "Every exercise must have a name." });
      }
      if (!VALID_BLOCK_MODES.has(candidate.mode as string)) {
        issues.push({ path: `${path}.mode`, message: "Unknown training form." });
      }
      if (!isValidTimestamp(candidate.createdAt)) {
        issues.push({
          path: `${path}.createdAt`,
          message: "Every exercise must record when it started.",
        });
      }
      blocks.push(candidate);
    }
  }

  if (!Array.isArray(value.shots)) {
    issues.push({ path: "shots", message: "Stones must be stored as a list." });
  } else {
    for (const [index, candidate] of value.shots.entries()) {
      const path = `shots[${index}]`;
      if (!isRecord(candidate)) {
        // A `null` entry here is how migration ends up fabricating a whole stone.
        issues.push({ path, message: "Each recorded stone must be an object." });
        continue;
      }
      if (
        !Number.isInteger(candidate.shotNumber) ||
        (candidate.shotNumber as number) <= 0
      ) {
        issues.push({
          path: `${path}.shotNumber`,
          message: "Every stone must have a positive whole stone number.",
        });
      }
      if (!VALID_HANDLES.has(candidate.handle as string)) {
        issues.push({ path: `${path}.handle`, message: "Unknown handle." });
      }
      if (!isValidTimestamp(candidate.createdAt)) {
        issues.push({
          path: `${path}.createdAt`,
          message: "Every stone must record when it was recorded.",
        });
      }
      shots.push(candidate);
    }
  }

  const activeBlockId = value.activeBlockId;
  if (typeof activeBlockId !== "string") {
    issues.push({
      path: "activeBlockId",
      message: "A training session must record which exercise is active.",
    });
  }

  return { blocks, shots };
}

export function validateSessionMeasurementState(
  value: unknown
): MeasurementValidationResult {
  if (!isRecord(value)) return ok();

  const measurementAware = usesBlockMeasurementConfiguration(value);

  const issues: MeasurementValidationIssue[] = [];

  // Structure is validated FIRST, and only for the new representation — legacy
  // sessions keep every existing repair rule untouched.
  const structured = measurementAware
    ? validateRawSessionStructure(value, issues)
    : null;

  const rawBlocks = structured
    ? structured.blocks
    : Array.isArray(value.blocks)
      ? value.blocks
      : [];
  const rawShots = structured
    ? structured.shots
    : Array.isArray(value.shots)
      ? value.shots
      : [];

  const quantitiesByBlockId = new Map<string, MeasuredQuantity[]>();
  const blockIds = new Set<string>();
  let duplicateBlockId = false;
  const anyMeasurementAwareBlock = measurementAware;

  for (const [index, candidate] of rawBlocks.entries()) {
    if (!isRecord(candidate)) continue;
    const id = typeof candidate.id === "string" ? candidate.id : undefined;
    if (id !== undefined) {
      if (blockIds.has(id)) duplicateBlockId = true;
      blockIds.add(id);
    }

    if (candidate.measurement === undefined) continue;

    const quantities = validateRawMeasurementCarrier(
      candidate,
      `blocks[${index}]`,
      issues
    );
    if (quantities && id !== undefined) quantitiesByBlockId.set(id, quantities);
  }

  validateRawPlanExecution(value.planExecution, issues);

  if (!anyMeasurementAwareBlock) {
    // Purely legacy session: only guard against speed state no block declares.
    for (const [index, candidate] of rawShots.entries()) {
      if (!isRecord(candidate)) continue;
      if (
        candidate.speed !== undefined ||
        candidate.targetSpeed !== undefined ||
        candidate.speedSource !== undefined ||
        candidate.speedRecordedAt !== undefined
      ) {
        issues.push({
          path: `shots[${index}].speed`,
          message:
            "This stone records a speed, but its block does not declare a speed measurement.",
        });
      }
    }
    return fail(issues);
  }

  if (duplicateBlockId) {
    issues.push({
      path: "blocks",
      message:
        "Two blocks share one identity, so there is no way to tell which one a stone belongs to.",
    });
  }

  const sessionId = typeof value.id === "string" ? value.id : undefined;
  const seenShotIds = new Set<string>();
  for (const [index, candidate] of rawShots.entries()) {
    if (!isRecord(candidate)) continue;
    const path = `shots[${index}]`;

    // A stable identity is what every later operation addresses a stone by —
    // explicit completion most of all. Migration would mint a fresh id for a stone
    // that has none, which both rewrites the payload and makes the stone
    // unaddressable by anything that referred to it before. Rejected instead.
    const shotId =
      typeof candidate.id === "string" && candidate.id.length > 0
        ? candidate.id
        : undefined;
    if (shotId === undefined) {
      issues.push({
        path: `${path}.id`,
        message: "Every recorded stone must have a stable identity.",
      });
    } else {
      if (seenShotIds.has(shotId)) {
        issues.push({
          path: `${path}.id`,
          message:
            "Two stones share one identity, so a later completion could not tell them apart.",
        });
      }
      seenShotIds.add(shotId);
    }

    // Ownership: a stone carrying another session's id is not this session's to
    // store. Migration would silently restamp it, hiding the inconsistency.
    if (sessionId !== undefined && candidate.sessionId !== sessionId) {
      issues.push({
        path: `${path}.sessionId`,
        message: "This stone belongs to a different training session.",
      });
    }

    const blockId = typeof candidate.blockId === "string" ? candidate.blockId : "";

    // A dangling reference is rejected rather than silently re-attributed. Migration's
    // legacy fallback would reassign such a stone to the last block and then apply THAT
    // block's format to it — for a measurement-aware block that means a stone with no
    // real measurement at all, which must never be stored.
    if (!blockIds.has(blockId)) {
      issues.push({
        path: `${path}.blockId`,
        message: "This stone refers to an exercise that is not part of this training.",
      });
      continue;
    }

    const quantities = quantitiesByBlockId.get(blockId);

    if (quantities) {
      validateRawShot(candidate, quantities, path, issues);
      continue;
    }

    // A stone in a legacy, time-only block of an otherwise measurement-aware session.
    // Its existing repair rules still apply untouched — but it must not carry speed
    // state that no block declares.
    if (
      candidate.speed !== undefined ||
      candidate.targetSpeed !== undefined ||
      candidate.speedSource !== undefined ||
      candidate.speedRecordedAt !== undefined
    ) {
      issues.push({
        path: `${path}.speed`,
        message:
          "This stone records a speed, but its block does not declare a speed measurement.",
      });
    }
  }

  return fail(issues);
}

/**
 * Validates every measurement-aware step configuration in a raw persisted Training
 * Plan library state. Used by TrainingPlansRepository on both read and write, so an
 * invalid speed configuration is surfaced as a protected failure instead of being
 * repaired into executable legacy Back-Hog / 3.75s time training.
 */
export function validateTrainingPlansMeasurementState(
  value: unknown
): MeasurementValidationResult {
  if (!isRecord(value)) return ok();
  const plans = Array.isArray(value.plans) ? value.plans : [];
  const issues: MeasurementValidationIssue[] = [];

  plans.forEach((plan, planIndex) => {
    if (!isRecord(plan)) return;
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    steps.forEach((step, stepIndex) => {
      if (!isRecord(step)) return;
      const configuration = step.configuration;
      if (!isRecord(configuration) || configuration.measurement === undefined) return;
      validateRawMeasurementCarrier(
        configuration,
        `plans[${planIndex}].steps[${stepIndex}].configuration`,
        issues
      );
    });
  });

  return fail(issues);
}

/** Convenience guard matching the shape the repository and cloud boundary need. */
export function hasValidSessionMeasurementState(value: unknown): boolean {
  return validateSessionMeasurementState(value).valid;
}

/** Whether an already-typed Session carries speed anywhere. */
export function sessionRecordsSpeed(blocks: TrainingBlock[]): boolean {
  return blocks.some((block) => block.measurement?.quantities.includes("speed") === true);
}

/**
 * Whether EVERY measurement a stone actually carries is well formed, judged against
 * the quantities its block records.
 *
 * Distinct from `shotHasAnyMeasurement`, which only asks whether at least one valid
 * pair exists. A stone carrying a valid speed AND a stray `releaseTime` with no time
 * target satisfies that weaker question while still being malformed — and treating it
 * as merely "incomplete" would let an explicit completion write over the recorded
 * 3.9 as if that value had never been there. Presence of an invalid recorded value is
 * never permission to replace it.
 */
export function shotMeasurementStateIsValid(
  shot: Shot,
  quantities: MeasuredQuantity[]
): boolean {
  const hasTime = shot.releaseTime !== undefined || shot.targetTime !== undefined;
  const hasSpeed = shot.speed !== undefined || shot.targetSpeed !== undefined;

  if (hasTime && !quantities.includes("time")) return false;
  if (hasSpeed && !quantities.includes("speed")) return false;

  if (
    hasTime &&
    !(isValidQuantityValue(shot.releaseTime) && isValidQuantityValue(shot.targetTime))
  ) {
    return false;
  }
  if (
    hasSpeed &&
    !(isValidQuantityValue(shot.speed) && isValidQuantityValue(shot.targetSpeed))
  ) {
    return false;
  }

  if (shot.speedSource !== undefined && !hasSpeed) return false;
  if (shot.measurementSource !== undefined && !hasTime) return false;

  // A recorded stone must still carry at least one real measurement.
  return hasTime || hasSpeed;
}

/** Whether a stone is a complete record of everything its block measures. */
export function shotIsComplete(
  quantities: MeasuredQuantity[],
  shot: Shot
): boolean {
  return quantities.every((quantity) =>
    quantity === "time"
      ? isValidQuantityValue(shot.releaseTime) && isValidQuantityValue(shot.targetTime)
      : isValidQuantityValue(shot.speed) && isValidQuantityValue(shot.targetSpeed)
  );
}
