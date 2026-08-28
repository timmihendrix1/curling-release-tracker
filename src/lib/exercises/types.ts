// Exercise Library domain types — Stage A (domain and curated-content foundation).
//
// The authoritative product/domain source is
// docs/EXERCISE_LIBRARY_AND_EXECUTION_SPECIFICATION.md. Stage A implements only the
// content side of that specification: a stable Exercise identity, immutable
// Exercise Versions, reusable Measurement Protocols, the two Diagram variants, and
// the versioned curated catalog package they are delivered in. Stage B1's
// separate executionTypes.ts builds on these content contracts; Team sessions,
// persistence and execution UI remain absent — see that document's section 21.
//
// These types live in their own module rather than in `src/types/index.ts`,
// following `src/lib/assessment/types.ts`: nothing in `src/types/index.ts`
// references an Exercise, so there is no dependency cycle to avoid (contrast
// ADR-0012 Decision 2, where `Session.planExecution` forced Training Plan types
// to live centrally). Shared concepts whose semantics are identical are imported
// from the existing Training domain rather than redefined — see
// `MeasurementMode`/`TimingProviderType` below.
import type { MeasurementMode, TimingProviderType } from "../../types";

// ---------------------------------------------------------------------------
// Content language
// ---------------------------------------------------------------------------

/**
 * Every Stage A user-facing string is English. This is a declared content
 * property, not a localisation framework — spec section 3.6 explicitly rules
 * out introducing one for the curated Version 1 records. Original German
 * source titles survive only as non-displayed source metadata (see
 * `ExerciseSourceMetadata`).
 */
export type ExerciseContentLanguage = "en";

export const SUPPORTED_EXERCISE_CONTENT_LANGUAGES: readonly ExerciseContentLanguage[] =
  ["en"];

// ---------------------------------------------------------------------------
// Classification — independent dimensions, never one overloaded `type`
// (spec section 4)
// ---------------------------------------------------------------------------

/** Spec 4.1. `Consistency` is a Training Purpose, never a fourth focus. */
export type ExercisePrimaryFocus = "technique" | "shotmaking" | "measured";

export const EXERCISE_PRIMARY_FOCUSES: readonly ExercisePrimaryFocus[] = [
  "technique",
  "shotmaking",
  "measured",
];

/** Spec 4.2 — the curling task, independent of Primary Exercise Focus. */
export type ExerciseShotFamily =
  | "guard"
  | "draw"
  | "freeze"
  | "tap"
  | "take-out"
  | "soft-take-out"
  | "sequence";

export const EXERCISE_SHOT_FAMILIES: readonly ExerciseShotFamily[] = [
  "guard",
  "draw",
  "freeze",
  "tap",
  "take-out",
  "soft-take-out",
  "sequence",
];

/** Spec 4.3 — what capability the Exercise develops. */
export type ExerciseTrainingPurpose =
  | "repeatability"
  | "consistency"
  | "weight-control"
  | "weight-control-awareness"
  | "line-control"
  | "handle-control"
  | "release-location-control"
  | "rotation-control"
  | "progressive-distance-control"
  | "setup-discipline";

export const EXERCISE_TRAINING_PURPOSES: readonly ExerciseTrainingPurpose[] = [
  "repeatability",
  "consistency",
  "weight-control",
  "weight-control-awareness",
  "line-control",
  "handle-control",
  "release-location-control",
  "rotation-control",
  "progressive-distance-control",
  "setup-discipline",
];

export const MIN_EXERCISE_DIFFICULTY_LEVEL = 1;
export const MAX_EXERCISE_DIFFICULTY_LEVEL = 6;

/**
 * Spec 5.2: "difficulty from 1 to 6, or a bounded difficulty range". Optional
 * on an Exercise Version — a curated Exercise whose source states no level is
 * left unrated rather than assigned an invented one.
 */
export type ExerciseDifficulty =
  | { kind: "level"; level: number }
  | { kind: "range"; min: number; max: number };

// ---------------------------------------------------------------------------
// Participation, roles and sweeping (spec 4.4, 5.3)
// ---------------------------------------------------------------------------

