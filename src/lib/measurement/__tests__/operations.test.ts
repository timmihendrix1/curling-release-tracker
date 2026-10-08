import { describe, expect, it } from "vitest";
import {
  buildMeasuredShot,
  completeShotMeasurement,
  findIncompleteShots,
} from "../operations";
import {
  bothBlock,
  bothShot,
  legacyTimeBlock,
  session,
  speedBlock,
  speedShot,
  timeBlock,
  timeShot,
} from "./measurementFixtures";

describe("buildMeasuredShot", () => {
  const both = bothBlock();
  const base = {
    id: "new-shot",
    sessionId: "session-1",
    blockId: both.id,
    shotNumber: 3,
    handle: "out" as const,
    createdAt: "2026-10-06T11:00:00.000Z",
  };

  it("builds a Both stone carrying each value with its own target", () => {
    const result = buildMeasuredShot(both, {
      ...base,
      time: { value: 3.81, target: 3.75 },
      speed: { value: 2.43, target: 2.4, source: "manual" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      releaseTime: 3.81,
      targetTime: 3.75,
      speed: 2.43,
      targetSpeed: 2.4,
      speedSource: "manual",
    });
  });

  it("leaves a missing measurement genuinely absent rather than zero", () => {
    const result = buildMeasuredShot(both, { ...base, time: { value: 3.81, target: 3.75 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("speed" in result.value).toBe(false);
    expect("targetSpeed" in result.value).toBe(false);
    expect(result.value.speed).toBeUndefined();
  });

  it("builds a speed-only stone with no releaseTime, targetTime or timing interval", () => {
    const speedOnly = speedBlock();
    const result = buildMeasuredShot(speedOnly, {
      ...base,
      blockId: speedOnly.id,
      speed: { value: 2.4, target: 2.4 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("releaseTime" in result.value).toBe(false);
    expect("targetTime" in result.value).toBe(false);
  });

  it("rejects a stone with no measurement at all", () => {
    const result = buildMeasuredShot(both, base);
    expect(result).toMatchObject({ ok: false, error: { code: "no_measurement" } });
  });

  it("rejects a measurement the block does not record", () => {
    const timeOnly = timeBlock();
    const result = buildMeasuredShot(timeOnly, {
      ...base,
      blockId: timeOnly.id,
      speed: { value: 2.4, target: 2.4 },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "quantity_not_measured" } });
  });

  it("rejects a stone attributed to a different block than the one it is built for", () => {
    const result = buildMeasuredShot(both, {
      ...base,
      blockId: "some-other-block",
      speed: { value: 2.4, target: 2.4 },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "block_mismatch" } });
  });

  it("carries the time measurement's own source as the stone's time provenance", () => {
    const result = buildMeasuredShot(both, {
      ...base,
      time: { value: 3.8, target: 3.75, source: "external" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.measurementSource).toBe("external");
    expect(result.value.speedSource).toBeUndefined();
  });

  it("keeps time and speed provenance independent on one stone", () => {
    const result = buildMeasuredShot(both, {
      ...base,
      time: { value: 3.8, target: 3.75, source: "external" },
      speed: { value: 2.4, target: 2.4, source: "manual" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.measurementSource).toBe("external");
    expect(result.value.speedSource).toBe("manual");
  });

  it("rejects two different sources for the same time rather than discarding one", () => {
    const result = buildMeasuredShot(both, {
      ...base,
      time: { value: 3.8, target: 3.75, source: "external" },
      measurementSource: "simulator",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "conflicting_source" } });
  });

  it("never records a time source on a stone that carries no time", () => {
    const result = buildMeasuredShot(both, {
      ...base,
      speed: { value: 2.4, target: 2.4 },
      measurementSource: "external",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.measurementSource).toBeUndefined();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the invalid measured value %s",
    (value) => {
      const result = buildMeasuredShot(both, { ...base, time: { value, target: 3.75 } });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_value" } });
    }
  );

  it("rejects a measurement supplied without a valid target", () => {
    const result = buildMeasuredShot(both, { ...base, time: { value: 3.8, target: 0 } });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_value" } });
  });
});

describe("completeShotMeasurement", () => {
  function fixture() {
    const block = bothBlock();
    const first = timeShot(block, 3.81, { id: "stone-1", shotNumber: 1, handle: "in" });
    const second = timeShot(block, 3.7, { id: "stone-2", shotNumber: 2, handle: "out" });
    const state = session([block], [first, second]);
    return { block, first, second, state };
  }

  it("fills the missing speed on the explicitly identified stone only", () => {
    const { block, state } = fixture();
    const result = completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: block.id,
      shotId: "stone-1",
      quantity: "speed",
      value: 2.43,
      source: "manual",
      recordedAt: "2026-10-06T11:05:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const completed = result.value.session.shots.find((s) => s.id === "stone-1");
    expect(completed).toMatchObject({
      speed: 2.43,
      targetSpeed: 2.4,
      speedSource: "manual",
      speedRecordedAt: "2026-10-06T11:05:00.000Z",
    });
    // The other stone is untouched — the newest stone is never assumed.
    expect(result.value.session.shots.find((s) => s.id === "stone-2")?.speed).toBeUndefined();
  });

  it("does not add a stone, renumber, change the handle, or advance the block", () => {
    const { block, state } = fixture();
    const result = completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: block.id,
      shotId: "stone-1",
      quantity: "speed",
      value: 2.43,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.session.shots).toHaveLength(state.shots.length);
    expect(result.value.session.shots.map((s) => s.id)).toEqual(["stone-1", "stone-2"]);
    expect(result.value.session.shots.map((s) => s.shotNumber)).toEqual([1, 2]);
    expect(result.value.session.shots.map((s) => s.handle)).toEqual(["in", "out"]);
    // Blocks are returned by identity — nothing about the block advanced.
    expect(result.value.session.blocks).toBe(state.blocks);
  });

  it("preserves the stone's existing measurement, identity and creation time exactly", () => {
    const { block, state, first } = fixture();
    const result = completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: block.id,
      shotId: "stone-1",
      quantity: "speed",
      value: 2.43,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.shot).toMatchObject({
      id: first.id,
      releaseTime: first.releaseTime,
      targetTime: first.targetTime,
      createdAt: first.createdAt,
      shotNumber: first.shotNumber,
    });
  });

  it("fills a missing TIME on a speed-first stone", () => {
    const block = bothBlock();
    const stone = speedShot(block, 2.42, { id: "stone-1" });
    const state = session([block], [stone]);

    const result = completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: block.id,
      shotId: "stone-1",
      quantity: "time",
      value: 3.79,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.shot).toMatchObject({ releaseTime: 3.79, targetTime: 3.75 });
  });

  it("rejects a second completion of the same quantity — this is not history editing", () => {
    const block = bothBlock();
    const stone = bothShot(block, 3.8, 2.42, { id: "stone-1" });
    const state = session([block], [stone]);

    const result = completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: block.id,
      shotId: "stone-1",
      quantity: "speed",
      value: 2.5,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "already_recorded" } });
  });

  it("makes a duplicated retry safe: the second application is rejected, the value is unchanged", () => {
    const { block, state } = fixture();
    const input = {
      sessionId: state.id,
      blockId: block.id,
      shotId: "stone-1",
      quantity: "speed" as const,
      value: 2.43,
    };

    const first = completeShotMeasurement(state, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const replay = completeShotMeasurement(first.value.session, input);
    expect(replay).toMatchObject({ ok: false, error: { code: "already_recorded" } });
    expect(first.value.session.shots.find((s) => s.id === "stone-1")?.speed).toBe(2.43);
  });

  it("rejects a completion addressed to a different session (a delayed write after a session change)", () => {
    const { block, state } = fixture();
    const result = completeShotMeasurement(state, {
      sessionId: "22222222-2222-4222-8222-222222222222",
      blockId: block.id,
      shotId: "stone-1",
      quantity: "speed",
      value: 2.43,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "session_mismatch" } });
  });

  it("rejects a completion whose block does not own the stone", () => {
    const { state } = fixture();
    const result = completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: "some-other-block",
      shotId: "stone-1",
      quantity: "speed",
      value: 2.43,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "block_mismatch" } });
  });

  it("rejects a stale completion for a stone that is no longer present", () => {
    const { block, state } = fixture();
    const withoutFirst = { ...state, shots: state.shots.filter((s) => s.id !== "stone-1") };
    const result = completeShotMeasurement(withoutFirst, {
      sessionId: state.id,
      blockId: block.id,
      shotId: "stone-1",
      quantity: "speed",
      value: 2.43,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "shot_not_found" } });
  });

  it("rejects completing a quantity the block does not measure", () => {
    const block = timeBlock();
    const stone = timeShot(block, 3.8, { id: "stone-1" });
    const state = session([block], [stone]);
    const result = completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: block.id,
      shotId: "stone-1",
      quantity: "speed",
      value: 2.43,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "quantity_not_measured" } });
  });

  it("rejects completing a speed on a legacy time-only block", () => {
    const block = legacyTimeBlock();
    const stone = timeShot(block, 3.8, { id: "stone-1" });
    const state = session([block], [stone]);
    const result = completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: block.id,
      shotId: "stone-1",
      quantity: "speed",
      value: 2.43,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "quantity_not_measured" } });
  });

  it.each([0, -2, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the invalid completion value %s",
    (value) => {
      const { block, state } = fixture();
      const result = completeShotMeasurement(state, {
        sessionId: state.id,
        blockId: block.id,
        shotId: "stone-1",
        quantity: "speed",
        value,
      });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_value" } });
    }
  );

  it("never mutates the session it was given", () => {
    const { block, state } = fixture();
    const snapshot = JSON.stringify(state);
    completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: block.id,
      shotId: "stone-1",
      quantity: "speed",
      value: 2.43,
    });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe("findIncompleteShots", () => {
  it("reports each outstanding stone against its own identity, in recorded order", () => {
    const block = bothBlock();
    const complete = bothShot(block, 3.8, 2.42, { id: "a", shotNumber: 1 });
    const missingSpeed = timeShot(block, 3.7, { id: "b", shotNumber: 2 });
    const missingTime = speedShot(block, 2.5, { id: "c", shotNumber: 3 });
    const state = session([block], [complete, missingSpeed, missingTime]);

    expect(findIncompleteShots(state, block.id)).toEqual([
      { shot: missingSpeed, missing: ["speed"] },
      { shot: missingTime, missing: ["time"] },
    ]);
  });

  it("reports nothing for a time-only block whose stones all have times", () => {
    const block = timeBlock();
    const state = session([block], [timeShot(block, 3.8)]);
    expect(findIncompleteShots(state, block.id)).toEqual([]);
  });
});
