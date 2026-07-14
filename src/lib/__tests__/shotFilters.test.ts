import { describe, expect, it } from "vitest";
import { filterShots } from "../shotFilters";
import { analyzeShots } from "../analytics";
import type { Shot } from "../../types";

function makeShot(overrides: Partial<Shot>): Shot {
  return {
    id: overrides.id ?? Math.random().toString(36),
    sessionId: "session-1",
    blockId: "block-1",
    shotNumber: 1,
    releaseTime: 3.75,
    targetTime: 3.75,
    handle: "in",
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("filterShots — Blind Weight shots without a shotType", () => {
  const blindIn = makeShot({ id: "blind-in", handle: "in", predictedTime: 3.8 });
  const blindOut = makeShot({ id: "blind-out", handle: "out", predictedTime: 3.7 });
  const draw = makeShot({ id: "draw-1", handle: "in", shotType: "draw" });
  const takeout = makeShot({ id: "takeout-1", handle: "out", shotType: "takeout" });
  const shots = [blindIn, blindOut, draw, takeout];

  it("the default (all/all) view keeps Blind Weight shots even though they have no shotType", () => {
    const result = filterShots(shots, { handle: "all", shotType: "all" });
    expect(result).toHaveLength(4);
    expect(result).toContain(blindIn);
    expect(result).toContain(blindOut);
  });

  it("the Draw filter shows only explicit draws, never shots with a missing shotType", () => {
    const result = filterShots(shots, { handle: "all", shotType: "draw" });
    expect(result).toEqual([draw]);
  });

  it("the Takeout filter shows only explicit takeouts", () => {
    const result = filterShots(shots, { handle: "all", shotType: "takeout" });
    expect(result).toEqual([takeout]);
  });

  it("the Handle filter still applies to Blind Weight shots", () => {
    const inOnly = filterShots(shots, { handle: "in", shotType: "all" });
    expect(inOnly).toEqual([blindIn, draw]);

    const outOnly = filterShots(shots, { handle: "out", shotType: "all" });
    expect(outOnly).toEqual([blindOut, takeout]);
  });

  it("the Handle filter feeds through into prediction analytics", () => {
    const inOnly = filterShots(shots, { handle: "in", shotType: "all" });
    const analysis = analyzeShots(inOnly);

    // Only blindIn has a predictedTime among the "in" shots.
    expect(analysis.prediction.count).toBe(1);
  });
});