/** Participation modes, never ownership or visibility states (spec 4.4). */
export type ExerciseParticipationMode = "solo" | "team";

export const EXERCISE_PARTICIPATION_MODES: readonly ExerciseParticipationMode[] = [
  "solo",
  "team",
];

/** Spec 8.1 — a participant may rotate between these during an execution. */
export type ExerciseParticipantRole =
  | "delivering-athlete"
  | "sweeper"
  | "skip"
  | "observer"
  | "coach"
  | "timekeeper";

export const EXERCISE_PARTICIPANT_ROLES: readonly ExerciseParticipantRole[] = [
  "delivering-athlete",
  "sweeper",
  "skip",
  "observer",
  "coach",
  "timekeeper",
];

export type ExerciseRequirementLevel = "required" | "optional";

export type ExerciseRoleRequirement = {
  role: ExerciseParticipantRole;
  requirement: ExerciseRequirementLevel;
  /** English note explaining the role in this Exercise. */
  note?: string;
};

export type ExerciseParticipationProfile = {
  /** Non-empty. Which participation modes the standard protocol supports. */
  supportedModes: readonly ExerciseParticipationMode[];
  /** At least 1. */
  minTrainingAthletes: number;
  /** `null` means the standard protocol sets no upper bound. */
  maxTrainingAthletes: number | null;
  roles: readonly ExerciseRoleRequirement[];
  /** English one-line summary shown in the Library and detail. */
  summary: string;
};

/** Spec 5.3. */
export type ExerciseSweepingPolicy = "forbidden" | "optional" | "required";

export const EXERCISE_SWEEPING_POLICIES: readonly ExerciseSweepingPolicy[] = [
  "forbidden",
  "optional",
  "required",
];

/** Spec 18.1 — zero, one or two Sweepers. */
export const MAX_EXERCISE_SWEEPER_COUNT = 2;

export type ExerciseSweepingRequirement = {
  policy: ExerciseSweepingPolicy;
  /**
   * Non-empty, integers within 0..MAX_EXERCISE_SWEEPER_COUNT. Must be exactly
   * `[0]` when the policy forbids sweeping, must exclude 0 when it is required,
   * and must contain both 0 and a positive count when it is optional —
   * validated, never assumed (see `validation.ts`).
   */
  allowedSweeperCounts: readonly number[];
  recommendedSweeperCount?: number;
  /** English explanation. */
  note: string;
};

// ---------------------------------------------------------------------------
// Content bodies
// ---------------------------------------------------------------------------

export type ExerciseInstructionStep = {
  id: string;
  /** English. */
  text: string;
};

export type ExerciseEquipmentRequirement = {
  id: string;
  /** English. */
  label: string;
  requirement: ExerciseRequirementLevel;
  note?: string;
};

/**
 * Optional: only stated where the curated source actually states one. An
 * Exercise with no recommended volume shows none, rather than a fabricated
 * default.
 */
export type ExerciseRecommendedVolume =
  | { kind: "stone-count"; stones: number; note?: string }
  | { kind: "repetition-count"; repetitions: number; note?: string }
  | { kind: "open"; note: string };

export type ExerciseVariation = {
  id: string;
  /** English. */
  label: string;
  description?: string;
};

/** Spec 11.1 — curling's familiar 0-4 scale and its percentage mapping. */
export type ExerciseScoreScaleEntry = {
  score: number;
  percentage: number;
};

/**
 * Focus-appropriate guidance. The generic detail renderer branches on this
 * declared domain `kind` — never on an Exercise ID or title.
 */
export type ExerciseGuidance =
  | {
      /**
       * Technique and Measured Exercises: what to observe, plus an explicit
       * statement of what the application does *not* produce (spec 10.1).
       */
      kind: "observation";
      observations: readonly string[];
      /** English. e.g. "The app awards no score, points, ... or technique rating." */
      noScoringNote: string;
    }
  | {
      /**
       * Shotmaking Exercises in the closed beta: the generic 0-4 capture
       * mechanism with no platform-authored, exercise-specific rubric
       * (spec 11.4).
       */
      kind: "generic-shotmaking-score";
      scale: readonly ExerciseScoreScaleEntry[];
      explanation: readonly string[];
      /** Retained with every future execution so analytics cannot mistake it for a standard rubric. */
      evaluationBasis: "team-defined-unstructured";
      evaluationBasisNote: string;
    };

