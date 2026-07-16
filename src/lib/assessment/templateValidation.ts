// Structural validation of an AssessmentTemplate. Pure, no I/O, no
// UI-specific strings — see docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md
// section 9. Run once at module import time for the official v1 template
// (see templates.ts), not on every render.
import type { Handle, MeasurementMode, ShotType } from "../../types";
import type { AssessmentTemplate, PlannedAssessmentShot } from "./types";

const VALID_HANDLES: Handle[] = ["in", "out"];
const VALID_SHOT_TYPES: ShotType[] = ["draw", "takeout"];
const VALID_MEASUREMENT_MODES: MeasurementMode[] = ["back-hog", "hog-hog"];

export type TemplateValidationIssueCode =
  | "invalid_version"
  | "duplicate_block_id"
  | "duplicate_planned_shot_id"
  | "invalid_sequence_index"
  | "sequence_gap_or_duplicate"
  | "invalid_measurement_mode"
  | "invalid_shot_type"
  | "non_positive_target_time"
  | "missing_expected_handle"
  | "shot_outside_block"
  | "warmup_scored_not_separated"
  | "block_sequence_inconsistent"
  | "published_official_incomplete";

export type TemplateValidationIssue = {
  code: TemplateValidationIssueCode;
  message: string;
};

export type TemplateValidationResult =
  | { valid: true }
  | { valid: false; issues: TemplateValidationIssue[] };

function issue(code: TemplateValidationIssueCode, message: string): TemplateValidationIssue {
  return { code, message };
}

function validatePlannedShot(
  shot: PlannedAssessmentShot,
  expectedPhase: PlannedAssessmentShot["phase"],
  issues: TemplateValidationIssue[]
): void {
  if (!VALID_HANDLES.includes(shot.expectedHandle)) {
    issues.push(
      issue("missing_expected_handle", `Planned shot "${shot.id}" has no valid expected handle.`)
    );
  }
  if (!VALID_SHOT_TYPES.includes(shot.shotType)) {
    issues.push(issue("invalid_shot_type", `Planned shot "${shot.id}" has an invalid shot type.`));
  }
  if (!VALID_MEASUREMENT_MODES.includes(shot.measurementMode)) {
    issues.push(
      issue("invalid_measurement_mode", `Planned shot "${shot.id}" has an invalid measurement mode.`)
    );
  }
  if (!Number.isFinite(shot.targetTime) || shot.targetTime <= 0) {
    issues.push(
      issue("non_positive_target_time", `Planned shot "${shot.id}" must have a positive target time.`)
    );
  }
  if (shot.phase !== expectedPhase) {
    issues.push(
      issue(
        "warmup_scored_not_separated",
        `Planned shot "${shot.id}" has phase "${shot.phase}" but was found in the ${expectedPhase} group.`
      )
    );
  }
}

/**
 * Validates every structural invariant an AssessmentTemplate must hold:
 * unique block/shot IDs, contiguous global sequence indices, valid
 * measurement mode/shot type/handle/target time on every planned shot,
 * warm-up vs. scored separation, block ordering consistency, and — for a
 * published Official template — completeness (at least one block, at least
 * one warm-up or scored shot).
 */
export function validateAssessmentTemplate(template: AssessmentTemplate): TemplateValidationResult {
  const issues: TemplateValidationIssue[] = [];

  if (!Number.isInteger(template.version) || template.version < 1) {
    issues.push(issue("invalid_version", `Template version must be a positive integer.`));
  }

  const blockIds = new Set<string>();
  for (const block of template.blocks) {
    if (blockIds.has(block.id)) {
      issues.push(issue("duplicate_block_id", `Block ID "${block.id}" is used more than once.`));
    }
    blockIds.add(block.id);
  }

  const sortedBlocks = [...template.blocks].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  sortedBlocks.forEach((block, index) => {
    if (block.sequenceIndex !== index) {
      issues.push(
        issue(
          "block_sequence_inconsistent",
          `Block "${block.id}" has sequenceIndex ${block.sequenceIndex}, expected ${index}.`
        )
      );
    }
  });

  const allShots: PlannedAssessmentShot[] = [
    ...template.warmupShots,
    ...template.blocks.flatMap((block) => block.plannedShots),
  ];

  const shotIds = new Set<string>();
  for (const shot of allShots) {
    if (shotIds.has(shot.id)) {
      issues.push(
        issue("duplicate_planned_shot_id", `Planned shot ID "${shot.id}" is used more than once.`)
      );
    }
    shotIds.add(shot.id);
  }

  template.warmupShots.forEach((shot) => validatePlannedShot(shot, "warmup", issues));
  for (const block of template.blocks) {
    if (!blockIds.has(block.id)) continue;
    block.plannedShots.forEach((shot, index) => {
      validatePlannedShot(shot, "scored", issues);
      if (shot.blockId !== block.id) {
        issues.push(
          issue(
            "shot_outside_block",
            `Planned shot "${shot.id}" declares blockId "${shot.blockId}" but is listed under block "${block.id}".`
          )
        );
      }
      if (shot.blockSequenceIndex !== index) {
        issues.push(
          issue(
            "invalid_sequence_index",
            `Planned shot "${shot.id}" has blockSequenceIndex ${shot.blockSequenceIndex}, expected ${index}.`
          )
        );
      }
    });
  }

  template.warmupShots.forEach((shot, index) => {
    if (shot.blockId !== null) {
      issues.push(
        issue("shot_outside_block", `Warm-up shot "${shot.id}" must not declare a blockId.`)
      );
    }
    if (shot.blockSequenceIndex !== index) {
      issues.push(
        issue(
          "invalid_sequence_index",
          `Warm-up shot "${shot.id}" has blockSequenceIndex ${shot.blockSequenceIndex}, expected ${index}.`
        )
      );
    }
  });

  const sortedBySequence = [...allShots].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  sortedBySequence.forEach((shot, index) => {
    if (shot.sequenceIndex !== index) {
      issues.push(
        issue(
          "sequence_gap_or_duplicate",
          `Global planned-shot sequence has a gap or duplicate at index ${index} (found sequenceIndex ${shot.sequenceIndex} on shot "${shot.id}").`
        )
      );
    }
  });

  if (template.type === "official" && template.status === "published") {
    if (template.blocks.length === 0 && template.warmupShots.length === 0) {
      issues.push(
        issue(
          "published_official_incomplete",
          `Published Official template "${template.id}" must define at least one block or warm-up shot.`
        )
      );
    }
    if (template.blocks.some((block) => block.plannedShots.length === 0)) {
      issues.push(
        issue(
          "published_official_incomplete",
          `Published Official template "${template.id}" has a block with no planned shots.`
        )
      );
    }
  }

  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}
