// Structured validation issues for the Exercise Library's curated content
// boundary, following the same discriminated-result house style as
// `src/lib/assessment/templateValidation.ts` and `src/lib/assessment/errors.ts`
// rather than throwing for an ordinary, expected rejection.
//
// The production catalog is authored in code, but it is still validated at this
// boundary as untrusted data: a mistyped literal must fail with an actionable
// message before anything renders (see `catalog.ts`), and the same validator
// covers any future externally-delivered content package.

export type ExerciseCatalogIssueCode =
  // Package level
  | "invalid_package_schema_version"
  | "unsupported_content_language"
  // Identity and versioning
  | "duplicate_exercise_id"
  | "duplicate_exercise_version_id"
  | "duplicate_exercise_version_number"
  | "invalid_version_number"
  | "invalid_content_schema_version"
  | "missing_current_version"
  | "current_version_belongs_to_other_exercise"
  | "version_references_unknown_exercise"
  | "exercise_has_no_versions"
  // Content
  | "missing_required_content"
  | "invalid_classification"
  | "invalid_difficulty"
  | "invalid_guidance"
  | "invalid_source_reference_goal"
  | "invalid_recommended_volume"
  | "invalid_source_attribution"
  // Participation and sweeping
  | "invalid_participation_requirement"
  | "invalid_sweeping_requirement"
  | "contradictory_participation_and_sweeping"
  // Measurement Protocols
  | "duplicate_measurement_protocol"
  | "duplicate_measurement_protocol_reference"
  | "invalid_measurement_protocol"
  | "unknown_measurement_protocol_reference"
  // Diagrams
  | "unsupported_diagram_kind"
  | "unsupported_diagram_element_kind"
  | "unsupported_diagram_coordinate_system"
  | "invalid_diagram_schema_version"
  | "invalid_normalized_coordinate"
  | "missing_diagram_accessibility_metadata"
  | "invalid_restricted_source_image";

export type ExerciseCatalogIssue = {
  code: ExerciseCatalogIssueCode;
  message: string;
};

export type ExerciseCatalogValidationResult =
  | { valid: true }
  | { valid: false; issues: ExerciseCatalogIssue[] };

export function exerciseCatalogIssue(
  code: ExerciseCatalogIssueCode,
  message: string
): ExerciseCatalogIssue {
  return { code, message };
}
