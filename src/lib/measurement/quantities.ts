// The one place that answers "what does this block measure?" and "does this stone
// carry that measurement?". Every analytics, chart, history, progress and export
// consumer selects its input through these helpers rather than reading
// shot.releaseTime / shot.speed directly, which is what guarantees a speed-only
// stone can never enter a time calculation, a missing value can never be counted
// as zero, and the two units can never be mixed in one series.
//
// See docs/adr/0051-fixed-weight-measured-quantities-and-per-side-tolerances.md.
import type {
  BlockMeasurementConfiguration,
  MeasuredQuantity,
  QuantityConfiguration,
  QuantityTolerance,
  Shot,
  TrainingBlock,
} from "../../types";
import { resolveAccuracyThresholds } from "../accuracyThresholds";
import {
  isValidQuantityTolerance,
  isValidQuantityValue,
  toleranceFromAccuracyThresholds,
} from "./tolerance";

export const MEASURED_QUANTITIES: MeasuredQuantity[] = ["time", "speed"];

export function isMeasuredQuantity(value: unknown): value is MeasuredQuantity {
  return value === "time" || value === "speed";
}

/**
 * A block's measurement configuration after legacy absence has been resolved.
 * `quantities` lists only the quantities this block can actually be analyzed for;
 * a quantity appears if and only if its configuration entry is present.
 */
export type ResolvedBlockMeasurement = {
  quantities: MeasuredQuantity[];
  time?: QuantityConfiguration;
  speed?: QuantityConfiguration;
};

const NO_QUANTITIES: ResolvedBlockMeasurement = { quantities: [] };

type MeasurementCarrier = Pick<
  TrainingBlock,
  "targetTime" | "accuracyThresholds" | "measurement"
>;

/**
 * Resolves what a block measures.
 *
 * An absent `measurement` field is the LEGACY, time-only representation — the
 * overwhelmingly common case and the shape of every block stored before this
 * feature. It resolves to the block's own `targetTime` plus the symmetric seconds
 * tolerance its historical `accuracyThresholds` snapshot always meant. Nothing is
 * written back: migration never materializes `measurement` onto such a block, so
 * its stored bytes and cloud digest are untouched (ADR-0051).
 *
 * A block with neither `measurement` nor a usable `targetTime` is malformed rather
 * than legacy; strict validation rejects it on load, and resolving it yields no
 * analyzable quantity instead of a fabricated 3.75s target.
 *
 * **Single target authority.** When a `measurement` configuration is present it is the
 * sole authority for every target it declares, and `block.targetTime` is a derived
 * mirror of `measurement.time.target` maintained only for legacy readers — the two can
 * never disagree, because block creation derives one from the other and persisted data
 * carrying a mismatch is rejected rather than silently resolved one way (ADR-0051).
 * When no `measurement` is present, `targetTime` is the authority, exactly as always.
 */
