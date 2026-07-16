import type { Session, Shot } from "../types";
import { categorizeTargetError, resolveAccuracyThresholds } from "./accuracyThresholds";

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
  "target_error_category",
  "is_major_miss",
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

function convertShotsToCsvRows(
  session: Session,
  shots: Shot[]
): string[] {
  const blockById = new Map(session.blocks.map((block) => [block.id, block]));

  return shots.map((shot) => {
    const block = blockById.get(shot.blockId);

    const predictionError =
      shot.predictedTime !== undefined
        ? roundForExport(shot.predictedTime - shot.releaseTime)
        : "";

    const absolutePredictionError =
      shot.predictedTime !== undefined
        ? roundForExport(Math.abs(shot.predictedTime - shot.releaseTime))
        : "";

    const targetError = roundForExport(shot.releaseTime - shot.targetTime);
    const absoluteTargetError = roundForExport(
      Math.abs(shot.releaseTime - shot.targetTime)
    );

    // Uses the shot's own block's threshold snapshot — never the app's
    // current default — so a historical shot's category never drifts when
    // defaults change later. A statistical boxplot outlier (1.5x IQR) is a
    // separate concept and is never exported here (see
    // src/lib/boxPlotStatistics.ts) — this is only the fachlicher category.
    const thresholds = resolveAccuracyThresholds(block?.accuracyThresholds);
    const targetErrorCategory = categorizeTargetError(
      Math.abs(shot.releaseTime - shot.targetTime),
      thresholds
    );

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
      shot.shotNumber,
      shot.targetTime,
      shot.predictedTime ?? "",
      shot.releaseTime,
      predictionError,
      absolutePredictionError,
      targetError,
      absoluteTargetError,
      thresholds.onTarget,
      thresholds.acceptable,
      targetErrorCategory,
      targetErrorCategory === "major_miss",
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

export function exportSessionToCsv(session: Session) {
  downloadCsv(
    buildSessionCsv(session),
    `${session.title.replace(/\s+/g, "_")}.csv`
  );
}

export function exportHistoryToCsv(sessions: Session[]) {
  downloadCsv(buildHistoryCsv(sessions), "curling_session_history.csv");
}

/** Exported so other domains (e.g. src/lib/assessment/export.ts) can reuse this download mechanics without duplicating it. */
export function downloadCsv(content: string, fileName: string) {
  const blob = new Blob([content], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.setAttribute("download", fileName);

  document.body.appendChild(link);

  link.click();

  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
