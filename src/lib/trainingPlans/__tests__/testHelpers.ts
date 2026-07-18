import type { ReleaseTimingPlanStep, Session, TrainingPlan } from "../../../types";

export function buildStep(
  overrides: Partial<ReleaseTimingPlanStep> = {}
): ReleaseTimingPlanStep {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    type: "release-timing",
    completion: overrides.completion ?? { type: "shot-count", value: 4 },
    handleStrategy: overrides.handleStrategy ?? { type: "free" },
    configuration: {
      name: "",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
      variableTargetMode: "smart-random",
      blindTargetMode: "fixed",
      smartRandomMin: 2.5,
      smartRandomMax: 4.5,
      accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
      ...overrides.configuration,
    },
  };
}

export function buildPlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  const now = "2026-01-01T00:00:00.000Z";

  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? "Release Consistency",
    description: overrides.description,
    steps: overrides.steps ?? [buildStep()],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    schemaVersion: overrides.schemaVersion ?? 1,
  };
}

export function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "Training Session",
    date: overrides.date ?? "2026-01-01T00:00:00.000Z",
    notes: overrides.notes ?? "",
    blocks: overrides.blocks ?? [],
    activeBlockId: overrides.activeBlockId ?? "",
    shots: overrides.shots ?? [],
    captureSequence: overrides.captureSequence,
    planExecution: overrides.planExecution,
  };
}