/**
 * Spec 11.5 — a source collection's reference goal is preserved as descriptive
 * context and is never scored, derived or shown as passed/failed. `evaluated`
 * is a literal `false` so no caller can express the opposite, and is validated
 * at the catalog boundary for untrusted data.
 */
export type ExerciseSourceReferenceGoal = {
  /** English. */
  text: string;
  evaluated: false;
};

// ---------------------------------------------------------------------------
// Source and provenance (spec 5.4)
// ---------------------------------------------------------------------------

export type ExerciseSourceKind = "platform-curated" | "external-collection";

export const EXERCISE_SOURCE_KINDS: readonly ExerciseSourceKind[] = [
  "platform-curated",
  "external-collection",
];

/**
 * Source metadata that must never be rendered. It exists for attribution
 * traceability and Library search only — matching a German alias still
 * displays exclusively English content (spec 3.6).
 */
export type ExerciseSourceMetadata = {
  originalTitles: readonly string[];
  searchAliases: readonly string[];
};

export type ExerciseSource = {
  kind: ExerciseSourceKind;
  /** English, always displayed. Required for every Exercise Version. */
  attribution: string;
  organization?: string;
  /** English name of the source collection, if any. */
  collectionName?: string;
  collectionVersion?: string;
  /** English reference to the source exercise, e.g. "Guard Exercise 10". */
  sourceExerciseReference?: string;
  sourcePage?: number;
  /** English provenance note explaining how the platform adapted the source. */
  provenanceNote?: string;
  nonDisplayedSourceMetadata?: ExerciseSourceMetadata;
};

// ---------------------------------------------------------------------------
// Measurement Protocols (spec 12.1) — reusable, versioned definitions, never
// duplicated as ad-hoc fields inside each Exercise.
// ---------------------------------------------------------------------------

/** Reusable factual metrics currently supported by Exercise execution. */
export type MeasurementMetricType = "release-time" | "rotation-count";

export const MEASUREMENT_METRIC_TYPES: readonly MeasurementMetricType[] = [
  "release-time",
  "rotation-count",
];

export type MeasurementUnit = "seconds" | "rotations";

export const MEASUREMENT_UNITS: readonly MeasurementUnit[] = ["seconds", "rotations"];

export type MeasurementProtocol = {
  id: string;
  /** Positive integer. A semantic change requires a new version, never an edit. */
  version: number;
  /** English display name, e.g. "Release Time (Backline - Hog)". */
  name: string;
  metricType: MeasurementMetricType;
  unit: MeasurementUnit;
  /**
   * Reuses the existing Training domain `MeasurementMode` because the reference
   * points are identical — this is not a second, competing definition of
   * Backline-Hog / Hog-Hog.
   */
  /** Required only for release-time protocols; absent for Rotation Count. */
  measurementMode?: MeasurementMode;
  /** English description of the reference points. */
  referencePoints: string;
  /**
   * Reuses `TimingProviderType` (`src/types/index.ts`), the existing "where a
   * measured value originated" union. Stage A lists only sources that actually
   * exist for content purposes; no protocol claims hardware support.
   */
  allowedSources: readonly TimingProviderType[];
  /** English completion/measurement guidance. */
  guidance: string;
  /**
   * Stage A prescribes no target or tolerance for a Training Exercise — always
   * `null`, validated. Assessment thresholds are a separate domain.
   */
  target: null;
};

export type ExerciseMeasurementProtocolReference = {
  protocolId: string;
  protocolVersion: number;
  requirement: ExerciseRequirementLevel;
};

// ---------------------------------------------------------------------------
// Diagrams (spec 6)
// ---------------------------------------------------------------------------

