import { describe, expect, it } from "vitest";
import { getAllPlannedShots } from "../progress";
import {
  buildReleaseTimeCoreAssessmentV1,
  findOfficialAssessmentTemplate,
  OFFICIAL_ASSESSMENT_TEMPLATES,
  RELEASE_TIME_CORE_ASSESSMENT_V1,
} from "../templates";
import { validateAssessmentTemplate } from "../templateValidation";

describe("Release Time Core Assessment v1", () => {
  it("passes generic template validation", () => {
    expect(validateAssessmentTemplate(RELEASE_TIME_CORE_ASSESSMENT_V1)).toEqual({ valid: true });
  });

  it("has the correct identity", () => {
    expect(RELEASE_TIME_CORE_ASSESSMENT_V1.name).toBe("Release Time Core Assessment");
    expect(RELEASE_TIME_CORE_ASSESSMENT_V1.version).toBe(1);
    expect(RELEASE_TIME_CORE_ASSESSMENT_V1.type).toBe("official");
    expect(RELEASE_TIME_CORE_ASSESSMENT_V1.status).toBe("published");
    expect(RELEASE_TIME_CORE_ASSESSMENT_V1.measurementMode).toBe("back-hog");
    expect(RELEASE_TIME_CORE_ASSESSMENT_V1.shotType).toBe("draw");
    expect(RELEASE_TIME_CORE_ASSESSMENT_V1.estimatedDurationMinutes).toEqual({ min: 25, max: 35 });
  });

  it("has exactly 6 warm-up shots", () => {
    expect(RELEASE_TIME_CORE_ASSESSMENT_V1.warmupShots).toHaveLength(6);
  });

  it("has exactly 4 blocks", () => {
    expect(RELEASE_TIME_CORE_ASSESSMENT_V1.blocks).toHaveLength(4);
  });

  it("has exactly 32 scored shots", () => {
    const scoredShots = RELEASE_TIME_CORE_ASSESSMENT_V1.blocks.flatMap((block) => block.plannedShots);
    expect(scoredShots).toHaveLength(32);
  });

  it("has exactly 16 In and 16 Out scored shots", () => {
    const scoredShots = RELEASE_TIME_CORE_ASSESSMENT_V1.blocks.flatMap((block) => block.plannedShots);
    expect(scoredShots.filter((shot) => shot.expectedHandle === "in")).toHaveLength(16);
    expect(scoredShots.filter((shot) => shot.expectedHandle === "out")).toHaveLength(16);
  });

  it("has the exact warm-up sequence", () => {
    const sequence = RELEASE_TIME_CORE_ASSESSMENT_V1.warmupShots.map((shot) => [shot.targetTime, shot.expectedHandle]);
    expect(sequence).toEqual([
      [3.75, "in"],
      [3.75, "out"],
      [4.0, "in"],
      [4.0, "out"],
      [3.5, "in"],
      [3.5, "out"],
    ]);
    expect(RELEASE_TIME_CORE_ASSESSMENT_V1.warmupShots.every((shot) => shot.phase === "warmup")).toBe(true);
  });

  it("has the exact Block 1 (Medium Reproduction) sequence", () => {
    const [block1] = RELEASE_TIME_CORE_ASSESSMENT_V1.blocks;
    expect(block1.name).toBe("Medium Reproduction");
    expect(block1.plannedShots.map((shot) => [shot.targetTime, shot.expectedHandle])).toEqual([
      [3.75, "in"],
      [3.75, "out"],
      [3.75, "in"],
      [3.75, "out"],
      [3.75, "in"],
      [3.75, "out"],
      [3.75, "in"],
      [3.75, "out"],
    ]);
  });

  it("has the exact Block 2 (Slow Reproduction) sequence", () => {
    const [, block2] = RELEASE_TIME_CORE_ASSESSMENT_V1.blocks;
    expect(block2.name).toBe("Slow Reproduction");
    expect(block2.plannedShots.map((shot) => [shot.targetTime, shot.expectedHandle])).toEqual([
      [4.0, "out"],
      [4.0, "in"],
      [4.0, "out"],
      [4.0, "in"],
      [4.0, "out"],
      [4.0, "in"],
      [4.0, "out"],
      [4.0, "in"],
    ]);
  });

  it("has the exact Block 3 (Fast Reproduction) sequence", () => {
    const [, , block3] = RELEASE_TIME_CORE_ASSESSMENT_V1.blocks;
    expect(block3.name).toBe("Fast Reproduction");
    expect(block3.plannedShots.map((shot) => [shot.targetTime, shot.expectedHandle])).toEqual([
      [3.5, "in"],
      [3.5, "out"],
      [3.5, "in"],
      [3.5, "out"],
      [3.5, "in"],
      [3.5, "out"],
      [3.5, "in"],
      [3.5, "out"],
    ]);
  });

  it("has the exact Block 4 (Variable Adaptation) sequence", () => {
    const [, , , block4] = RELEASE_TIME_CORE_ASSESSMENT_V1.blocks;
    expect(block4.name).toBe("Variable Adaptation");
    expect(block4.plannedShots.map((shot) => [shot.targetTime, shot.expectedHandle])).toEqual([
      [3.75, "in"],
      [4.0, "out"],
      [3.5, "in"],
      [4.0, "out"],
      [3.5, "out"],
      [3.75, "in"],
      [4.0, "in"],
      [3.5, "out"],
    ]);
  });

  it("orders blocks Medium, Slow, Fast, Variable Adaptation", () => {
    expect(RELEASE_TIME_CORE_ASSESSMENT_V1.blocks.map((block) => block.name)).toEqual([
      "Medium Reproduction",
      "Slow Reproduction",
      "Fast Reproduction",
      "Variable Adaptation",
    ]);
    RELEASE_TIME_CORE_ASSESSMENT_V1.blocks.forEach((block, index) => {
      expect(block.sequenceIndex).toBe(index);
    });
  });

  it("has unique block IDs and unique planned shot IDs", () => {
    const blockIds = RELEASE_TIME_CORE_ASSESSMENT_V1.blocks.map((block) => block.id);
    expect(new Set(blockIds).size).toBe(blockIds.length);

    const allShots = getAllPlannedShots(RELEASE_TIME_CORE_ASSESSMENT_V1);
    const shotIds = allShots.map((shot) => shot.id);
    expect(new Set(shotIds).size).toBe(shotIds.length);
  });

  it("has a contiguous, gap-free global sequence across warm-up + all blocks", () => {
    const allShots = getAllPlannedShots(RELEASE_TIME_CORE_ASSESSMENT_V1);
    expect(allShots).toHaveLength(38);
    allShots.forEach((shot, index) => expect(shot.sequenceIndex).toBe(index));
  });

  it("is deterministic across independently-built instances (no randomization)", () => {
    const first = buildReleaseTimeCoreAssessmentV1();
    const second = buildReleaseTimeCoreAssessmentV1();
    expect(first).toEqual(second);
    expect(first).toEqual(RELEASE_TIME_CORE_ASSESSMENT_V1);
  });

  it("is frozen (cannot be mutated at runtime)", () => {
    expect(() => {
      RELEASE_TIME_CORE_ASSESSMENT_V1.name = "Tampered";
    }).toThrow();
    expect(() => {
      RELEASE_TIME_CORE_ASSESSMENT_V1.blocks.push(RELEASE_TIME_CORE_ASSESSMENT_V1.blocks[0]);
    }).toThrow();
  });

  it("is discoverable via findOfficialAssessmentTemplate", () => {
    expect(findOfficialAssessmentTemplate("release-time-core-assessment-v1", 1)).toBe(
      RELEASE_TIME_CORE_ASSESSMENT_V1
    );
    expect(findOfficialAssessmentTemplate("release-time-core-assessment-v1", 2)).toBeUndefined();
    expect(findOfficialAssessmentTemplate("unknown-template", 1)).toBeUndefined();
  });

  it("is included in OFFICIAL_ASSESSMENT_TEMPLATES", () => {
    expect(OFFICIAL_ASSESSMENT_TEMPLATES).toContain(RELEASE_TIME_CORE_ASSESSMENT_V1);
  });
});
