import type { FileExportRequest } from "./platform/fileExport";
import type { Session, Shot, TrainingBlock } from "../types";
import { resolveAccuracyThresholds } from "./accuracyThresholds";
import {
  isSpeedMeasuredShot,
  isTimeMeasuredShot,
  resolveBlockMeasurement,
} from "./measurement/quantities";
import {
  categorizeDeviation,
  toleranceFromAccuracyThresholds,
} from "./measurement/tolerance";

const CSV_HEADER = [
  "session_name",
  "session_date",
  "block_name",
  "block_mode",
  "blind_target_mode",
  "variable_target_mode",
  "smart_random_min",
  "smart_random_max",
  "measurement_mode",
  "measured_quantities",
  "shot_number",
  "target_time",
  "predicted_time",
  "release_time",
  "prediction_error",
  "absolute_prediction_error",
  "target_error",
  "absolute_target_error",
  "accuracy_on_target_threshold",
  "accuracy_acceptable_threshold",
  "time_on_target_lower_tolerance",
  "time_on_target_upper_tolerance",
  "time_acceptable_lower_tolerance",
  "time_acceptable_upper_tolerance",
  "target_error_category",
  "is_major_miss",
  "target_speed",
  "speed",
  "speed_error",
  "absolute_speed_error",
  "speed_on_target_lower_tolerance",
  "speed_on_target_upper_tolerance",
  "speed_acceptable_lower_tolerance",
  "speed_acceptable_upper_tolerance",
  "speed_error_category",
  "speed_source",
  "speed_recorded_at",
  "handle",
  "shot_type",
  "measurement_source",
  "capture_sequence_id",
  "timing_result_id",
  "device_id",
  "lane_id",
  "created_at",
].join(",");

const EXPORT_PRECISION = 1000; // 3 decimal places, matching the app's error displays

function roundForExport(value: number): number {
  return Math.round(value * EXPORT_PRECISION) / EXPORT_PRECISION;
}

function quantitiesLabel(block: TrainingBlock | undefined): string {
  if (!block) return "";
  // Space-separated so the value never needs CSV quoting, and always written from
  // what the block actually measures rather than from what a row happens to carry.
  return resolveBlockMeasurement(block).quantities.join(" ");
}

