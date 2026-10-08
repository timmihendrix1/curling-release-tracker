// @vitest-environment jsdom
//
// Unreadable template/plan storage must stay protected and intact. The application's
// ordinary save effect writes the loaded state straight back, so handing it an empty
// or silently shortened value turns "this build cannot represent that" into permanent
// data loss on the very next save.
import { beforeEach, describe, expect, it } from "vitest";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import { createAccuracyToleranceProfilesRepository } from "../repository";
import {
  ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
  ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY,
  LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
} from "../persistence";
import { createTrainingPlansRepository } from "../../trainingPlans/repository";
import { TRAINING_PLANS_STORAGE_KEY } from "../../trainingPlans/persistence";
import { buildPlan, buildStep } from "../../trainingPlans/__tests__/testHelpers";
import { duplicateAccuracyToleranceProfile, buildAccuracyToleranceProfile } from "../profiles";
import {
  BOTH_CONFIGURATION,
  SPEED_CONFIGURATION,
} from "../../measurement/__tests__/measurementFixtures";

const NOW = "2026-10-06T10:00:00.000Z";

function store(key: string, value: unknown): string {
  const bytes = JSON.stringify(value);
  window.localStorage.setItem(key, bytes);
  return bytes;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("tolerance template storage", () => {
  it("protects an unsupported future schema instead of handing back an empty state", async () => {
    const bytes = store(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY, {
      schemaVersion: 999,
      profiles: [{ id: "valuable" }],
      defaultProfileId: null,
    });

    const result = await createAccuracyToleranceProfilesRepository(
      createLocalStorageAdapter()
    ).loadState();

    expect(result.status).toBe("read_failed");
    expect(window.localStorage.getItem(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY)).toBe(bytes);
  });

  it("protects a template whose unit this build does not know, rather than dropping it", async () => {
    const bytes = store(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY, {
      schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [
        {
          id: "valuable",
          name: "Future unit",
          quantity: "spin",
          tolerance: {
            onTarget: { lower: 1, upper: 1 },
            acceptable: { lower: 2, upper: 2 },
          },
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      defaultProfileId: "valuable",
    });

    const result = await createAccuracyToleranceProfilesRepository(
      createLocalStorageAdapter()
    ).loadState();

    expect(result.status).toBe("read_failed");
    expect(window.localStorage.getItem(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY)).toBe(bytes);
  });

  it("distinguishes genuine absence from unreadable data", async () => {
    const result = await createAccuracyToleranceProfilesRepository(
      createLocalStorageAdapter()
    ).loadState();
    expect(result.status).toBe("absent");
  });

  it("refuses an invalid write without touching stored bytes", async () => {
    const bytes = store(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY, {
      schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [],
      defaultProfileId: null,
    });

    const repository = createAccuracyToleranceProfilesRepository(createLocalStorageAdapter());
    const result = await repository.saveState({
      schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [
        {
          id: "p",
          name: "Bad",
          quantity: "future",
          tolerance: {},
          createdAt: NOW,
          updatedAt: NOW,
        } as never,
      ],
      defaultProfileId: null,
    });

    expect(result.ok).toBe(false);
    expect(window.localStorage.getItem(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY)).toBe(bytes);
  });

  it("still loads valid version-1 templates losslessly", async () => {
    store(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY, {
      schemaVersion: LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [
        { id: "p1", name: "Standard", onTarget: 0.1, acceptable: 0.2, createdAt: NOW, updatedAt: NOW },
      ],
      defaultProfileId: "p1",
    });

    const result = await createAccuracyToleranceProfilesRepository(
      createLocalStorageAdapter()
    ).loadState();

    expect(result.status).toBe("value");
    if (result.status !== "value") return;
    expect(result.value.profiles[0].quantity).toBe("time");
    expect(result.value.profiles[0].tolerance).toEqual({
      onTarget: { lower: 0.1, upper: 0.1 },
      acceptable: { lower: 0.2, upper: 0.2 },
    });
  });
});

describe("training plan storage", () => {
  it("protects an unsupported future schema carrying valid measurement-aware plans", async () => {
    const step = buildStep();
    step.configuration = {
      ...step.configuration,
      measurement: structuredClone(SPEED_CONFIGURATION),
    };
    delete step.configuration.targetTime;
    delete step.configuration.measurementMode;

    const bytes = store(TRAINING_PLANS_STORAGE_KEY, {
      schemaVersion: 999,
      plans: [
        { id: "plan", name: "Important", steps: [step], createdAt: NOW, updatedAt: NOW },
      ],
    });

    const result = await createTrainingPlansRepository(
      createLocalStorageAdapter()
    ).loadPlans();

    expect(result.status).toBe("read_failed");
    expect(window.localStorage.getItem(TRAINING_PLANS_STORAGE_KEY)).toBe(bytes);
  });

  it("distinguishes genuine absence from unreadable data", async () => {
    const result = await createTrainingPlansRepository(
      createLocalStorageAdapter()
    ).loadPlans();
    expect(result.status).toBe("absent");
  });

  it.each([
    ["unparseable JSON", '{"schemaVersion":2,"plans":['],
    ["a non-array plans field", '{"schemaVersion":2,"plans":{"important":"data"}}'],
    ["a plan that is not an object", '{"schemaVersion":2,"plans":["oops"]}'],
    ["a plan without an identity", '{"schemaVersion":2,"plans":[{"name":"x","steps":[]}]}'],
    ["a plan without a step list", '{"schemaVersion":2,"plans":[{"id":"p","name":"x"}]}'],
    ["a step that is not an object", '{"schemaVersion":2,"plans":[{"id":"p","name":"x","steps":[null]}]}'],
    ["duplicate plan identities", '{"schemaVersion":2,"plans":[{"id":"p","name":"a","steps":[]},{"id":"p","name":"b","steps":[]}]}'],
  ])("protects %s, leaving the stored bytes untouched", async (_label, bytes) => {
    window.localStorage.setItem(TRAINING_PLANS_STORAGE_KEY, bytes);

    const result = await createTrainingPlansRepository(
      createLocalStorageAdapter()
    ).loadPlans();

    expect(result.status).toBe("read_failed");
    expect(window.localStorage.getItem(TRAINING_PLANS_STORAGE_KEY)).toBe(bytes);
  });

  // Each of these is a plan migration would silently damage: the plan is dropped
  // entirely, or its step is given a freshly minted identity. Either way the damaged
  // library is what the save effect writes back.
  type MutablePlan = {
    id: string;
    steps: {
      id?: string;
      type?: string;
      exerciseVersionSnapshot?: unknown;
      configuration?: Record<string, unknown>;
    }[];
  };

  const LOSSY_STEP: Record<string, (plan: MutablePlan) => void> = {
    "a step with no identity": (plan) => {
      delete plan.steps[0].id;
    },
    "a step whose kind this build does not know": (plan) => {
      plan.steps[0].type = "future";
    },
    "a step with no Exercise Version snapshot": (plan) => {
      delete plan.steps[0].exerciseVersionSnapshot;
    },
  };

  function measurementAwarePlan() {
    const step = buildStep();
    step.configuration = {
      ...step.configuration,
      measurement: structuredClone(BOTH_CONFIGURATION),
      targetTime: BOTH_CONFIGURATION.time!.target,
    };
    return buildPlan({ steps: [step] });
  }

  it.each(Object.entries(LOSSY_STEP))(
    "protects a stored measurement-aware plan with %s",
    async (_label, mutate) => {
      const plan = measurementAwarePlan();
      mutate(plan as unknown as MutablePlan);
      const bytes = store(TRAINING_PLANS_STORAGE_KEY, { schemaVersion: 2, plans: [plan] });

      const result = await createTrainingPlansRepository(
        createLocalStorageAdapter()
      ).loadPlans();

      expect(result.status).toBe("read_failed");
      expect(window.localStorage.getItem(TRAINING_PLANS_STORAGE_KEY)).toBe(bytes);
    }
  );

  it.each(Object.entries(LOSSY_STEP))(
    "refuses to write a measurement-aware plan with %s",
    async (_label, mutate) => {
      const bytes = store(TRAINING_PLANS_STORAGE_KEY, { schemaVersion: 2, plans: [] });
      const plan = measurementAwarePlan();
      mutate(plan as unknown as MutablePlan);

      const repository = createTrainingPlansRepository(createLocalStorageAdapter());
      expect((await repository.savePlans([plan])).ok).toBe(false);
      expect(window.localStorage.getItem(TRAINING_PLANS_STORAGE_KEY)).toBe(bytes);
    }
  );

  it("keeps a readable plan whose configuration is merely semantically invalid", async () => {
    // Hog-Hog with Smart Random has no validated range, so the step is not
    // EXECUTABLE — but the plan is perfectly readable and the athlete can edit it.
    // That distinction must survive: this is not structurally unreadable data.
    const plan = measurementAwarePlan();
    const semantic = plan as unknown as MutablePlan;
    semantic.steps[0] = {
      ...semantic.steps[0],
      configuration: {
        ...semantic.steps[0].configuration,
        measurementMode: "hog-hog",
        variableTargetMode: "smart-random",
        mode: "variable",
        measurement: undefined,
      },
    };
    store(TRAINING_PLANS_STORAGE_KEY, { schemaVersion: 2, plans: [plan] });

    const result = await createTrainingPlansRepository(
      createLocalStorageAdapter()
    ).loadPlans();

    expect(result.status).toBe("value");
    if (result.status !== "value") return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe(semantic.id);
    expect(result.value[0].steps[0].id).toBe(semantic.steps[0].id);
  });

  it("accepts a valid measurement-aware plan and preserves plan and step identity", async () => {
    const plan = measurementAwarePlan();
    const repository = createTrainingPlansRepository(createLocalStorageAdapter());

    expect((await repository.savePlans([plan])).ok).toBe(true);

    const result = await repository.loadPlans();
    expect(result.status).toBe("value");
    if (result.status !== "value") return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe(plan.id);
    expect(result.value[0].steps[0].id).toBe(plan.steps[0].id);
  });

  it("still migrates a legitimate schema-1 library, preserving identities", async () => {
    // Version 1 steps carry no Exercise Version snapshot; migration substitutes the
    // curated Release Time one. That is lossless in identity terms and must keep working.
    const legacyStep = {
      id: "step-1",
      completion: { type: "shot-count", value: 8 },
      handleStrategy: { type: "free" },
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
      },
    };
    store(TRAINING_PLANS_STORAGE_KEY, {
      schemaVersion: 1,
      plans: [
        {
          id: "legacy-plan",
          name: "Legacy",
          steps: [legacyStep],
          createdAt: NOW,
          updatedAt: NOW,
          schemaVersion: 1,
        },
      ],
    });

    const result = await createTrainingPlansRepository(
      createLocalStorageAdapter()
    ).loadPlans();

    expect(result.status).toBe("value");
    if (result.status !== "value") return;
    expect(result.value[0].id).toBe("legacy-plan");
    expect(result.value[0].steps[0].id).toBe("step-1");
  });

  it("still reads a genuinely empty library as a value", async () => {
    window.localStorage.setItem(
      TRAINING_PLANS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 2, plans: [] })
    );

    const result = await createTrainingPlansRepository(
      createLocalStorageAdapter()
    ).loadPlans();

    expect(result.status).toBe("value");
    if (result.status !== "value") return;
    expect(result.value).toEqual([]);
  });

  it("refuses a write this implementation could not read back", async () => {
    const bytes = JSON.stringify({ schemaVersion: 2, plans: [] });
    window.localStorage.setItem(TRAINING_PLANS_STORAGE_KEY, bytes);

    const repository = createTrainingPlansRepository(createLocalStorageAdapter());
    const result = await repository.savePlans([
      { id: "p", steps: [] } as never,
    ]);

    expect(result.ok).toBe(false);
    expect(window.localStorage.getItem(TRAINING_PLANS_STORAGE_KEY)).toBe(bytes);
  });
});

describe("template duplication", () => {
  it("does not share nested tolerance bands with the original", () => {
    const built = buildAccuracyToleranceProfile(
      { name: "Original", onTarget: 0.1, acceptable: 0.2 },
      NOW
    );
    if (!built.ok) throw new Error("expected a valid template");

    const copy = duplicateAccuracyToleranceProfile(built.value, NOW);
    copy.tolerance.onTarget.lower = 0.15;
    copy.tolerance.acceptable.upper = 0.9;

    expect(built.value.tolerance.onTarget.lower).toBe(0.1);
    expect(built.value.tolerance.acceptable.upper).toBe(0.2);
  });
});
