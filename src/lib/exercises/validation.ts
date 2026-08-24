// Structural and semantic validation of an Exercise Library catalog package.
// Pure, no I/O, no UI strings — the same shape as
// `src/lib/assessment/templateValidation.ts`.
//
// Deliberately treats its input as untrusted even though the production package
// is authored in code (see `catalog.ts`, which runs this once at module import
// time and fails fast with an actionable message). Every field is checked at
// runtime rather than assumed from its TypeScript type, so a mistyped literal,
// a hand-edited content file, or any future externally-delivered package is
// rejected at exactly one boundary.
//
// Explicit, exact-schema validation is the whole strategy here: Stage A stores
// no catalog or execution state, so there is nothing to migrate. A future
// package/content schema change therefore requires an explicit loader or
// migration, or a deliberate and visible failure — never a speculative
// multi-version migration written in advance.
import type { MeasurementMode, TimingProviderType } from "../../types";
import {
  exerciseCatalogIssue,
  type ExerciseCatalogIssue,
  type ExerciseCatalogIssueCode,
  type ExerciseCatalogValidationResult,
} from "./errors";
import {
  EXERCISE_CATALOG_PACKAGE_SCHEMA_VERSION,
  EXERCISE_CONTENT_SCHEMA_VERSION,
  EXERCISE_DIAGRAM_COORDINATE_SYSTEMS,
  EXERCISE_DIAGRAM_ELEMENT_KINDS,
  EXERCISE_DIAGRAM_KINDS,
  EXERCISE_DIAGRAM_SCHEMA_VERSION,
  EXERCISE_PARTICIPANT_ROLES,
  EXERCISE_PARTICIPATION_MODES,
  EXERCISE_PRIMARY_FOCUSES,
  EXERCISE_SHOT_FAMILIES,
  EXERCISE_SOURCE_KINDS,
  EXERCISE_SWEEPING_POLICIES,
  EXERCISE_TRAINING_PURPOSES,
  MAX_EXERCISE_DIFFICULTY_LEVEL,
  MAX_EXERCISE_SWEEPER_COUNT,
  MEASUREMENT_METRIC_TYPES,
  MEASUREMENT_UNITS,
  MIN_EXERCISE_DIFFICULTY_LEVEL,
  RESTRICTED_DISTRIBUTION_SCOPES,
  SUPPORTED_EXERCISE_CONTENT_LANGUAGES,
  type Exercise,
  type ExerciseCatalogPackage,
  type ExerciseDiagram,
  type ExerciseDiagramElement,
  type ExerciseVersion,
  type MeasurementProtocol,
  type NormalizedPoint,
} from "./types";

const VALID_MEASUREMENT_MODES: readonly MeasurementMode[] = ["back-hog", "hog-hog"];
const VALID_TIMING_PROVIDER_TYPES: readonly TimingProviderType[] = [
  "simulator",
  "manual",
  "external",
];
const VALID_REQUIREMENT_LEVELS = ["required", "optional"] as const;
const VALID_LINE_STYLES = ["solid", "dashed"] as const;
const VALID_STONE_ROLES = ["delivered", "setup", "marker"] as const;
const VALID_TEXT_ANCHORS = ["start", "middle", "end"] as const;

/**
 * Opaque restricted-asset identifiers only: lowercase kebab-case. This
 * deterministically rejects anything that could address the asset publicly —
 * an absolute or relative path, a `data:`/`https:` URL, a file extension, or a
 * Windows path — so a restricted source image can never be reached from the
 * content package alone (see `restrictedAssets.ts`).
 */
const OPAQUE_ASSET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** A normalized coordinate is a finite number in [0, 1] — see `normalized-ice-sheet-v1`. */
function isNormalizedValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNormalizedPoint(value: unknown): value is NormalizedPoint {
  if (value === null || typeof value !== "object") return false;
  const point = value as { x?: unknown; y?: unknown };
  return isNormalizedValue(point.x) && isNormalizedValue(point.y);
}