export function resolveBlockMeasurement(
  block: MeasurementCarrier
): ResolvedBlockMeasurement {
  const configured = block.measurement;

  if (configured !== undefined) {
    // Resolution goes through the same strict normalizer the write boundaries use, so
    // a configuration is either wholly usable or wholly unusable. A PARTIAL resolve
    // (e.g. accepting the time half of a configuration whose speed half is malformed)
    // would silently present a Both block as time-only and let a later write persist
    // that downgrade.
    const normalized = normalizeBlockMeasurementConfiguration(configured);
    if (!normalized) return NO_QUANTITIES;

    const resolved: ResolvedBlockMeasurement = {
      quantities: normalized.quantities,
    };
    if (normalized.time) resolved.time = normalized.time;
    if (normalized.speed) resolved.speed = normalized.speed;
    return resolved;
  }

  if (!isValidQuantityValue(block.targetTime)) return NO_QUANTITIES;

  return {
    quantities: ["time"],
    time: {
      target: block.targetTime,
      tolerance: toleranceFromAccuracyThresholds(
        resolveAccuracyThresholds(block.accuracyThresholds)
      ),
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a candidate is a usable configuration entry. Deliberately checks the shape
 * BEFORE reading any property: a `null` entry is a malformed stored value, not an
 * absent one, and must produce a rejection rather than a TypeError that escapes the
 * repository's protected failure path.
 */
function isQuantityConfiguration(value: unknown): value is QuantityConfiguration {
  if (!isPlainObject(value)) return false;
  return (
    isValidQuantityValue(value.target) &&
    isValidQuantityTolerance(value.tolerance as QuantityTolerance | undefined)
  );
}

/** A deep copy of a tolerance, so no snapshot shares a band object with its caller. */
export function cloneQuantityTolerance(
  tolerance: QuantityTolerance
): QuantityTolerance {
  return {
    onTarget: { lower: tolerance.onTarget.lower, upper: tolerance.onTarget.upper },
    acceptable: {
      lower: tolerance.acceptable.lower,
      upper: tolerance.acceptable.upper,
    },
  };
}

/**
 * A deep copy of a whole configuration. Every snapshot boundary (block creation, plan
 * step configuration, execution snapshots, template application) copies through this,
 * so later editing or deleting the source can never reach back into recorded history
 * — the same isolation rule ADR-0008 established for AccuracyThresholds and ADR-0012
 * established for plan step snapshots.
 */
export function cloneBlockMeasurementConfiguration(
  configuration: BlockMeasurementConfiguration
): BlockMeasurementConfiguration {
  const copy: BlockMeasurementConfiguration = {
    quantities: [...configuration.quantities],
  };
  for (const quantity of configuration.quantities) {
    const entry = configuration[quantity];
    if (entry) {
      copy[quantity] = {
        target: entry.target,
        tolerance: cloneQuantityTolerance(entry.tolerance),
      };
    }
  }
  return copy;
}

/** Whether this block records the given quantity at all. */
export function blockMeasures(
  block: MeasurementCarrier,
  quantity: MeasuredQuantity
): boolean {
  return resolveBlockMeasurement(block).quantities.includes(quantity);
}

/** The tolerance snapshot that judges this block's measurements of `quantity`. */
export function blockTolerance(
  block: MeasurementCarrier,
  quantity: MeasuredQuantity
): QuantityTolerance | undefined {
  return resolveBlockMeasurement(block)[quantity]?.tolerance;
}

/** The block's configured target for `quantity` (a Variable/Blind block's default). */
export function blockQuantityTarget(
  block: MeasurementCarrier,
  quantity: MeasuredQuantity
): number | undefined {
  return resolveBlockMeasurement(block)[quantity]?.target;
}

// --- Per-stone measurement eligibility ----------------------------------------

/** A stone that genuinely carries a time measurement AND the target it was judged against. */
export type TimeMeasuredShot = Shot & { releaseTime: number; targetTime: number };

/** A stone that genuinely carries a speed measurement AND its speed target. */
export type SpeedMeasuredShot = Shot & { speed: number; targetSpeed: number };

/**
 * A measurement counts only when BOTH its measured value and the target it was
 * recorded against are present and valid. A value without its own target cannot be
 * judged, and inventing the block's current target for it would silently rewrite
 * history — so such a stone is excluded from that quantity rather than repaired.
 */
export function isTimeMeasuredShot(shot: Shot): shot is TimeMeasuredShot {
  return isValidQuantityValue(shot.releaseTime) && isValidQuantityValue(shot.targetTime);
}

export function isSpeedMeasuredShot(shot: Shot): shot is SpeedMeasuredShot {
  return isValidQuantityValue(shot.speed) && isValidQuantityValue(shot.targetSpeed);
}

export function shotMeasures(shot: Shot, quantity: MeasuredQuantity): boolean {
  return quantity === "time" ? isTimeMeasuredShot(shot) : isSpeedMeasuredShot(shot);
}

/**
 * The time-measured subset — the denominator for every time metric. Excluding a
 * stone here is what keeps a missing time out of a time average instead of
 * contributing a fabricated 0.0s.
 */
export function timeMeasuredShots(shots: Shot[]): TimeMeasuredShot[] {
  return shots.filter(isTimeMeasuredShot);
}

/** The speed-measured subset — the independent denominator for every speed metric. */
export function speedMeasuredShots(shots: Shot[]): SpeedMeasuredShot[] {
  return shots.filter(isSpeedMeasuredShot);
}

/**
 * A recorded stone must carry at least one real measurement. A stone carrying
 * neither is never a valid saved stone — it is rejected at the recording boundary
 * and by strict persisted-state validation, never stored as an empty placeholder.
 */
export function shotHasAnyMeasurement(shot: Shot): boolean {
  return isTimeMeasuredShot(shot) || isSpeedMeasuredShot(shot);
}

/** The quantities this stone actually carries, in canonical order. */
export function shotMeasuredQuantities(shot: Shot): MeasuredQuantity[] {
  return MEASURED_QUANTITIES.filter((quantity) => shotMeasures(shot, quantity));
}

/**
 * The quantities a stone in this block is expected to carry but does not. Only
 * meaningful for a stone already saved in a block that records both; it never
 * implies the stone is invalid, only that one half is still outstanding.
 */
export function missingQuantitiesForShot(
  block: MeasurementCarrier,
  shot: Shot
): MeasuredQuantity[] {
  return resolveBlockMeasurement(block).quantities.filter(
    (quantity) => !shotMeasures(shot, quantity)
  );
}

/**
 * One stone's signed deviation for one quantity (measured minus target), or null
 * when the stone does not carry that measurement. Never returns NaN, and never
 * substitutes zero for a missing value. This is the single deviation formula — no
 * consumer re-derives it locally.
 */
export function shotDeviation(
  shot: Shot,
  quantity: MeasuredQuantity
): number | null {
  if (quantity === "time") {
    return isTimeMeasuredShot(shot) ? shot.releaseTime - shot.targetTime : null;
  }
  return isSpeedMeasuredShot(shot) ? shot.speed - shot.targetSpeed : null;
}

/** The measured value for one quantity, or null when absent. */
export function shotMeasuredValue(
  shot: Shot,
  quantity: MeasuredQuantity
): number | null {
  if (quantity === "time") return isTimeMeasuredShot(shot) ? shot.releaseTime : null;
  return isSpeedMeasuredShot(shot) ? shot.speed : null;
}

/** The target that applied to one quantity on this stone, or null when absent. */
export function shotQuantityTarget(
  shot: Shot,
  quantity: MeasuredQuantity
): number | null {
  if (quantity === "time") return isTimeMeasuredShot(shot) ? shot.targetTime : null;
  return isSpeedMeasuredShot(shot) ? shot.targetSpeed : null;
}

/**
 * Normalizes a candidate configuration into the canonical shape: quantities in
 * canonical order, duplicate-free, and carrying exactly the configuration entries
 * their listed quantities require. Returns undefined when the candidate is not a
 * usable configuration — callers must not fall back to a fabricated default.
 */
export function normalizeBlockMeasurementConfiguration(
  candidate: unknown
): BlockMeasurementConfiguration | undefined {
  if (!isPlainObject(candidate)) return undefined;

  const declared = candidate.quantities;
  if (!Array.isArray(declared) || declared.length === 0) return undefined;

  // STRICT and TOTAL. An unknown quantity, a duplicate, a configuration entry for a
  // quantity that is not declared, or a missing/malformed entry for one that is, all
  // REJECT the whole configuration. Nothing is silently filtered out or repaired:
  // quietly dropping an unrecognised quantity would downgrade data this build cannot
  // represent into data it can, and then write that downgrade back over the original.
  if (!declared.every(isMeasuredQuantity)) return undefined;
  if (new Set(declared).size !== declared.length) return undefined;

  const quantities = MEASURED_QUANTITIES.filter((quantity) =>
    declared.includes(quantity)
  );
  if (quantities.length !== declared.length) return undefined;

  const normalized: BlockMeasurementConfiguration = { quantities };

  for (const quantity of MEASURED_QUANTITIES) {
    const entry = candidate[quantity];
    const isDeclared = quantities.includes(quantity);

    if (!isDeclared) {
      // A configuration carrying an entry it does not declare is contradictory.
      if (entry !== undefined) return undefined;
      continue;
    }

    if (!isQuantityConfiguration(entry)) return undefined;
    normalized[quantity] = {
      target: entry.target,
      tolerance: cloneQuantityTolerance(entry.tolerance),
    };
  }

  return normalized;
}