function convertShotsToCsvRows(
  session: Session,
  shots: Shot[]
): string[] {
  const blockById = new Map(session.blocks.map((block) => [block.id, block]));

  return shots.map((shot) => {
    const block = blockById.get(shot.blockId);
    const measurement = block ? resolveBlockMeasurement(block) : undefined;

    // Every column below is written only when the stone genuinely carries the
    // measurement it describes. A missing value exports as an empty field — never
    // as 0, which a spreadsheet would silently average as a real measurement.
    const hasTime = isTimeMeasuredShot(shot);
    const hasSpeed = isSpeedMeasuredShot(shot);

    const predictionError =
      hasTime && shot.predictedTime !== undefined
        ? roundForExport(shot.predictedTime - shot.releaseTime)
        : "";

    const absolutePredictionError =
      hasTime && shot.predictedTime !== undefined
        ? roundForExport(Math.abs(shot.predictedTime - shot.releaseTime))
        : "";

    const targetError = hasTime
      ? roundForExport(shot.releaseTime - shot.targetTime)
      : "";
    const absoluteTargetError = hasTime
      ? roundForExport(Math.abs(shot.releaseTime - shot.targetTime))
      : "";

    // Uses the shot's own block's tolerance snapshot — never the app's current
    // default — so a historical shot's category never drifts when defaults change
    // later. A statistical boxplot outlier (1.5x IQR) is a separate concept and is
    // never exported here (see src/lib/boxPlotStatistics.ts) — this is only the
    // fachlicher category. A block carrying an asymmetric tolerance is classified
    // per side; the two legacy threshold columns stay exactly as they always were.
    const thresholds = resolveAccuracyThresholds(block?.accuracyThresholds);
    const timeTolerance =
      measurement?.time?.tolerance ?? toleranceFromAccuracyThresholds(thresholds);
    const targetErrorCategory = hasTime
      ? categorizeDeviation(shot.releaseTime - shot.targetTime, timeTolerance)
      : "";

    const speedTolerance = measurement?.speed?.tolerance;
    const speedError = hasSpeed ? roundForExport(shot.speed - shot.targetSpeed) : "";
    const absoluteSpeedError = hasSpeed
      ? roundForExport(Math.abs(shot.speed - shot.targetSpeed))
      : "";
    const speedErrorCategory =
      hasSpeed && speedTolerance
        ? categorizeDeviation(shot.speed - shot.targetSpeed, speedTolerance)
        : "";

    return [
      session.title,
      new Date(session.date).toLocaleDateString(),
      block?.name ?? "",
      block?.mode ?? "",
      block?.blindTargetMode ?? "",
      block?.variableTargetMode ?? "",
      block?.smartRandomMin ?? "",
      block?.smartRandomMax ?? "",
      block?.measurementMode ?? "",
      quantitiesLabel(block),
      shot.shotNumber,
      shot.targetTime ?? "",
      shot.predictedTime ?? "",
      shot.releaseTime ?? "",
      predictionError,
      absolutePredictionError,
      targetError,
      absoluteTargetError,
      // The two legacy symmetric columns are kept exactly as they always were. They
      // cannot represent an asymmetric tolerance, so the four per-side columns beside
      // them are what a reader must use to interpret an asymmetric classification.
      thresholds.onTarget,
      thresholds.acceptable,
      timeTolerance.onTarget.lower,
      timeTolerance.onTarget.upper,
      timeTolerance.acceptable.lower,
      timeTolerance.acceptable.upper,
      targetErrorCategory,
      // A stone with no time has no time classification at all. Exporting `false`
      // would assert "assessed, and not a Major Miss" about a measurement that was
      // never taken, so an absent classification exports as an absent value.
      hasTime ? targetErrorCategory === "major_miss" : "",
      shot.targetSpeed ?? "",
      shot.speed ?? "",
      speedError,
      absoluteSpeedError,
      speedTolerance?.onTarget.lower ?? "",
      speedTolerance?.onTarget.upper ?? "",
      speedTolerance?.acceptable.lower ?? "",
      speedTolerance?.acceptable.upper ?? "",
      speedErrorCategory,
      shot.speedSource ?? "",
      shot.speedRecordedAt ?? "",
      shot.handle,
      shot.shotType ?? "",
      shot.measurementSource ?? "",
      shot.captureSequenceId ?? "",
      shot.timingResultId ?? "",
      shot.deviceId ?? "",
      shot.laneId ?? "",
      shot.createdAt,
    ].join(",");
  });
}

/** Pure CSV string builders — no DOM access, safe to unit test directly. */
export function buildSessionCsv(session: Session): string {
  const rows = convertShotsToCsvRows(session, session.shots);
  return [CSV_HEADER, ...rows].join("\n");
}

export function buildHistoryCsv(sessions: Session[]): string {
  const rows = sessions.flatMap((session) =>
    convertShotsToCsvRows(session, session.shots)
  );
  return [CSV_HEADER, ...rows].join("\n");
}

/**
 * Builds the delivery request for one Session's CSV.
 *
 * Serialization is unchanged — same columns, same field semantics. Only the
 * DELIVERY moved behind `src/lib/platform/fileExport.ts`, so the same bytes
 * reach a browser download on Web and a real file plus the share sheet on
 * native (Stage M3a).
 */
export function sessionCsvExport(session: Session): FileExportRequest {
  return {
    displayFileName: `${session.title.replace(/\s+/g, "_")}.csv`,
    content: buildSessionCsv(session),
    mimeType: CSV_MIME_TYPE,
    shareTitle: session.title,
  };
}

export function historyCsvExport(sessions: Session[]): FileExportRequest {
  return {
    displayFileName: "curling_session_history.csv",
    content: buildHistoryCsv(sessions),
    mimeType: CSV_MIME_TYPE,
    shareTitle: "Training history",
  };
}

export const CSV_MIME_TYPE = "text/csv;charset=utf-8;";