/**
 * `normalized-ice-sheet-v1`:
 * - `x` runs *along* the depicted section of the sheet in the direction of
 *   stone travel: 0 at the delivering athlete's edge of the section, 1 at the
 *   far edge.
 * - `y` runs *across* the sheet: 0 at one sideline, 1 at the other, centre
 *   line at 0.5.
 * - Every radius/length is expressed in `x` units (a fraction of the depicted
 *   section's length), so a circle stays a circle under the renderer's uniform
 *   viewBox scaling.
 *
 * Deliberately independent of pixels, viewport and the source document's page
 * geometry (spec 6.2), which is what makes it a usable future seam for
 * sensor-derived positions.
 */
export type ExerciseDiagramCoordinateSystem = "normalized-ice-sheet-v1";

export const EXERCISE_DIAGRAM_COORDINATE_SYSTEMS: readonly ExerciseDiagramCoordinateSystem[] =
  ["normalized-ice-sheet-v1"];

export type NormalizedPoint = { x: number; y: number };

export type ExerciseDiagramLineStyle = "solid" | "dashed";

export type ExerciseDiagramStoneRole = "delivered" | "setup" | "marker";

export type ExerciseDiagramTextAnchor = "start" | "middle" | "end";

/**
 * A versioned discriminated element union (spec 6.4) so new primitives can be
 * added later. An unsupported `kind` is rejected by catalog validation and, if
 * it ever reaches the renderer from untrusted data, shown as a visible failure
 * — it must never silently disappear from an Exercise.
 */
export type ExerciseDiagramElement =
  | { kind: "sheet"; id: string; from: NormalizedPoint; to: NormalizedPoint }
  | {
      kind: "line";
      id: string;
      from: NormalizedPoint;
      to: NormalizedPoint;
      style: ExerciseDiagramLineStyle;
    }
  | {
      kind: "house";
      id: string;
      center: NormalizedPoint;
      /** Ring radii in `x` units, outermost first. */
      radii: readonly number[];
    }
  | {
      kind: "stone";
      id: string;
      at: NormalizedPoint;
      role: ExerciseDiagramStoneRole;
      /** Short English sequence label, e.g. "3". */
      sequenceLabel?: string;
    }
  | { kind: "path"; id: string; points: readonly NormalizedPoint[]; style: ExerciseDiagramLineStyle }
  | {
      kind: "arrow";
      id: string;
      from: NormalizedPoint;
      to: NormalizedPoint;
      /** Short English label. */
      label?: string;
    }
  | {
      kind: "target-zone";
      id: string;
      from: NormalizedPoint;
      to: NormalizedPoint;
      /** 1-based step this zone belongs to, where the Exercise is a sequence. */
      sequenceStep?: number;
      /** Short English label rendered inside the zone. */
      label?: string;
    }
  | {
      kind: "label";
      id: string;
      at: NormalizedPoint;
      /** English. */
      text: string;
      anchor?: ExerciseDiagramTextAnchor;
    };

export type ExerciseDiagramElementKind = ExerciseDiagramElement["kind"];

export const EXERCISE_DIAGRAM_ELEMENT_KINDS: readonly ExerciseDiagramElementKind[] = [
  "sheet",
  "line",
  "house",
  "stone",
  "path",
  "arrow",
  "target-zone",
  "label",
];

/** Current structured-diagram element-union version. */
export const EXERCISE_DIAGRAM_SCHEMA_VERSION = 1;

/**
 * An opaque handle to a restricted source asset. Deliberately *not* a URL or a
 * public path: a restricted diagram must not be resolvable from the content
 * package itself, and the unavailable state must not be able to infer one.
 * Resolution requires an explicitly authorized resolver — see
 * `restrictedAssets.ts`.
 */
export type RestrictedAssetReference = {
  assetId: string;
};

export type RestrictedDistributionScope = "restricted-closed-beta";

export const RESTRICTED_DISTRIBUTION_SCOPES: readonly RestrictedDistributionScope[] = [
  "restricted-closed-beta",
];

export type RestrictedDistribution = {
  scope: RestrictedDistributionScope;
  /** English description of who may see this asset. */
  permittedAudience: string;
  /** Always `false` for a restricted asset — validated, not merely typed. */
  publicDeliveryPermitted: false;
};

