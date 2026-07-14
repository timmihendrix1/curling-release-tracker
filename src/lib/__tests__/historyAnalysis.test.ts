import { describe, expect, it } from "vitest";
import type { Session, Shot, TrainingBlock } from "../../types";
import { STANDARD_ACCURACY_THRESHOLDS, TIGHT_ACCURACY_THRESHOLDS } from "../accuracyThresholds";
import {
  aggregateTargetAccuracyAcrossBlocks,
  buildHistoryAnalysisContext,
  createDefaultHistoryFilters,
  getAvailableMeasurementModes,
  getAvailableTrainingCategories,
  resolveDefaultMeasurementMode,
  resolveDefaultTrainingCategory,
  sanitizeHistoryFilters,
  sanitizeThresholdComparisonMode,
  type HistoryAnalysisFilters,
} from "../historyAnalysis";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// Test fixtures use fixed historical dates — the default filter's "Last 90
// days" preset is relative to the real clock, so tests that aren't
// specifically about Date Range filtering opt out of it via "all time".
function baseFilters(): HistoryAnalysisFilters {
  return {
    ...createDefaultHistoryFilters(),
    dateRange: { preset: "all" },
  };
}

function makeBlock(overrides: Partial<TrainingBlock> = {}): TrainingBlock {
  return {
    id: nextId("block"),
    name: "Block",
    mode: "fixed",
    measurementMode: "back-hog",
    targetTime: 3.75,
    createdAt: "2026-01-15T00:00:00.000Z",
    accuracyThresholds: STANDARD_ACCURACY_THRESHOLDS,
    ...overrides,
  };
}

