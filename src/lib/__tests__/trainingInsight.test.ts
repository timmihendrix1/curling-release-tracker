import { describe, expect, it } from "vitest";
import type { Session, Shot, TrainingBlock } from "../../types";
import { STANDARD_ACCURACY_THRESHOLDS } from "../accuracyThresholds";
import type { HistoryAnalysisBlockContext } from "../historyAnalysis";
import { buildTrainingInsight } from "../trainingInsight";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function makeBlock(overrides: Partial<TrainingBlock> = {}): TrainingBlock {
  return {
    id: nextId("block"),
    name: "Block",
    mode: "fixed",
    measurementMode: "back-hog",
    targetTime: 3.75,
    createdAt: "2026-01-01T00:00:00.000Z",
    accuracyThresholds: STANDARD_ACCURACY_THRESHOLDS,
    ...overrides,
  };
}

const session: Session = {
  id: "session-1",
  title: "Session",
  notes: "",
  date: "2026-01-01T00:00:00.000Z",
  blocks: [],
  activeBlockId: "",
  shots: [],
};

function makeShot(
  blockId: string,
  releaseTime: number,
  targetTime = 3.75
): Shot {
  return {
    id: nextId("shot"),
    sessionId: session.id,
    blockId,
    shotNumber: 1,
    releaseTime,
    targetTime,
    handle: "in",
    shotType: "draw",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function entry(
  createdAt: string,
  shots: Shot[],
  block?: Partial<TrainingBlock>
): HistoryAnalysisBlockContext {
  const trainingBlock = makeBlock({ createdAt, ...block });
  return {
    block: trainingBlock,
    session,
    shots,
    thresholds: STANDARD_ACCURACY_THRESHOLDS,
  };
}

describe("buildTrainingInsight", () => {
  it("returns null with fewer than two comparable blocks with shots", () => {
    const blockId = nextId("block");
    const blocks = [
      entry("2026-01-01T00:00:00.000Z", [
        makeShot(blockId, 3.75),
        makeShot(blockId, 3.76),
        makeShot(blockId, 3.74),
      ]),
    ];

    expect(buildTrainingInsight(blocks)).toBeNull();
  });

  it("returns null when either half has too few shots to be meaningful", () => {
    const blockA = nextId("block");
    const blockB = nextId("block");
    const blocks = [
      entry("2026-01-01T00:00:00.000Z", [makeShot(blockA, 3.75)]),
      entry("2026-01-05T00:00:00.000Z", [makeShot(blockB, 3.75)]),
    ];

    expect(buildTrainingInsight(blocks)).toBeNull();
  });

  it("reports a steady message when no metric changed meaningfully", () => {
    const blockA = nextId("block");
    const closeShots = () => [
      makeShot(blockA, 3.75),
      makeShot(blockA, 3.76),
      makeShot(blockA, 3.74),
    ];
    const blocks = [
      entry("2026-01-01T00:00:00.000Z", closeShots()),
      entry("2026-01-05T00:00:00.000Z", closeShots()),
    ];

    const insight = buildTrainingInsight(blocks);
    expect(insight).not.toBeNull();
    expect(insight?.headline).toMatch(/steady/i);
  });

  it("leads with a reduced Major Miss rate ahead of smaller changes", () => {
    const blockA = nextId("block");
    const blockB = nextId("block");

    // Earlier block: mostly major misses (well beyond acceptable ±0.15s).
    const earlierShots = [
      makeShot(blockA, 4.2),
      makeShot(blockA, 4.3),
      makeShot(blockA, 4.25),
      makeShot(blockA, 3.75),
    ];
    // Recent block: on target.
    const recentShots = [
      makeShot(blockB, 3.75),
      makeShot(blockB, 3.76),
      makeShot(blockB, 3.74),
      makeShot(blockB, 3.75),
    ];

    const blocks = [
      entry("2026-01-01T00:00:00.000Z", earlierShots),
      entry("2026-01-10T00:00:00.000Z", recentShots),
    ];

    const insight = buildTrainingInsight(blocks);
    expect(insight?.headline).toMatch(/Major Miss rate has fallen/);
  });

  it("sorts unordered input chronologically by block creation date", () => {
    const blockA = nextId("block");
    const blockB = nextId("block");

    const earlierShots = [
      makeShot(blockA, 4.2),
      makeShot(blockA, 4.3),
      makeShot(blockA, 4.25),
    ];
    const recentShots = [
      makeShot(blockB, 3.75),
      makeShot(blockB, 3.76),
      makeShot(blockB, 3.74),
    ];

    // Passed newest-first, as TrackerApp's sessionHistory would.
    const blocks = [
      entry("2026-01-10T00:00:00.000Z", recentShots),
      entry("2026-01-01T00:00:00.000Z", earlierShots),
    ];

    const insight = buildTrainingInsight(blocks);
    expect(insight?.headline).toMatch(/Major Miss rate has fallen/);
  });
});
