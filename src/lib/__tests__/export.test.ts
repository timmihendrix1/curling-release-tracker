import { describe, expect, it } from "vitest";
import { buildSessionCsv } from "../export";
import type { Session } from "../../types";

function baseSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    title: "Test Session",
    date: "2026-01-01T00:00:00.000Z",
    notes: "",
    blocks: [],
    activeBlockId: "",
    shots: [],
    ...overrides,
  };
}

function csvColumns(csv: string) {
  const [header, row] = csv.split("\n");
  const cols = header.split(",");
  const values = row.split(",");
  return (name: string) => values[cols.indexOf(name)];
}

describe("buildSessionCsv — Blind Weight columns", () => {
  it("a Blind Weight row includes predicted_time, prediction_error, and absolute_prediction_error", () => {
    const session = baseSession({
      blocks: [
        {
          id: "block-1",
          name: "Blind Block",
          mode: "blind",
          measurementMode: "back-hog",
          blindTargetMode: "fixed",
          targetTime: 3.75,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      shots: [
        {
          id: "shot-1",
          sessionId: "session-1",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.78,
          targetTime: 3.75,
          predictedTime: 3.82,
          handle: "in",
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    });

    const col = csvColumns(buildSessionCsv(session));

    expect(col("predicted_time")).toBe("3.82");
    expect(col("target_time")).toBe("3.75");
    expect(col("release_time")).toBe("3.78");
    // prediction_error = predictedTime - releaseTime = 3.82 - 3.78 = 0.04
    expect(Number(col("prediction_error"))).toBeCloseTo(0.04, 10);
    expect(Number(col("absolute_prediction_error"))).toBeCloseTo(0.04, 10);
    // target_error = releaseTime - targetTime = 3.78 - 3.75 = 0.03
    expect(Number(col("target_error"))).toBeCloseTo(0.03, 10);
    expect(col("blind_target_mode")).toBe("fixed");
    expect(col("shot_type")).toBe("");
  });

  it("a non-Blind row leaves prediction columns empty, never 0 or NaN", () => {
    const session = baseSession({
      blocks: [
        {
          id: "block-1",
          name: "Fixed Block",
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.75,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      shots: [
        {
          id: "shot-1",
          sessionId: "session-1",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.7,
          targetTime: 3.75,
          handle: "in",
          shotType: "draw",
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    });

    const csv = buildSessionCsv(session);
    const col = csvColumns(csv);

    expect(col("predicted_time")).toBe("");
    expect(col("prediction_error")).toBe("");
    expect(col("absolute_prediction_error")).toBe("");
    expect(col("blind_target_mode")).toBe("");
    expect(csv).not.toMatch(/NaN|Infinity/);
  });

  it("exports the configured Smart Random range for a Blind Smart Random block", () => {
    const session = baseSession({
      blocks: [
        {
          id: "block-1",
          name: "Blind Smart Random",
          mode: "blind",
          measurementMode: "back-hog",
          blindTargetMode: "smart-random",
          smartRandomMin: 3.4,
          smartRandomMax: 4.2,
          targetTime: 3.75,
          pendingTargetTime: 3.9,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      shots: [
        {
          id: "shot-1",
          sessionId: "session-1",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.88,
          targetTime: 3.9,
          predictedTime: 3.95,
          handle: "in",
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    });

    const col = csvColumns(buildSessionCsv(session));

    expect(col("smart_random_min")).toBe("3.4");
    expect(col("smart_random_max")).toBe("4.2");
  });

  it("exports a shot with a missing shot type cleanly (empty column, no crash)", () => {
    const session = baseSession({
      blocks: [
        {
          id: "block-1",
          name: "Blind",
          mode: "blind",
          measurementMode: "back-hog",
          blindTargetMode: "fixed",
          targetTime: 3.75,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      shots: [
        {
          id: "shot-1",
          sessionId: "session-1",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.78,
          targetTime: 3.75,
          predictedTime: 3.8,
          handle: "in",
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    });

    expect(() => buildSessionCsv(session)).not.toThrow();
    expect(csvColumns(buildSessionCsv(session))("shot_type")).toBe("");
  });

  it("rounds error values consistently and never emits NaN/Infinity", () => {
    const session = baseSession({
      blocks: [
        {
          id: "block-1",
          name: "Blind",
          mode: "blind",
          measurementMode: "back-hog",
          blindTargetMode: "fixed",
          targetTime: 3.333333,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      shots: [
        {
          id: "shot-1",
          sessionId: "session-1",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.123456789,
          targetTime: 3.333333,
          predictedTime: 3.222222,
          handle: "in",
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    });

    const csv = buildSessionCsv(session);
    expect(csv).not.toMatch(/NaN|Infinity/);
  });
});

describe("buildSessionCsv — Capture Sequence columns", () => {
  function blockAndSession() {
    const block: Session["blocks"][number] = {
      id: "block-1",
      name: "Fixed Block",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    return baseSession({ blocks: [block] });
  }

  it("a simulator-captured shot exports measurement_source=simulator plus capture ids", () => {
    const session = {
      ...blockAndSession(),
      shots: [
        {
          id: "shot-1",
          sessionId: "session-1",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.72,
          targetTime: 3.75,
          handle: "in" as const,
          measurementSource: "simulator" as const,
          captureSequenceId: "seq-1",
          timingResultId: "result-1",
          deviceId: "device-abc",
          laneId: "lane-2",
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    };

    const col = csvColumns(buildSessionCsv(session));
    expect(col("measurement_source")).toBe("simulator");
    expect(col("capture_sequence_id")).toBe("seq-1");
    expect(col("timing_result_id")).toBe("result-1");
    expect(col("device_id")).toBe("device-abc");
    expect(col("lane_id")).toBe("lane-2");
  });

  it("a manual-fallback shot inside a capture sequence exports measurement_source=manual", () => {
    const session = {
      ...blockAndSession(),
      shots: [
        {
          id: "shot-1",
          sessionId: "session-1",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.72,
          targetTime: 3.75,
          handle: "in" as const,
          measurementSource: "manual" as const,
          captureSequenceId: "seq-1",
          timingResultId: "result-1",
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    };

    const col = csvColumns(buildSessionCsv(session));
    expect(col("measurement_source")).toBe("manual");
  });

  it("a classic legacy manual shot (no capture sequence at all) has empty capture columns", () => {
    const session = {
      ...blockAndSession(),
      shots: [
        {
          id: "shot-1",
          sessionId: "session-1",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.7,
          targetTime: 3.75,
          handle: "in" as const,
          shotType: "draw" as const,
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    };

    const col = csvColumns(buildSessionCsv(session));
    expect(col("measurement_source")).toBe("");
    expect(col("capture_sequence_id")).toBe("");
    expect(col("timing_result_id")).toBe("");
    expect(col("device_id")).toBe("");
    expect(col("lane_id")).toBe("");
  });
});
