import { describe, expect, it } from "vitest";
import { migrateAccuracyToleranceProfilesState } from "../migration";
import {
  ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
  serializeAccuracyToleranceProfilesState,
  type AccuracyToleranceProfilesState,
} from "../persistence";

const VALID_PROFILE = {
  id: "p1",
  name: "Elite",
  onTarget: 0.05,
  acceptable: 0.1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("migrateAccuracyToleranceProfilesState — legacy/no-data state", () => {
  it("resolves null to an empty state (fresh install, no profiles saved yet)", () => {
    const result = migrateAccuracyToleranceProfilesState(null);
    expect(result).toEqual({
      schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [],
      defaultProfileId: null,
    });
  });

  it("resolves undefined the same way", () => {
    expect(migrateAccuracyToleranceProfilesState(undefined).profiles).toEqual([]);
  });
});

describe("migrateAccuracyToleranceProfilesState — malformed data fails safely", () => {
  it("does not throw on a non-object", () => {
    expect(() => migrateAccuracyToleranceProfilesState("garbage")).not.toThrow();
    expect(() => migrateAccuracyToleranceProfilesState(42)).not.toThrow();
    expect(() => migrateAccuracyToleranceProfilesState([1, 2, 3])).not.toThrow();
  });

  it("resolves an unknown/future schemaVersion to an empty state, never guess-migrated", () => {
    const result = migrateAccuracyToleranceProfilesState({
      schemaVersion: 999,
      profiles: [VALID_PROFILE],
      defaultProfileId: "p1",
    });
    expect(result.profiles).toEqual([]);
    expect(result.defaultProfileId).toBeNull();
  });

  it("drops one structurally invalid profile without invalidating the rest of the list", () => {
    const result = migrateAccuracyToleranceProfilesState({
      schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [
        VALID_PROFILE,
        { id: "bad", name: "Broken", onTarget: -1, acceptable: 0.2 },
        { id: "also-bad" /* missing name/onTarget/acceptable */ },
        "not even an object",
        null,
      ],
      defaultProfileId: null,
    });

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].id).toBe("p1");
  });

  it("clears a defaultProfileId that no longer resolves to a real profile", () => {
    const result = migrateAccuracyToleranceProfilesState({
      schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [VALID_PROFILE],
      defaultProfileId: "does-not-exist",
    });
    expect(result.defaultProfileId).toBeNull();
  });

  it("keeps a defaultProfileId that does resolve to a surviving profile", () => {
    const result = migrateAccuracyToleranceProfilesState({
      schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [VALID_PROFILE],
      defaultProfileId: "p1",
    });
    expect(result.defaultProfileId).toBe("p1");
  });

  it("rejects a profile whose thresholds fail the shared validation rule (acceptable <= onTarget)", () => {
    const result = migrateAccuracyToleranceProfilesState({
      schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [{ ...VALID_PROFILE, onTarget: 0.2, acceptable: 0.1 }],
      defaultProfileId: null,
    });
    expect(result.profiles).toEqual([]);
  });
});

describe("migrateAccuracyToleranceProfilesState — persistence round-trip and idempotency", () => {
  it("round-trips a valid state through serialize/parse unchanged", () => {
    const state: AccuracyToleranceProfilesState = {
      schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [VALID_PROFILE],
      defaultProfileId: "p1",
    };

    const serialized = serializeAccuracyToleranceProfilesState(state);
    const migrated = migrateAccuracyToleranceProfilesState(JSON.parse(serialized));
    expect(migrated).toEqual(state);
  });

  it("is idempotent — migrating already-migrated output twice is a no-op", () => {
    const raw = {
      schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [VALID_PROFILE],
      defaultProfileId: "p1",
    };
    const once = migrateAccuracyToleranceProfilesState(raw);
    const twice = migrateAccuracyToleranceProfilesState(once);
    expect(twice).toEqual(once);
  });
});