export type ExerciseDiagram =
  | {
      kind: "structured-platform-diagram";
      id: string;
      schemaVersion: number;
      coordinateSystem: ExerciseDiagramCoordinateSystem;
      /** Depicted section length / sheet width. Positive and finite. */
      aspectRatio: number;
      /** English caption. */
      caption: string;
      /** English textual alternative — required, never derived from element data. */
      accessibleSummary: string;
      elements: readonly ExerciseDiagramElement[];
    }
  | {
      /**
       * The attributed-source-image variant (spec 6.3). Kept prepared and
       * validated in Stage A; no Stage A catalog Exercise uses it, and no
       * source image is bundled with the application.
       */
      kind: "attributed-source-image";
      id: string;
      /** English caption. */
      caption: string;
      /** English alt text. */
      accessibleSummary: string;
      assetReference: RestrictedAssetReference;
      /** English, always displayed with the diagram. */
      attribution: string;
      sourceOrganization: string;
      sourceVersion: string;
      distribution: RestrictedDistribution;
      /** English provenance note. */
      provenanceNote: string;
    };

export type ExerciseDiagramKind = ExerciseDiagram["kind"];

export const EXERCISE_DIAGRAM_KINDS: readonly ExerciseDiagramKind[] = [
  "structured-platform-diagram",
  "attributed-source-image",
];

// ---------------------------------------------------------------------------
// Exercise identity and immutable versions (spec 5.1)
// ---------------------------------------------------------------------------

/** Current curated content schema version for one Exercise Version's fields. */
export const EXERCISE_CONTENT_SCHEMA_VERSION = 1;

/**
 * The stable Library identity. It survives content revisions; all displayed
 * content lives on an immutable `ExerciseVersion`. Stage A publishes only
 * platform-curated Standard Exercises.
 */
export type Exercise = {
  id: string;
  /** The Exercise Version currently published for this identity. */
  currentVersionId: string;
};

/**
 * One immutable version of an Exercise's sporting meaning and presentation. A
 * meaningful content or diagram change creates a new version with a new `id`
 * and an incremented `version`; the previous version stays byte-identical and
 * independently resolvable so future history can never be silently rewritten.
 */
export type ExerciseVersion = {
  id: string;
  exerciseId: string;
  /** Positive integer, unique within one `exerciseId`. */
  version: number;
  contentSchemaVersion: number;
  contentLanguage: ExerciseContentLanguage;
  /** English display title. */
  title: string;
  primaryFocus: ExercisePrimaryFocus;
  shotFamily?: ExerciseShotFamily;
  primaryTrainingPurpose: ExerciseTrainingPurpose;
  additionalTrainingPurposes: readonly ExerciseTrainingPurpose[];
  difficulty?: ExerciseDifficulty;
  /** English. What the athlete is training. */
  goal: string;
  /** English. Why that capability matters. */
  whyItMatters: string;
  setupInstructions: readonly ExerciseInstructionStep[];
  executionInstructions: readonly ExerciseInstructionStep[];
  guidance: ExerciseGuidance;
  sourceReferenceGoal?: ExerciseSourceReferenceGoal;
  recommendedVolume?: ExerciseRecommendedVolume;
  variations: readonly ExerciseVariation[];
  participation: ExerciseParticipationProfile;
  sweeping: ExerciseSweepingRequirement;
  equipment: readonly ExerciseEquipmentRequirement[];
  compatibleMeasurementProtocols: readonly ExerciseMeasurementProtocolReference[];
  diagram?: ExerciseDiagram;
  source: ExerciseSource;
};

// ---------------------------------------------------------------------------
// Curated catalog package (spec 5.5)
// ---------------------------------------------------------------------------

/**
 * Exact package schema version. Stage A stores no catalog state, so there is
 * no persisted-history migration to write: a future package schema change
 * requires an explicit loader/migration or a deliberate, visible failure —
 * never a speculative multi-version migration built in advance.
 */
export const EXERCISE_CATALOG_PACKAGE_SCHEMA_VERSION = 1;

export type ExerciseCatalogPackage = {
  packageSchemaVersion: number;
  contentLanguage: ExerciseContentLanguage;
  exercises: readonly Exercise[];
  versions: readonly ExerciseVersion[];
  measurementProtocols: readonly MeasurementProtocol[];
};