function makeShot(blockId: string, overrides: Partial<Shot> = {}): Shot {
  return {
    id: nextId("shot"),
    sessionId: "session",
    blockId,
    shotNumber: 1,
    releaseTime: 3.75,
    targetTime: 3.75,
    handle: "in",
    shotType: "draw",
    createdAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

function makeSession(
  blocks: TrainingBlock[],
  shots: Shot[],
  overrides: Partial<Session> = {}
): Session {
  return {
    id: nextId("session"),
    title: "Session",
    date: blocks[0]?.createdAt ?? "2026-01-15T00:00:00.000Z",
    blocks,
    activeBlockId: blocks[blocks.length - 1]?.id ?? "",
    shots,
    ...overrides,
  };
}

describe("historyAnalysis filter pipeline", () => {
  it("filters by Training Category", () => {
    const fixedBlock = makeBlock({ mode: "fixed" });
    const variableBlock = makeBlock({ mode: "variable" });
    const session = makeSession(
      [fixedBlock, variableBlock],
      [makeShot(fixedBlock.id), makeShot(variableBlock.id)]
    );

    const filters: HistoryAnalysisFilters = {
      ...baseFilters(),
      trainingCategory: "fixed",
    };

    const context = buildHistoryAnalysisContext([session], filters);

    expect(context.blocks).toHaveLength(1);
    expect(context.blocks[0].block.id).toBe(fixedBlock.id);
  });

  it("filters by Measurement Mode and never mixes Back-Hog with Hog-Hog", () => {
    const backHogBlock = makeBlock({ measurementMode: "back-hog" });
    const hogHogBlock = makeBlock({ measurementMode: "hog-hog" });
    const session = makeSession(
      [backHogBlock, hogHogBlock],
      [makeShot(backHogBlock.id), makeShot(hogHogBlock.id)]
    );

    const filters: HistoryAnalysisFilters = {
      ...baseFilters(),
      measurementMode: "back-hog",
    };

    const context = buildHistoryAnalysisContext([session], filters);

    expect(context.blocks.map((entry) => entry.block.id)).toEqual([
      backHogBlock.id,
    ]);
    expect(
      context.blocks.every((entry) => entry.block.measurementMode === "back-hog")
    ).toBe(true);
  });

  it("filters by Date Range", () => {
    const oldBlock = makeBlock({ createdAt: "2020-01-01T00:00:00.000Z" });
    const recentBlock = makeBlock({ createdAt: new Date().toISOString() });
    const session = makeSession(
      [oldBlock, recentBlock],
      [makeShot(oldBlock.id), makeShot(recentBlock.id)]
    );

    const filters: HistoryAnalysisFilters = {
      ...baseFilters(),
      dateRange: { preset: "30d" },
    };

    const context = buildHistoryAnalysisContext([session], filters);

    expect(context.blocks).toHaveLength(1);
    expect(context.blocks[0].block.id).toBe(recentBlock.id);
  });

  it("filters shots by Handle", () => {
    const block = makeBlock();
    const shots = [
      makeShot(block.id, { handle: "in" }),
      makeShot(block.id, { handle: "out" }),
    ];
    const session = makeSession([block], shots);

    const filters: HistoryAnalysisFilters = {
      ...baseFilters(),
      handles: ["in"],
    };

    const context = buildHistoryAnalysisContext([session], filters);

    expect(context.shots).toHaveLength(1);
    expect(context.shots[0].handle).toBe("in");
  });

  it("treats an unclassified handle correctly (never coerced to a real handle)", () => {
    const block = makeBlock();
    const shots = [
      makeShot(block.id, { handle: "in" }),
      makeShot(block.id, { handle: "out" }),
    ];
    const session = makeSession([block], shots);

    const context = buildHistoryAnalysisContext([session], baseFilters());

    expect(context.availableHandles.sort()).toEqual(["in", "out"]);
  });

  it("filters shots by Shot Type, excluding unclassified (Blind Weight) shots from an explicit filter", () => {
    const block = makeBlock({ mode: "blind" });
    const shots = [
      makeShot(block.id, { shotType: "draw" }),
      makeShot(block.id, { shotType: "takeout" }),
      makeShot(block.id, { shotType: undefined }),
    ];
    const session = makeSession([block], shots);

    const filters: HistoryAnalysisFilters = {
      ...baseFilters(),
      shotTypes: ["draw"],
    };

    const context = buildHistoryAnalysisContext([session], filters);

    expect(context.shots).toHaveLength(1);
    expect(context.shots[0].shotType).toBe("draw");
  });

  it("filters by Session and Block ids", () => {
    const blockA = makeBlock();
    const blockB = makeBlock();
    const sessionA = makeSession([blockA], [makeShot(blockA.id)]);
    const sessionB = makeSession([blockB], [makeShot(blockB.id)]);

    const filters: HistoryAnalysisFilters = {
      ...baseFilters(),
      sessionIds: [sessionA.id],
    };

    const context = buildHistoryAnalysisContext([sessionA, sessionB], filters);

    expect(context.blocks).toHaveLength(1);
    expect(context.blocks[0].session.id).toBe(sessionA.id);

    const blockFilters: HistoryAnalysisFilters = {
      ...baseFilters(),
      blockIds: [blockB.id],
    };
    const blockContext = buildHistoryAnalysisContext(
      [sessionA, sessionB],
      blockFilters
    );
    expect(blockContext.blocks.map((entry) => entry.block.id)).toEqual([
      blockB.id,
    ]);
  });

  it("filters shots by Target Range", () => {
    const block = makeBlock({ mode: "variable" });
    const shots = [
      makeShot(block.id, { targetTime: 2.5 }),
      makeShot(block.id, { targetTime: 3.5 }),
      makeShot(block.id, { targetTime: 4.5 }),
    ];
    const session = makeSession([block], shots);

    const filters: HistoryAnalysisFilters = {
      ...baseFilters(),
      targetRange: { min: 3, max: 4 },
    };

    const context = buildHistoryAnalysisContext([session], filters);

    expect(context.shots).toHaveLength(1);
    expect(context.shots[0].targetTime).toBe(3.5);
  });

  it("combines multiple filters correctly", () => {
    const matching = makeBlock({ mode: "fixed", measurementMode: "back-hog" });
    const wrongCategory = makeBlock({ mode: "variable", measurementMode: "back-hog" });
    const wrongMode = makeBlock({ mode: "fixed", measurementMode: "hog-hog" });
    const session = makeSession(
      [matching, wrongCategory, wrongMode],
      [
        makeShot(matching.id, { handle: "in" }),
        makeShot(matching.id, { handle: "out" }),
        makeShot(wrongCategory.id),
        makeShot(wrongMode.id),
      ]
    );

    const filters: HistoryAnalysisFilters = {
      ...baseFilters(),
      trainingCategory: "fixed",
      measurementMode: "back-hog",
      handles: ["in"],
    };

    const context = buildHistoryAnalysisContext([session], filters);

    expect(context.blocks).toHaveLength(1);
    expect(context.shots).toHaveLength(1);
    expect(context.shots[0].handle).toBe("in");
  });

  it("returns an empty, well-shaped context when nothing matches", () => {
    const block = makeBlock({ mode: "fixed" });
    const session = makeSession([block], [makeShot(block.id)]);

    const filters: HistoryAnalysisFilters = {
      ...baseFilters(),
      trainingCategory: "blind",
    };

    const context = buildHistoryAnalysisContext([session], filters);

    expect(context.blocks).toHaveLength(0);
    expect(context.shots).toHaveLength(0);
    expect(context.totalBlockCount).toBe(0);
    expect(context.totalShotCount).toBe(0);
    expect(context.availableHandles).toHaveLength(0);
  });

  it("flags when original-mode thresholds vary across selected blocks", () => {
    const blockA = makeBlock({ accuracyThresholds: STANDARD_ACCURACY_THRESHOLDS });
    const blockB = makeBlock({ accuracyThresholds: TIGHT_ACCURACY_THRESHOLDS });
    const session = makeSession(
      [blockA, blockB],
      [makeShot(blockA.id), makeShot(blockB.id)]
    );

    const context = buildHistoryAnalysisContext([session], baseFilters());

    expect(context.thresholdsVaryAcrossBlocks).toBe(true);
  });

  it("Comparison mode re-classifies shots without mutating the stored blocks", () => {
    const block = makeBlock({ accuracyThresholds: STANDARD_ACCURACY_THRESHOLDS });
    // Target error of 0.15 -> "acceptable" under Standard (0.10/0.20), but
    // "major_miss" under Tight (0.05/0.10).
    const shot = makeShot(block.id, { releaseTime: 3.9, targetTime: 3.75 });
    const session = makeSession([block], [shot]);

    const originalContext = buildHistoryAnalysisContext([session], baseFilters());
    expect(originalContext.blocks[0].thresholds).toEqual(STANDARD_ACCURACY_THRESHOLDS);

    const comparisonContext = buildHistoryAnalysisContext([session], {
      ...baseFilters(),
      thresholdComparisonMode: {
        type: "comparison",
        thresholds: TIGHT_ACCURACY_THRESHOLDS,
      },
    });
    expect(comparisonContext.blocks[0].thresholds).toEqual(TIGHT_ACCURACY_THRESHOLDS);

    // The persisted block itself is never touched.
    expect(block.accuracyThresholds).toEqual(STANDARD_ACCURACY_THRESHOLDS);
    expect(session.blocks[0].accuracyThresholds).toEqual(STANDARD_ACCURACY_THRESHOLDS);
  });
});

describe("default selection resolution", () => {
  it("auto-selects the single available Training Category", () => {
    const block = makeBlock({ mode: "variable" });
    const session = makeSession([block], [makeShot(block.id)]);

    const available = getAvailableTrainingCategories([session]);
    expect(resolveDefaultTrainingCategory(available, null)).toBe("variable");
  });

  it("keeps a valid previous Training Category when multiple exist", () => {
    const available: ("fixed" | "variable" | "blind")[] = ["fixed", "variable"];
    expect(resolveDefaultTrainingCategory(available, "variable")).toBe("variable");
  });

  it("falls back to the first available category when the previous one no longer exists", () => {
    const available: ("fixed" | "variable" | "blind")[] = ["fixed", "variable"];
    expect(resolveDefaultTrainingCategory(available, "blind")).toBe("fixed");
  });

  it("auto-selects the single available Measurement Mode", () => {
    const block = makeBlock({ measurementMode: "hog-hog" });
    const session = makeSession([block], [makeShot(block.id)]);

    const available = getAvailableMeasurementModes([session], null);
    expect(resolveDefaultMeasurementMode(available, null)).toBe("hog-hog");
  });
});

describe("aggregateTargetAccuracyAcrossBlocks", () => {
  it("categorizes each shot against its own block's thresholds, not one global threshold", () => {
    const looseBlock = makeBlock({ accuracyThresholds: STANDARD_ACCURACY_THRESHOLDS });
    const tightBlock = makeBlock({ accuracyThresholds: TIGHT_ACCURACY_THRESHOLDS });

    // Both shots have the same 0.15s target error — acceptable under Standard,
    // major miss under Tight.
    const looseShot = makeShot(looseBlock.id, { releaseTime: 3.9, targetTime: 3.75 });
    const tightShot = makeShot(tightBlock.id, { releaseTime: 3.9, targetTime: 3.75 });

    const context = buildHistoryAnalysisContext(
      [
        makeSession([looseBlock], [looseShot]),
        makeSession([tightBlock], [tightShot]),
      ],
      baseFilters()
    );

    const aggregate = aggregateTargetAccuracyAcrossBlocks(context.blocks);

    expect(aggregate.shotCount).toBe(2);
    expect(aggregate.acceptableCount).toBe(1);
    expect(aggregate.majorMissCount).toBe(1);
  });

  it("returns an empty-shaped result for no shots", () => {
    const aggregate = aggregateTargetAccuracyAcrossBlocks([]);
    expect(aggregate.shotCount).toBe(0);
    expect(aggregate.meanTargetError).toBeNull();
    expect(aggregate.onTargetRate).toBeNull();
  });
});

describe("sanitizeThresholdComparisonMode", () => {
  it("passes through a valid custom comparison mode unchanged", () => {
    const mode = sanitizeThresholdComparisonMode({
      type: "comparison",
      thresholds: { onTarget: 0.07, acceptable: 0.15 },
    });
    expect(mode).toEqual({
      type: "comparison",
      thresholds: { onTarget: 0.07, acceptable: 0.15 },
    });
  });

  it("passes through Original unchanged", () => {
    expect(sanitizeThresholdComparisonMode({ type: "original" })).toEqual({
      type: "original",
    });
  });

  it("repairs a missing value to Original", () => {
    expect(sanitizeThresholdComparisonMode(undefined)).toEqual({
      type: "original",
    });
    expect(sanitizeThresholdComparisonMode(null)).toEqual({ type: "original" });
  });

  it("repairs acceptable <= onTarget to Original", () => {
    const mode = sanitizeThresholdComparisonMode({
      type: "comparison",
      thresholds: { onTarget: 0.2, acceptable: 0.1 },
    });
    expect(mode).toEqual({ type: "original" });
  });

  it("repairs zero/negative thresholds to Original", () => {
    expect(
      sanitizeThresholdComparisonMode({
        type: "comparison",
        thresholds: { onTarget: 0, acceptable: 0.2 },
      })
    ).toEqual({ type: "original" });
    expect(
      sanitizeThresholdComparisonMode({
        type: "comparison",
        thresholds: { onTarget: -0.1, acceptable: 0.2 },
      })
    ).toEqual({ type: "original" });
  });

  it("repairs NaN/Infinity thresholds to Original", () => {
    expect(
      sanitizeThresholdComparisonMode({
        type: "comparison",
        thresholds: { onTarget: NaN, acceptable: 0.2 },
      })
    ).toEqual({ type: "original" });
    expect(
      sanitizeThresholdComparisonMode({
        type: "comparison",
        thresholds: { onTarget: 0.1, acceptable: Infinity },
      })
    ).toEqual({ type: "original" });
  });

  it("repairs a comparison mode with a missing thresholds object to Original", () => {
    expect(
      sanitizeThresholdComparisonMode({
        type: "comparison",
      } as unknown as Parameters<typeof sanitizeThresholdComparisonMode>[0])
    ).toEqual({ type: "original" });
  });
});

describe("sanitizeHistoryFilters", () => {
  it("merges a partial persisted object onto the safe default shape", () => {
    const filters = sanitizeHistoryFilters({
      trainingCategory: "variable",
    });
    expect(filters.trainingCategory).toBe("variable");
    expect(filters.dateRange).toEqual(createDefaultHistoryFilters().dateRange);
    expect(filters.thresholdComparisonMode).toEqual({ type: "original" });
  });

  it("keeps a valid persisted custom comparison mode", () => {
    const filters = sanitizeHistoryFilters({
      thresholdComparisonMode: {
        type: "comparison",
        thresholds: { onTarget: 0.08, acceptable: 0.18 },
      },
    });
    expect(filters.thresholdComparisonMode).toEqual({
      type: "comparison",
      thresholds: { onTarget: 0.08, acceptable: 0.18 },
    });
  });

  it("repairs an invalid persisted custom comparison mode instead of throwing", () => {
    const filters = sanitizeHistoryFilters({
      thresholdComparisonMode: {
        type: "comparison",
        thresholds: { onTarget: 0.2, acceptable: 0.1 },
      },
    });
    expect(filters.thresholdComparisonMode).toEqual({ type: "original" });
  });

  it("falls back to full defaults for undefined/null input", () => {
    expect(sanitizeHistoryFilters(undefined)).toEqual(createDefaultHistoryFilters());
    expect(sanitizeHistoryFilters(null)).toEqual(createDefaultHistoryFilters());
  });
});