function isNonEmptyStringArray(value: unknown): boolean {
  return isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

/**
 * An optional string field is either absent or genuinely present. A field that
 * is `null`, empty, or whitespace-only is rejected rather than rendered: every
 * optional field in this domain is renderable content, and the UI decides
 * whether to render it purely from its presence, so "present but blank" would
 * become an empty label or a dangling "—" separator.
 */
function isAbsentOrNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

/**
 * Validates every invariant a curated catalog package must hold. Returns every
 * issue found rather than stopping at the first, so a content author sees the
 * complete list.
 */
export function validateExerciseCatalogPackage(
  pkg: ExerciseCatalogPackage
): ExerciseCatalogValidationResult {
  const issues: ExerciseCatalogIssue[] = [];
  const add = (code: ExerciseCatalogIssueCode, message: string) => {
    issues.push(exerciseCatalogIssue(code, message));
  };

  if (pkg === null || typeof pkg !== "object") {
    add("missing_required_content", "Catalog package must be an object.");
    return { valid: false, issues };
  }

  // --- Package level -------------------------------------------------------

  if (pkg.packageSchemaVersion !== EXERCISE_CATALOG_PACKAGE_SCHEMA_VERSION) {
    add(
      "invalid_package_schema_version",
      `Catalog package schema version must be exactly ${EXERCISE_CATALOG_PACKAGE_SCHEMA_VERSION}, found ${JSON.stringify(
        pkg.packageSchemaVersion
      )}. A newer package requires an explicit loader or migration, never a guessed upgrade.`
    );
  }

  if (!isOneOf(pkg.contentLanguage, SUPPORTED_EXERCISE_CONTENT_LANGUAGES)) {
    add(
      "unsupported_content_language",
      `Catalog package content language ${JSON.stringify(
        pkg.contentLanguage
      )} is not supported (supported: ${SUPPORTED_EXERCISE_CONTENT_LANGUAGES.join(", ")}).`
    );
  }

  if (!isArray(pkg.exercises) || !isArray(pkg.versions) || !isArray(pkg.measurementProtocols)) {
    add(
      "missing_required_content",
      "Catalog package must contain `exercises`, `versions` and `measurementProtocols` arrays."
    );
    return { valid: false, issues };
  }

  // --- Measurement Protocols ----------------------------------------------

  const protocolKeys = new Set<string>();
  const protocolsByKey = new Map<string, MeasurementProtocol>();

  pkg.measurementProtocols.forEach((protocol, index) => {
    const where = isNonEmptyString(protocol?.id)
      ? `Measurement Protocol "${protocol.id}"`
      : `Measurement Protocol at index ${index}`;

    if (!isNonEmptyString(protocol?.id)) {
      add("invalid_measurement_protocol", `${where} must have a non-empty id.`);
      return;
    }
    if (!isPositiveInteger(protocol.version)) {
      add(
        "invalid_measurement_protocol",
        `${where} must have a positive integer version, found ${JSON.stringify(protocol.version)}.`
      );
      return;
    }

    const key = `${protocol.id}@${protocol.version}`;
    if (protocolKeys.has(key)) {
      add(
        "duplicate_measurement_protocol",
        `Measurement Protocol id "${protocol.id}" version ${protocol.version} is defined more than once.`
      );
      return;
    }
    protocolKeys.add(key);
    protocolsByKey.set(key, protocol);

    if (!isNonEmptyString(protocol.name)) {
      add("invalid_measurement_protocol", `${where} must have a non-empty English name.`);
    }
    if (!isOneOf(protocol.metricType, MEASUREMENT_METRIC_TYPES)) {
      add(
        "invalid_measurement_protocol",
        `${where} has an unsupported metric type ${JSON.stringify(protocol.metricType)}.`
      );
    }
    if (!isOneOf(protocol.unit, MEASUREMENT_UNITS)) {
      add(
        "invalid_measurement_protocol",
        `${where} has an unsupported unit ${JSON.stringify(protocol.unit)}.`
      );
    }
    if (!isOneOf(protocol.measurementMode, VALID_MEASUREMENT_MODES)) {
      add(
        "invalid_measurement_protocol",
        `${where} has an invalid measurement mode ${JSON.stringify(protocol.measurementMode)}.`
      );
    }
    if (!isNonEmptyString(protocol.referencePoints)) {
      add("invalid_measurement_protocol", `${where} must describe its reference points.`);
    }
    if (!isNonEmptyString(protocol.guidance)) {
      add("invalid_measurement_protocol", `${where} must provide English guidance.`);
    }
    if (
      !isArray(protocol.allowedSources) ||
      protocol.allowedSources.length === 0 ||
      !protocol.allowedSources.every((source) => isOneOf(source, VALID_TIMING_PROVIDER_TYPES))
    ) {
      add(
        "invalid_measurement_protocol",
        `${where} must list at least one allowed measurement source, each a known Timing Provider type.`
      );
    } else if (new Set(protocol.allowedSources).size !== protocol.allowedSources.length) {
      // A repeated source would be listed twice wherever the detail renders the
      // protocol's allowed sources.
      add(
        "invalid_measurement_protocol",
        `${where} lists the same allowed measurement source more than once.`
      );
    }
    if (protocol.target !== null) {
      add(
        "invalid_measurement_protocol",
        `${where} must not prescribe a target or tolerance in Stage A (found ${JSON.stringify(
          protocol.target
        )}).`
      );
    }
  });

  // --- Exercise identities -------------------------------------------------

  const exerciseIds = new Set<string>();
  const exercisesById = new Map<string, Exercise>();

  pkg.exercises.forEach((exercise, index) => {
    if (!isNonEmptyString(exercise?.id)) {
      add("missing_required_content", `Exercise at index ${index} must have a non-empty id.`);
      return;
    }
    if (exerciseIds.has(exercise.id)) {
      add("duplicate_exercise_id", `Exercise id "${exercise.id}" is used more than once.`);
      return;
    }
    exerciseIds.add(exercise.id);
    exercisesById.set(exercise.id, exercise);

    if (!isNonEmptyString(exercise.currentVersionId)) {
      add(
        "missing_current_version",
        `Exercise "${exercise.id}" must name a current Exercise Version id.`
      );
    }
  });

  // --- Exercise Versions ---------------------------------------------------

  const versionIds = new Set<string>();
  const versionsById = new Map<string, ExerciseVersion>();
  const versionNumbersByExercise = new Map<string, Set<number>>();
  const versionCountByExercise = new Map<string, number>();

  pkg.versions.forEach((version, index) => {
    if (!isNonEmptyString(version?.id)) {
      add(
        "missing_required_content",
        `Exercise Version at index ${index} must have a non-empty id.`
      );
      return;
    }
    if (versionIds.has(version.id)) {
      add(
        "duplicate_exercise_version_id",
        `Exercise Version id "${version.id}" is used more than once.`
      );
      return;
    }
    versionIds.add(version.id);
    versionsById.set(version.id, version);

    validateExerciseVersion(version, {
      add,
      exerciseIds,
      protocolKeys,
      versionNumbersByExercise,
      versionCountByExercise,
    });
  });

  // --- Cross references ----------------------------------------------------

  for (const exercise of exercisesById.values()) {
    if (!isNonEmptyString(exercise.currentVersionId)) continue;

    const current = versionsById.get(exercise.currentVersionId);
    if (!current) {
      add(
        "missing_current_version",
        `Exercise "${exercise.id}" names current version "${exercise.currentVersionId}", which does not exist in this package.`
      );
      continue;
    }
    if (current.exerciseId !== exercise.id) {
      add(
        "current_version_belongs_to_other_exercise",
        `Exercise "${exercise.id}" names current version "${current.id}", which belongs to Exercise "${current.exerciseId}".`
      );
    }
  }

  for (const exerciseId of exerciseIds) {
    if ((versionCountByExercise.get(exerciseId) ?? 0) === 0) {
      add("exercise_has_no_versions", `Exercise "${exerciseId}" has no Exercise Version.`);
    }
  }

  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}

type VersionValidationContext = {
  add: (code: ExerciseCatalogIssueCode, message: string) => void;
  exerciseIds: Set<string>;
  protocolKeys: Set<string>;
  versionNumbersByExercise: Map<string, Set<number>>;
  versionCountByExercise: Map<string, number>;
};

function validateExerciseVersion(
  version: ExerciseVersion,
  context: VersionValidationContext
): void {
  const { add, exerciseIds, protocolKeys, versionNumbersByExercise, versionCountByExercise } =
    context;
  const where = `Exercise Version "${version.id}"`;

  // Identity and versioning ------------------------------------------------

  if (!isNonEmptyString(version.exerciseId)) {
    add("version_references_unknown_exercise", `${where} must name its stable Exercise id.`);
  } else if (!exerciseIds.has(version.exerciseId)) {
    add(
      "version_references_unknown_exercise",
      `${where} references unknown Exercise "${version.exerciseId}".`
    );
  } else {
    versionCountByExercise.set(
      version.exerciseId,
      (versionCountByExercise.get(version.exerciseId) ?? 0) + 1
    );

    if (isPositiveInteger(version.version)) {
      const seen = versionNumbersByExercise.get(version.exerciseId) ?? new Set<number>();
      if (seen.has(version.version)) {
        add(
          "duplicate_exercise_version_number",
          `Exercise "${version.exerciseId}" has more than one version numbered ${version.version}.`
        );
      }
      seen.add(version.version);
      versionNumbersByExercise.set(version.exerciseId, seen);
    }
  }

  if (!isPositiveInteger(version.version)) {
    add(
      "invalid_version_number",
      `${where} must have a positive integer version number, found ${JSON.stringify(
        version.version
      )}.`
    );
  }

  if (version.contentSchemaVersion !== EXERCISE_CONTENT_SCHEMA_VERSION) {
    add(
      "invalid_content_schema_version",
      `${where} must use content schema version ${EXERCISE_CONTENT_SCHEMA_VERSION}, found ${JSON.stringify(
        version.contentSchemaVersion
      )}.`
    );
  }

  if (!isOneOf(version.contentLanguage, SUPPORTED_EXERCISE_CONTENT_LANGUAGES)) {
    add(
      "unsupported_content_language",
      `${where} declares unsupported content language ${JSON.stringify(version.contentLanguage)}.`
    );
  }

  // Required content -------------------------------------------------------

  if (!isNonEmptyString(version.title)) {
    add("missing_required_content", `${where} must have an English title.`);
  }
  if (!isNonEmptyString(version.goal)) {
    add("missing_required_content", `${where} must state its goal.`);
  }
  if (!isNonEmptyString(version.whyItMatters)) {
    add("missing_required_content", `${where} must explain why it matters.`);
  }

  for (const [field, steps] of [
    ["setupInstructions", version.setupInstructions],
    ["executionInstructions", version.executionInstructions],
  ] as const) {
    if (!isArray(steps) || steps.length === 0) {
      add("missing_required_content", `${where} must contain at least one ${field} entry.`);
      continue;
    }
    const stepIds = new Set<string>();
    steps.forEach((step, stepIndex) => {
      if (!isNonEmptyString(step?.id) || !isNonEmptyString(step?.text)) {
        add(
          "missing_required_content",
          `${where} ${field}[${stepIndex}] must have a non-empty id and English text.`
        );
        return;
      }
      if (stepIds.has(step.id)) {
        add(
          "missing_required_content",
          `${where} ${field} uses step id "${step.id}" more than once.`
        );
      }
      stepIds.add(step.id);
    });
  }

  // Classification ---------------------------------------------------------

  if (!isOneOf(version.primaryFocus, EXERCISE_PRIMARY_FOCUSES)) {
    add(
      "invalid_classification",
      `${where} has an invalid Primary Exercise Focus ${JSON.stringify(version.primaryFocus)}.`
    );
  }
  if (version.shotFamily !== undefined && !isOneOf(version.shotFamily, EXERCISE_SHOT_FAMILIES)) {
    add(
      "invalid_classification",
      `${where} has an invalid Shot Family ${JSON.stringify(version.shotFamily)}.`
    );
  }
  if (!isOneOf(version.primaryTrainingPurpose, EXERCISE_TRAINING_PURPOSES)) {
    add(
      "invalid_classification",
      `${where} has an invalid primary Training Purpose ${JSON.stringify(
        version.primaryTrainingPurpose
      )}.`
    );
  }
  if (!isArray(version.additionalTrainingPurposes)) {
    add("invalid_classification", `${where} must declare an additionalTrainingPurposes array.`);
  } else {
    const seenPurposes = new Set<string>();
    version.additionalTrainingPurposes.forEach((purpose) => {
      if (!isOneOf(purpose, EXERCISE_TRAINING_PURPOSES)) {
        add(
          "invalid_classification",
          `${where} has an invalid additional Training Purpose ${JSON.stringify(purpose)}.`
        );
        return;
      }
      if (purpose === version.primaryTrainingPurpose) {
        add(
          "invalid_classification",
          `${where} repeats its primary Training Purpose "${purpose}" as an additional purpose.`
        );
      }
      if (seenPurposes.has(purpose)) {
        add(
          "invalid_classification",
          `${where} lists additional Training Purpose "${purpose}" more than once.`
        );
      }
      seenPurposes.add(purpose);
    });
  }

  validateDifficulty(version, add);
  validateGuidance(version, add);
  validateSourceReferenceGoal(version, add);
  validateRecommendedVolume(version, add);
  validateVariations(version, add);
  validateEquipment(version, add);
  validateParticipationAndSweeping(version, add);
  validateMeasurementReferences(version, protocolKeys, add);
  validateSource(version, add);

  if (version.diagram !== undefined) {
    validateDiagram(version.diagram, where, add);
  }
}

type AddIssue = (code: ExerciseCatalogIssueCode, message: string) => void;

function validateDifficulty(version: ExerciseVersion, add: AddIssue): void {
  const where = `Exercise Version "${version.id}"`;
  const difficulty = version.difficulty;
  if (difficulty === undefined) return;

  const inBounds = (value: unknown) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_EXERCISE_DIFFICULTY_LEVEL &&
    value <= MAX_EXERCISE_DIFFICULTY_LEVEL;

  if (difficulty === null || typeof difficulty !== "object") {
    add("invalid_difficulty", `${where} has a malformed difficulty value.`);
    return;
  }

  if (difficulty.kind === "level") {
    if (!inBounds(difficulty.level)) {
      add(
        "invalid_difficulty",
        `${where} difficulty level must be an integer between ${MIN_EXERCISE_DIFFICULTY_LEVEL} and ${MAX_EXERCISE_DIFFICULTY_LEVEL}, found ${JSON.stringify(
          difficulty.level
        )}.`
      );
    }
    return;
  }

  if (difficulty.kind === "range") {
    if (!inBounds(difficulty.min) || !inBounds(difficulty.max)) {
      add(
        "invalid_difficulty",
        `${where} difficulty range bounds must be integers between ${MIN_EXERCISE_DIFFICULTY_LEVEL} and ${MAX_EXERCISE_DIFFICULTY_LEVEL}.`
      );
      return;
    }
    if (difficulty.min >= difficulty.max) {
      add(
        "invalid_difficulty",
        `${where} difficulty range must have min < max, found ${difficulty.min}-${difficulty.max}.`
      );
    }
    return;
  }

  add(
    "invalid_difficulty",
    `${where} has an unsupported difficulty kind ${JSON.stringify(
      (difficulty as { kind?: unknown }).kind
    )}.`
  );
}

const EXPECTED_SHOTMAKING_SCALE: readonly { score: number; percentage: number }[] = [
  { score: 0, percentage: 0 },
  { score: 1, percentage: 25 },
  { score: 2, percentage: 50 },
  { score: 3, percentage: 75 },
  { score: 4, percentage: 100 },
];

function validateGuidance(version: ExerciseVersion, add: AddIssue): void {
  const where = `Exercise Version "${version.id}"`;
  const guidance = version.guidance;

  if (guidance === null || typeof guidance !== "object") {
    add("invalid_guidance", `${where} must provide observation or evaluation guidance.`);
    return;
  }

  if (guidance.kind === "observation") {
    if (!isNonEmptyStringArray(guidance.observations)) {
      add("invalid_guidance", `${where} observation guidance must list what to observe.`);
    }
    if (!isNonEmptyString(guidance.noScoringNote)) {
      add(
        "invalid_guidance",
        `${where} observation guidance must state explicitly that the app produces no score.`
      );
    }
    return;
  }

  if (guidance.kind === "generic-shotmaking-score") {
    // Spec 10.1: a Technique Exercise never displays Shotmaking score controls,
    // points, percentages or pass/failed status. The generic 0-4 mechanism
    // belongs to a Shotmaking-focused Exercise only.
    if (version.primaryFocus !== "shotmaking") {
      add(
        "invalid_guidance",
        `${where} uses generic Shotmaking 0-4 guidance but its Primary Exercise Focus is ${JSON.stringify(
          version.primaryFocus
        )}; only a Shotmaking Exercise may present a 0-4 score.`
      );
    }
    if (
      !isArray(guidance.scale) ||
      guidance.scale.length !== EXPECTED_SHOTMAKING_SCALE.length ||
      guidance.scale.some(
        (entry, index) =>
          entry?.score !== EXPECTED_SHOTMAKING_SCALE[index].score ||
          entry?.percentage !== EXPECTED_SHOTMAKING_SCALE[index].percentage
      )
    ) {
      add(
        "invalid_guidance",
        `${where} must declare curling's exact 0-4 scale (0=0%, 1=25%, 2=50%, 3=75%, 4=100%).`
      );
    }
    if (!isNonEmptyStringArray(guidance.explanation)) {
      add("invalid_guidance", `${where} must explain how the 0-4 value is captured.`);
    }
    if (guidance.evaluationBasis !== "team-defined-unstructured") {
      add(
        "invalid_guidance",
        `${where} must record the closed-beta evaluation basis "team-defined-unstructured", found ${JSON.stringify(
          guidance.evaluationBasis
        )}.`
      );
    }
    if (!isNonEmptyString(guidance.evaluationBasisNote)) {
      add(
        "invalid_guidance",
        `${where} must state that no platform-standardised rubric exists yet.`
      );
    }
    return;
  }

  add(
    "invalid_guidance",
    `${where} has an unsupported guidance kind ${JSON.stringify(
      (guidance as { kind?: unknown }).kind
    )}.`
  );
}

function validateSourceReferenceGoal(version: ExerciseVersion, add: AddIssue): void {
  const goal = version.sourceReferenceGoal;
  if (goal === undefined) return;

  const where = `Exercise Version "${version.id}"`;
  if (goal === null || typeof goal !== "object") {
    add("invalid_source_reference_goal", `${where} has a malformed source reference goal.`);
    return;
  }
  if (!isNonEmptyString(goal.text)) {
    add("invalid_source_reference_goal", `${where} source reference goal must have English text.`);
  }
  if (goal.evaluated !== false) {
    add(
      "invalid_source_reference_goal",
      `${where} source reference goal must be marked as not evaluated by the app (spec 11.5).`
    );
  }
}

function validateRecommendedVolume(version: ExerciseVersion, add: AddIssue): void {
  const volume = version.recommendedVolume;
  if (volume === undefined) return;

  const where = `Exercise Version "${version.id}"`;
  if (volume === null || typeof volume !== "object") {
    add("invalid_recommended_volume", `${where} has a malformed recommended volume.`);
    return;
  }

  if (volume.kind === "stone-count") {
    if (!isPositiveInteger(volume.stones)) {
      add(
        "invalid_recommended_volume",
        `${where} recommended stone count must be a positive integer, found ${JSON.stringify(
          volume.stones
        )}.`
      );
    }
    if (!isAbsentOrNonEmptyString(volume.note)) {
      add(
        "invalid_recommended_volume",
        `${where} recommended volume has a present but blank note; omit it instead.`
      );
    }
    return;
  }
  if (volume.kind === "repetition-count") {
    if (!isPositiveInteger(volume.repetitions)) {
      add(
        "invalid_recommended_volume",
        `${where} recommended repetition count must be a positive integer, found ${JSON.stringify(
          volume.repetitions
        )}.`
      );
    }
    if (!isAbsentOrNonEmptyString(volume.note)) {
      add(
        "invalid_recommended_volume",
        `${where} recommended volume has a present but blank note; omit it instead.`
      );
    }
    return;
  }
  if (volume.kind === "open") {
    if (!isNonEmptyString(volume.note)) {
      add(
        "invalid_recommended_volume",
        `${where} open recommended volume must carry an English note explaining it.`
      );
    }
    return;
  }

  add(
    "invalid_recommended_volume",
    `${where} has an unsupported recommended volume kind ${JSON.stringify(
      (volume as { kind?: unknown }).kind
    )}.`
  );
}

function validateVariations(version: ExerciseVersion, add: AddIssue): void {
  const where = `Exercise Version "${version.id}"`;
  if (!isArray(version.variations)) {
    add("missing_required_content", `${where} must declare a variations array (may be empty).`);
    return;
  }
  const ids = new Set<string>();
  version.variations.forEach((variation, index) => {
    if (!isNonEmptyString(variation?.id) || !isNonEmptyString(variation?.label)) {
      add(
        "missing_required_content",
        `${where} variations[${index}] must have a non-empty id and English label.`
      );
      return;
    }
    if (!isAbsentOrNonEmptyString(variation.description)) {
      add(
        "missing_required_content",
        `${where} variation "${variation.id}" has a present but blank description; omit it instead.`
      );
    }
    if (ids.has(variation.id)) {
      add("missing_required_content", `${where} uses variation id "${variation.id}" twice.`);
    }
    ids.add(variation.id);
  });
}

function validateEquipment(version: ExerciseVersion, add: AddIssue): void {
  const where = `Exercise Version "${version.id}"`;
  if (!isArray(version.equipment)) {
    add("missing_required_content", `${where} must declare an equipment array (may be empty).`);
    return;
  }
  const ids = new Set<string>();
  version.equipment.forEach((item, index) => {
    if (!isNonEmptyString(item?.id) || !isNonEmptyString(item?.label)) {
      add(
        "missing_required_content",
        `${where} equipment[${index}] must have a non-empty id and English label.`
      );
      return;
    }
    if (!isOneOf(item.requirement, VALID_REQUIREMENT_LEVELS)) {
      add(
        "missing_required_content",
        `${where} equipment "${item.id}" has an invalid requirement ${JSON.stringify(
          item.requirement
        )}.`
      );
    }
    if (!isAbsentOrNonEmptyString(item.note)) {
      add(
        "missing_required_content",
        `${where} equipment "${item.id}" has a present but blank note; omit it instead.`
      );
    }
    if (ids.has(item.id)) {
      add("missing_required_content", `${where} uses equipment id "${item.id}" twice.`);
    }
    ids.add(item.id);
  });
}

function validateParticipationAndSweeping(version: ExerciseVersion, add: AddIssue): void {
  const where = `Exercise Version "${version.id}"`;
  const participation = version.participation;
  const sweeping = version.sweeping;

  let participationValid = true;

  if (participation === null || typeof participation !== "object") {
    add("invalid_participation_requirement", `${where} must declare a participation profile.`);
    participationValid = false;
  } else {
    if (
      !isArray(participation.supportedModes) ||
      participation.supportedModes.length === 0 ||
      !participation.supportedModes.every((mode) =>
        isOneOf(mode, EXERCISE_PARTICIPATION_MODES)
      ) ||
      new Set(participation.supportedModes).size !== participation.supportedModes.length
    ) {
      add(
        "invalid_participation_requirement",
        `${where} must declare at least one distinct, valid participation mode.`
      );
      participationValid = false;
    }
    if (!isPositiveInteger(participation.minTrainingAthletes)) {
      add(
        "invalid_participation_requirement",
        `${where} must require at least one training athlete, found ${JSON.stringify(
          participation.minTrainingAthletes
        )}.`
      );
      participationValid = false;
    }
    if (
      participation.maxTrainingAthletes !== null &&
      !isPositiveInteger(participation.maxTrainingAthletes)
    ) {
      add(
        "invalid_participation_requirement",
        `${where} maxTrainingAthletes must be null or a positive integer, found ${JSON.stringify(
          participation.maxTrainingAthletes
        )}.`
      );
      participationValid = false;
    }
    if (
      isPositiveInteger(participation.minTrainingAthletes) &&
      isPositiveInteger(participation.maxTrainingAthletes) &&
      participation.maxTrainingAthletes < participation.minTrainingAthletes
    ) {
      add(
        "invalid_participation_requirement",
        `${where} allows at most ${participation.maxTrainingAthletes} training athletes but requires at least ${participation.minTrainingAthletes}.`
      );
      participationValid = false;
    }
    if (!isNonEmptyString(participation.summary)) {
      add(
        "invalid_participation_requirement",
        `${where} must provide an English participation summary.`
      );
    }
    if (!isArray(participation.roles)) {
      add("invalid_participation_requirement", `${where} must declare a roles array.`);
      participationValid = false;
    } else {
      const seenRoles = new Set<string>();
      participation.roles.forEach((role, index) => {
        if (!isOneOf(role?.role, EXERCISE_PARTICIPANT_ROLES)) {
          add(
            "invalid_participation_requirement",
            `${where} roles[${index}] has an invalid role ${JSON.stringify(role?.role)}.`
          );
          return;
        }
        if (!isOneOf(role.requirement, VALID_REQUIREMENT_LEVELS)) {
          add(
            "invalid_participation_requirement",
            `${where} role "${role.role}" has an invalid requirement ${JSON.stringify(
              role.requirement
            )}.`
          );
        }
        if (!isAbsentOrNonEmptyString(role.note)) {
          add(
            "invalid_participation_requirement",
            `${where} role "${role.role}" has a present but blank note; omit it instead.`
          );
        }
        if (seenRoles.has(role.role)) {
          add(
            "invalid_participation_requirement",
            `${where} declares role "${role.role}" more than once.`
          );
        }
        seenRoles.add(role.role);
      });
    }
  }

  let sweepingValid = true;

  if (sweeping === null || typeof sweeping !== "object") {
    add("invalid_sweeping_requirement", `${where} must declare a sweeping requirement.`);
    sweepingValid = false;
  } else {
    if (!isOneOf(sweeping.policy, EXERCISE_SWEEPING_POLICIES)) {
      add(
        "invalid_sweeping_requirement",
        `${where} has an invalid sweeping policy ${JSON.stringify(sweeping.policy)}.`
      );
      sweepingValid = false;
    }
    if (!isNonEmptyString(sweeping.note)) {
      add("invalid_sweeping_requirement", `${where} must explain its sweeping policy in English.`);
    }
    const counts = sweeping.allowedSweeperCounts;
    if (
      !isArray(counts) ||
      counts.length === 0 ||
      !counts.every(
        (count) =>
          typeof count === "number" &&
          Number.isInteger(count) &&
          count >= 0 &&
          count <= MAX_EXERCISE_SWEEPER_COUNT
      ) ||
      new Set(counts).size !== counts.length
    ) {
      add(
        "invalid_sweeping_requirement",
        `${where} must list distinct allowed Sweeper counts between 0 and ${MAX_EXERCISE_SWEEPER_COUNT}.`
      );
      sweepingValid = false;
    } else {
      if (sweeping.policy === "forbidden" && !(counts.length === 1 && counts[0] === 0)) {
        add(
          "invalid_sweeping_requirement",
          `${where} forbids sweeping but allows Sweeper counts ${JSON.stringify(counts)}.`
        );
        sweepingValid = false;
      }
      if (sweeping.policy === "required" && counts.includes(0)) {
        add(
          "invalid_sweeping_requirement",
          `${where} requires sweeping but allows a Sweeper count of 0.`
        );
        sweepingValid = false;
      }
      if (
        sweeping.policy === "optional" &&
        !(counts.includes(0) && counts.some((count) => count > 0))
      ) {
        add(
          "invalid_sweeping_requirement",
          `${where} makes sweeping optional but does not allow both 0 and a positive Sweeper count.`
        );
        sweepingValid = false;
      }
      if (
        sweeping.recommendedSweeperCount !== undefined &&
        !counts.includes(sweeping.recommendedSweeperCount)
      ) {
        add(
          "invalid_sweeping_requirement",
          `${where} recommends ${JSON.stringify(
            sweeping.recommendedSweeperCount
          )} Sweepers, which is not an allowed count.`
        );
        sweepingValid = false;
      }
    }
  }

  if (!participationValid || !sweepingValid) return;

  // Cross-dimension contradictions ----------------------------------------

  const sweeperRole = participation.roles.find((role) => role.role === "sweeper");

  if (sweeping.policy === "forbidden" && sweeperRole?.requirement === "required") {
    add(
      "contradictory_participation_and_sweeping",
      `${where} forbids sweeping but requires a Sweeper role.`
    );
  }
  if (
    sweeping.policy === "required" &&
    participation.supportedModes.length === 1 &&
    participation.supportedModes[0] === "solo"
  ) {
    add(
      "contradictory_participation_and_sweeping",
      `${where} requires sweeping but supports Solo execution only.`
    );
  }
  if (
    participation.supportedModes.length === 1 &&
    participation.supportedModes[0] === "solo" &&
    participation.roles.some(
      (role) => role.requirement === "required" && role.role !== "delivering-athlete"
    )
  ) {
    add(
      "invalid_participation_requirement",
      `${where} supports Solo execution only but requires a support role beyond the delivering athlete.`
    );
  }
  if (
    participation.supportedModes.length === 1 &&
    participation.supportedModes[0] === "solo" &&
    participation.minTrainingAthletes > 1
  ) {
    add(
      "invalid_participation_requirement",
      `${where} supports Solo execution only but requires ${participation.minTrainingAthletes} training athletes.`
    );
  }
}

function validateMeasurementReferences(
  version: ExerciseVersion,
  protocolKeys: Set<string>,
  add: AddIssue
): void {
  const where = `Exercise Version "${version.id}"`;
  if (!isArray(version.compatibleMeasurementProtocols)) {
    add(
      "unknown_measurement_protocol_reference",
      `${where} must declare a compatibleMeasurementProtocols array (may be empty).`
    );
    return;
  }

  const seenReferences = new Set<string>();

  version.compatibleMeasurementProtocols.forEach((reference, index) => {
    if (
      !isNonEmptyString(reference?.protocolId) ||
      !isPositiveInteger(reference?.protocolVersion)
    ) {
      add(
        "unknown_measurement_protocol_reference",
        `${where} compatibleMeasurementProtocols[${index}] must name a protocol id and a positive integer version.`
      );
      return;
    }
    if (!isOneOf(reference.requirement, VALID_REQUIREMENT_LEVELS)) {
      add(
        "unknown_measurement_protocol_reference",
        `${where} reference to "${reference.protocolId}" has an invalid requirement ${JSON.stringify(
          reference.requirement
        )}.`
      );
    }
    const key = `${reference.protocolId}@${reference.protocolVersion}`;
    if (!protocolKeys.has(key)) {
      add(
        "unknown_measurement_protocol_reference",
        `${where} references unknown Measurement Protocol "${reference.protocolId}" version ${reference.protocolVersion}.`
      );
    }
    // The same protocol id and version twice would render the same Measurement
    // twice on the detail, once per contradictory requirement level.
    if (seenReferences.has(key)) {
      add(
        "duplicate_measurement_protocol_reference",
        `${where} references Measurement Protocol "${reference.protocolId}" version ${reference.protocolVersion} more than once.`
      );
    }
    seenReferences.add(key);
  });
}

function validateSource(version: ExerciseVersion, add: AddIssue): void {
  const where = `Exercise Version "${version.id}"`;
  const source = version.source;

  if (source === null || typeof source !== "object") {
    add("invalid_source_attribution", `${where} must declare a source with English attribution.`);
    return;
  }
  if (!isOneOf(source.kind, EXERCISE_SOURCE_KINDS)) {
    add(
      "invalid_source_attribution",
      `${where} has an invalid source kind ${JSON.stringify(source.kind)}.`
    );
  }
  if (!isNonEmptyString(source.attribution)) {
    add("invalid_source_attribution", `${where} must carry a visible English attribution.`);
  }
  if (source.kind === "external-collection") {
    for (const field of [
      "organization",
      "collectionName",
      "collectionVersion",
      "sourceExerciseReference",
    ] as const) {
      if (!isNonEmptyString(source[field])) {
        add(
          "invalid_source_attribution",
          `${where} adapts an external collection and must record "${field}".`
        );
      }
    }
  } else {
    // Platform-curated content may omit any of these, but must not carry a
    // present-but-blank one: the detail decides whether to render each row
    // purely from its presence.
    for (const field of [
      "organization",
      "collectionName",
      "collectionVersion",
      "sourceExerciseReference",
    ] as const) {
      if (!isAbsentOrNonEmptyString(source[field])) {
        add(
          "invalid_source_attribution",
          `${where} source has a present but blank "${field}"; omit it instead.`
        );
      }
    }
  }
  if (!isAbsentOrNonEmptyString(source.provenanceNote)) {
    add(
      "invalid_source_attribution",
      `${where} source has a present but blank provenance note; omit it instead.`
    );
  }
  if (source.sourcePage !== undefined && !isPositiveInteger(source.sourcePage)) {
    add(
      "invalid_source_attribution",
      `${where} source page must be a positive integer when present, found ${JSON.stringify(
        source.sourcePage
      )}.`
    );
  }
  if (source.nonDisplayedSourceMetadata !== undefined) {
    const metadata = source.nonDisplayedSourceMetadata;
    if (
      metadata === null ||
      typeof metadata !== "object" ||
      !isArray(metadata.originalTitles) ||
      !isArray(metadata.searchAliases) ||
      !metadata.originalTitles.every(isNonEmptyString) ||
      !metadata.searchAliases.every(isNonEmptyString)
    ) {
      add(
        "invalid_source_attribution",
        `${where} non-displayed source metadata must contain arrays of non-empty strings.`
      );
    }
  }
}

function validateDiagram(diagram: ExerciseDiagram, where: string, add: AddIssue): void {
  if (diagram === null || typeof diagram !== "object") {
    add("unsupported_diagram_kind", `${where} has a malformed diagram.`);
    return;
  }
  if (!isOneOf(diagram.kind, EXERCISE_DIAGRAM_KINDS)) {
    add(
      "unsupported_diagram_kind",
      `${where} has an unsupported diagram kind ${JSON.stringify(
        (diagram as { kind?: unknown }).kind
      )}.`
    );
    return;
  }
  if (!isNonEmptyString(diagram.id)) {
    add("missing_required_content", `${where} diagram must have a non-empty id.`);
  }
  if (!isNonEmptyString(diagram.caption) || !isNonEmptyString(diagram.accessibleSummary)) {
    add(
      "missing_diagram_accessibility_metadata",
      `${where} diagram must provide an English caption and an English accessible summary.`
    );
  }

  if (diagram.kind === "attributed-source-image") {
    if (!isNonEmptyString(diagram.attribution)) {
      add(
        "invalid_restricted_source_image",
        `${where} source-image diagram must carry a visible English attribution.`
      );
    }
    if (!isNonEmptyString(diagram.sourceOrganization)) {
      add(
        "invalid_restricted_source_image",
        `${where} source-image diagram must name its source organization.`
      );
    }
    if (!isNonEmptyString(diagram.sourceVersion)) {
      add(
        "invalid_restricted_source_image",
        `${where} source-image diagram must record the source version it was taken from.`
      );
    }
    if (!isNonEmptyString(diagram.provenanceNote)) {
      add(
        "invalid_restricted_source_image",
        `${where} source-image diagram must record English provenance.`
      );
    }

    const reference = diagram.assetReference;
    if (
      reference === null ||
      typeof reference !== "object" ||
      !isNonEmptyString(reference.assetId) ||
      !OPAQUE_ASSET_ID_PATTERN.test(reference.assetId)
    ) {
      add(
        "invalid_restricted_source_image",
        `${where} source-image diagram must use an opaque asset reference (lowercase kebab-case id), never a URL or public path.`
      );
    }

    const distribution = diagram.distribution;
    if (
      distribution === null ||
      typeof distribution !== "object" ||
      !isOneOf(distribution.scope, RESTRICTED_DISTRIBUTION_SCOPES) ||
      !isNonEmptyString(distribution.permittedAudience)
    ) {
      add(
        "invalid_restricted_source_image",
        `${where} source-image diagram must declare a supported restricted-distribution scope and permitted audience.`
      );
    } else if (distribution.publicDeliveryPermitted !== false) {
      add(
        "invalid_restricted_source_image",
        `${where} source-image diagram must not permit public delivery.`
      );
    }
    return;
  }

  // Structured platform diagram -------------------------------------------

  if (diagram.schemaVersion !== EXERCISE_DIAGRAM_SCHEMA_VERSION) {
    add(
      "invalid_diagram_schema_version",
      `${where} structured diagram must use schema version ${EXERCISE_DIAGRAM_SCHEMA_VERSION}, found ${JSON.stringify(
        diagram.schemaVersion
      )}.`
    );
  }
  if (!isOneOf(diagram.coordinateSystem, EXERCISE_DIAGRAM_COORDINATE_SYSTEMS)) {
    add(
      "unsupported_diagram_coordinate_system",
      `${where} structured diagram uses unsupported coordinate system ${JSON.stringify(
        diagram.coordinateSystem
      )}.`
    );
  }
  if (
    typeof diagram.aspectRatio !== "number" ||
    !Number.isFinite(diagram.aspectRatio) ||
    diagram.aspectRatio <= 0
  ) {
    add(
      "invalid_normalized_coordinate",
      `${where} structured diagram aspect ratio must be a positive finite number, found ${JSON.stringify(
        diagram.aspectRatio
      )}.`
    );
  }
  if (!isArray(diagram.elements) || diagram.elements.length === 0) {
    add("missing_required_content", `${where} structured diagram must contain elements.`);
    return;
  }

  const elementIds = new Set<string>();
  diagram.elements.forEach((element, index) => {
    validateDiagramElement(element, `${where} diagram element[${index}]`, elementIds, add);
  });
}

function validateDiagramElement(
  element: ExerciseDiagramElement,
  where: string,
  elementIds: Set<string>,
  add: AddIssue
): void {
  if (element === null || typeof element !== "object") {
    add("unsupported_diagram_element_kind", `${where} is malformed.`);
    return;
  }
  if (!isOneOf(element.kind, EXERCISE_DIAGRAM_ELEMENT_KINDS)) {
    add(
      "unsupported_diagram_element_kind",
      `${where} has unsupported kind ${JSON.stringify(
        (element as { kind?: unknown }).kind
      )}. Unsupported diagram content must never be silently dropped.`
    );
    return;
  }
  if (!isNonEmptyString(element.id)) {
    add("missing_required_content", `${where} must have a non-empty id.`);
  } else if (elementIds.has(element.id)) {
    add("missing_required_content", `${where} reuses element id "${element.id}".`);
  } else {
    elementIds.add(element.id);
  }

  const requirePoints = (points: readonly unknown[], names: string) => {
    if (!points.every(isNormalizedPoint)) {
      add(
        "invalid_normalized_coordinate",
        `${where} ${names} must be normalized points with x and y in [0, 1].`
      );
    }
  };

  switch (element.kind) {
    case "sheet":
    case "line":
    case "arrow":
    case "target-zone": {
      requirePoints([element.from, element.to], "from/to");
      if (element.kind === "line" && !isOneOf(element.style, VALID_LINE_STYLES)) {
        add(
          "unsupported_diagram_element_kind",
          `${where} has an unsupported line style ${JSON.stringify(element.style)}.`
        );
      }
      if (element.kind === "target-zone") {
        if (element.sequenceStep !== undefined && !isPositiveInteger(element.sequenceStep)) {
          add(
            "missing_required_content",
            `${where} sequenceStep must be a positive integer when present.`
          );
        }
        if (element.label !== undefined && !isNonEmptyString(element.label)) {
          add("missing_required_content", `${where} label must be non-empty when present.`);
        }
      }
      if (element.kind === "arrow" && element.label !== undefined && !isNonEmptyString(element.label)) {
        add("missing_required_content", `${where} label must be non-empty when present.`);
      }
      return;
    }
    case "house": {
      requirePoints([element.center], "center");
      if (
        !isArray(element.radii) ||
        element.radii.length === 0 ||
        !element.radii.every(
          (radius) =>
            typeof radius === "number" && Number.isFinite(radius) && radius > 0 && radius <= 1
        )
      ) {
        add(
          "invalid_normalized_coordinate",
          `${where} house radii must be normalized values in (0, 1].`
        );
        return;
      }
      for (let i = 1; i < element.radii.length; i++) {
        if (element.radii[i] >= element.radii[i - 1]) {
          add(
            "invalid_normalized_coordinate",
            `${where} house radii must be strictly decreasing (outermost first).`
          );
          return;
        }
      }
      return;
    }
    case "stone": {
      requirePoints([element.at], "at");
      if (!isOneOf(element.role, VALID_STONE_ROLES)) {
        add(
          "unsupported_diagram_element_kind",
          `${where} has an unsupported stone role ${JSON.stringify(element.role)}.`
        );
      }
      if (element.sequenceLabel !== undefined && !isNonEmptyString(element.sequenceLabel)) {
        add("missing_required_content", `${where} sequenceLabel must be non-empty when present.`);
      }
      return;
    }
    case "path": {
      if (!isArray(element.points) || element.points.length < 2) {
        add(
          "invalid_normalized_coordinate",
          `${where} path must contain at least two normalized points.`
        );
      } else {
        requirePoints(element.points, "points");
      }
      if (!isOneOf(element.style, VALID_LINE_STYLES)) {
        add(
          "unsupported_diagram_element_kind",
          `${where} has an unsupported path style ${JSON.stringify(element.style)}.`
        );
      }
      return;
    }
    case "label": {
      requirePoints([element.at], "at");
      if (!isNonEmptyString(element.text)) {
        add("missing_required_content", `${where} label text must be non-empty English text.`);
      }
      if (element.anchor !== undefined && !isOneOf(element.anchor, VALID_TEXT_ANCHORS)) {
        add(
          "unsupported_diagram_element_kind",
          `${where} has an unsupported text anchor ${JSON.stringify(element.anchor)}.`
        );
      }
      return;
    }
  }
}
