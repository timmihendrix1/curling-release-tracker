import { describe, expect, it } from "vitest";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../templates";
import { validateAssessmentTemplate } from "../templateValidation";
import type { AssessmentTemplate } from "../types";

function cloneTemplate(): AssessmentTemplate {
  return JSON.parse(JSON.stringify(RELEASE_TIME_CORE_ASSESSMENT_V1)) as AssessmentTemplate;
}

function issueCodes(result: ReturnType<typeof validateAssessmentTemplate>): string[] {
  return result.valid ? [] : result.issues.map((issue) => issue.code);
}

describe("validateAssessmentTemplate", () => {
  it("accepts the official v1 template unchanged", () => {
    expect(validateAssessmentTemplate(cloneTemplate())).toEqual({ valid: true });
  });

  it("rejects a non-positive version", () => {
    const template = cloneTemplate();
    template.version = 0;
    expect(issueCodes(validateAssessmentTemplate(template))).toContain("invalid_version");
  });

  it("rejects duplicate block IDs", () => {
    const template = cloneTemplate();
    template.blocks[1].id = template.blocks[0].id;
    expect(issueCodes(validateAssessmentTemplate(template))).toContain("duplicate_block_id");
  });

  it("rejects duplicate planned shot IDs", () => {
    const template = cloneTemplate();
    template.blocks[0].plannedShots[1].id = template.blocks[0].plannedShots[0].id;
    expect(issueCodes(validateAssessmentTemplate(template))).toContain("duplicate_planned_shot_id");
  });

  it("rejects a gap in the global sequence index", () => {
    const template = cloneTemplate();
    template.blocks[3].plannedShots[7].sequenceIndex += 10;
    expect(issueCodes(validateAssessmentTemplate(template))).toContain("sequence_gap_or_duplicate");
  });

  it("rejects an invalid measurement mode", () => {
    const template = cloneTemplate();
    // @ts-expect-error deliberately invalid for this test
    template.warmupShots[0].measurementMode = "not-a-mode";
    expect(issueCodes(validateAssessmentTemplate(template))).toContain("invalid_measurement_mode");
  });

  it("rejects an invalid shot type", () => {
    const template = cloneTemplate();
    // @ts-expect-error deliberately invalid for this test
    template.warmupShots[0].shotType = "not-a-shot-type";
    expect(issueCodes(validateAssessmentTemplate(template))).toContain("invalid_shot_type");
  });

  it("rejects a non-positive target time", () => {
    const template = cloneTemplate();
    template.blocks[0].plannedShots[0].targetTime = 0;
    expect(issueCodes(validateAssessmentTemplate(template))).toContain("non_positive_target_time");
  });

  it("rejects a missing/invalid expected handle", () => {
    const template = cloneTemplate();
    // @ts-expect-error deliberately invalid for this test
    template.blocks[0].plannedShots[0].expectedHandle = "sideways";
    expect(issueCodes(validateAssessmentTemplate(template))).toContain("missing_expected_handle");
  });

  it("rejects a scored shot claiming to be warm-up phase", () => {
    const template = cloneTemplate();
    template.blocks[0].plannedShots[0].phase = "warmup";
    expect(issueCodes(validateAssessmentTemplate(template))).toContain("warmup_scored_not_separated");
  });

  it("rejects a shot whose blockId doesn't match the block it's listed under", () => {
    const template = cloneTemplate();
    template.blocks[0].plannedShots[0].blockId = template.blocks[1].id;
    expect(issueCodes(validateAssessmentTemplate(template))).toContain("shot_outside_block");
  });

  it("rejects a warm-up shot that declares a blockId", () => {
    const template = cloneTemplate();
    template.warmupShots[0].blockId = template.blocks[0].id;
    expect(issueCodes(validateAssessmentTemplate(template))).toContain("shot_outside_block");
  });

  it("rejects an inconsistent block sequenceIndex ordering", () => {
    const template = cloneTemplate();
    template.blocks[0].sequenceIndex = 5;
    expect(issueCodes(validateAssessmentTemplate(template))).toContain("block_sequence_inconsistent");
  });

  it("rejects a published Official template with a block that has no planned shots", () => {
    const template = cloneTemplate();
    template.blocks[0].plannedShots = [];
    expect(issueCodes(validateAssessmentTemplate(template))).toContain("published_official_incomplete");
  });
});
