// @vitest-environment jsdom
//
// Unit-safe tolerance templates (ADR-0051): a template carries the quantity its
// numbers are expressed in and per-side bands. Legacy time presets keep their exact
// meaning and are never reinterpreted as speed presets.
import { beforeEach, describe, expect, it } from "vitest";
import { createAccuracyToleranceProfilesRepository } from "../repository";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import {
  ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
  ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY,
  LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
} from "../persistence";
import type { AccuracyToleranceProfileInput } from "../profiles";
import {
  accuracyToleranceProfilesFor,
  buildAccuracyToleranceProfile,
  isProfileCompatibleWithQuantity,
  legacySelectableProfiles,
  profileSymmetricPair,
  profileToleranceLabel,
} from "../profiles";
import { migrateAccuracyToleranceProfilesState } from "../migration";
import { createTrainingBlock } from "../../trainingBlocks";
import { symmetricTolerance } from "../../measurement/tolerance";

const NOW = "2026-10-06T10:00:00.000Z";

function build(
  name: string,
  overrides: Omit<AccuracyToleranceProfileInput, "name">
) {
  const result = buildAccuracyToleranceProfile({ ...overrides, name }, NOW);
  if (!result.ok) throw new Error(`expected a valid template: ${result.error.message}`);
  return result.value;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("legacy time presets keep their exact meaning", () => {
  it("migrates a stored version-1 template forward without changing its numbers", () => {
    const migrated = migrateAccuracyToleranceProfilesState({
      schemaVersion: LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [
        {
          id: "p1",
          name: "Standard",
          onTarget: 0.1,
          acceptable: 0.2,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      defaultProfileId: "p1",
    });

    expect(migrated.schemaVersion).toBe(ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION);
    expect(migrated.profiles[0].quantity).toBe("time");
    expect(migrated.profiles[0].tolerance).toEqual(symmetricTolerance(0.1, 0.2));
    expect(migrated.defaultProfileId).toBe("p1");
  });

  it("never reinterprets a legacy preset as a speed preset", () => {
    const migrated = migrateAccuracyToleranceProfilesState({
      schemaVersion: LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [
        { id: "p1", name: "Tight", onTarget: 0.05, acceptable: 0.1, createdAt: NOW, updatedAt: NOW },
      ],
      defaultProfileId: null,
    });

    expect(migrated.profiles[0].quantity).toBe("time");
    expect(accuracyToleranceProfilesFor(migrated.profiles, "speed")).toEqual([]);
  });

  it("is idempotent once migrated", () => {
    const once = migrateAccuracyToleranceProfilesState({
      schemaVersion: LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [
        { id: "p1", name: "Standard", onTarget: 0.1, acceptable: 0.2, createdAt: NOW, updatedAt: NOW },
      ],
      defaultProfileId: "p1",
    });
    const twice = migrateAccuracyToleranceProfilesState(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it("survives a real repository round trip", async () => {
    const repository = createAccuracyToleranceProfilesRepository(createLocalStorageAdapter());
    const speed = build("Elite speed", {
      quantity: "speed",
      tolerance: { onTarget: { lower: 0.03, upper: 0.07 }, acceptable: { lower: 0.08, upper: 0.12 } },
    });
    const time = build("Standard", { onTarget: 0.1, acceptable: 0.2 });

    expect(
      (await repository.saveState({
        schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
        profiles: [time, speed],
        defaultProfileId: time.id,
      })).ok
    ).toBe(true);

    const loaded = await repository.loadState();
    expect(loaded.status).toBe("value");
    if (loaded.status !== "value") return;
    expect(loaded.value.profiles).toEqual([time, speed]);
  });

  it("drops a stored template whose unit this build does not know, rather than assuming seconds", () => {
    window.localStorage.setItem(
      ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
        profiles: [
          {
            id: "p1",
            name: "Future",
            quantity: "rotation",
            tolerance: symmetricTolerance(0.1, 0.2),
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        defaultProfileId: "p1",
      })
    );

    const migrated = migrateAccuracyToleranceProfilesState(
      JSON.parse(window.localStorage.getItem(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY)!)
    );
    expect(migrated.profiles).toEqual([]);
    expect(migrated.defaultProfileId).toBeNull();
  });
});

describe("unit compatibility", () => {
  it("never offers a speed template for a time measurement, or the reverse", () => {
    const time = build("Standard", { onTarget: 0.1, acceptable: 0.2 });
    const speed = build("Speed", { quantity: "speed", onTarget: 0.05, acceptable: 0.1 });

    expect(isProfileCompatibleWithQuantity(time, "time")).toBe(true);
    expect(isProfileCompatibleWithQuantity(time, "speed")).toBe(false);
    expect(isProfileCompatibleWithQuantity(speed, "speed")).toBe(true);
    expect(isProfileCompatibleWithQuantity(speed, "time")).toBe(false);

    expect(accuracyToleranceProfilesFor([time, speed], "time")).toEqual([time]);
    expect(accuracyToleranceProfilesFor([time, speed], "speed")).toEqual([speed]);
  });

  it("withholds a speed or asymmetric template from the symmetric time-only selector", () => {
    const time = build("Standard", { onTarget: 0.1, acceptable: 0.2 });
    const speed = build("Speed", { quantity: "speed", onTarget: 0.05, acceptable: 0.1 });
    const asymmetric = build("Asymmetric", {
      tolerance: { onTarget: { lower: 0.05, upper: 0.12 }, acceptable: { lower: 0.1, upper: 0.2 } },
    });

    expect(legacySelectableProfiles([time, speed, asymmetric])).toEqual([time]);
    // The asymmetric template is still stored faithfully — only not offered there.
    expect(profileSymmetricPair(asymmetric)).toBeUndefined();
    expect(asymmetric.tolerance.onTarget.upper).toBe(0.12);
  });

  it("rejects supplying both a symmetric pair and per-side tolerances", () => {
    const result = buildAccuracyToleranceProfile(
      { name: "Contradictory", onTarget: 0.1, acceptable: 0.2, tolerance: symmetricTolerance(0.3, 0.4) },
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a per-side tolerance whose Acceptable does not extend beyond On Target", () => {
    const result = buildAccuracyToleranceProfile(
      {
        name: "Invalid",
        tolerance: { onTarget: { lower: 0.1, upper: 0.05 }, acceptable: { lower: 0.1, upper: 0.2 } },
      },
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("labels each template with its own unit", () => {
    expect(profileToleranceLabel(build("T", { onTarget: 0.1, acceptable: 0.2 }))).toBe(
      "On Target ±0.10s · Acceptable ±0.20s"
    );
    expect(
      profileToleranceLabel(build("S", { quantity: "speed", onTarget: 0.05, acceptable: 0.1 }))
    ).toBe("On Target ±0.05m/s · Acceptable ±0.10m/s");
  });
});

describe("a block created from a template is independent of it", () => {
  it("is unaffected by editing or deleting the template afterwards", async () => {
    const repository = createAccuracyToleranceProfilesRepository(createLocalStorageAdapter());
    const template = build("Elite speed", {
      quantity: "speed",
      tolerance: { onTarget: { lower: 0.03, upper: 0.07 }, acceptable: { lower: 0.08, upper: 0.12 } },
    });

    await repository.saveState({
      schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [template],
      defaultProfileId: template.id,
    });

    const block = createTrainingBlock({
      name: "Speed",
      mode: "fixed",
      measurement: {
        quantities: ["speed"],
        speed: { target: 2.4, tolerance: template.tolerance },
      },
    });

    // Edit the template, then delete it entirely.
    const edited = build("Elite speed", {
      id: template.id,
      quantity: "speed",
      tolerance: { onTarget: { lower: 0.5, upper: 0.5 }, acceptable: { lower: 0.6, upper: 0.6 } },
      createdAt: template.createdAt,
    });
    await repository.saveState({
      schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [edited],
      defaultProfileId: edited.id,
    });
    await repository.saveState({
      schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [],
      defaultProfileId: null,
    });

    expect(block.measurement!.speed!.tolerance).toEqual({
      onTarget: { lower: 0.03, upper: 0.07 },
      acceptable: { lower: 0.08, upper: 0.12 },
    });
  });
});
