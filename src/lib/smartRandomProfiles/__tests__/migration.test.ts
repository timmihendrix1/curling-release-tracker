import { describe, expect, it } from "vitest";
import { migrateSmartRandomProfilesState } from "../migration";
import {
  SMART_RANDOM_PROFILES_SCHEMA_VERSION,
  serializeSmartRandomProfilesState,
  type SmartRandomProfilesState,
} from "../persistence";

const VALID_PROFILE = {
  id: "p1",
  name: "Full Weight Range",
  measurementMode: "back-hog" as const,
  min: 2.5,
  max: 4.5,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("migrateSmartRandomProfilesState — legacy/no-data state", () => {
  it("resolves null to an empty state (fresh install, no Smart Random Profile storage yet)", () => {
    const result = migrateSmartRandomProfilesState(null);
    expect(result).toEqual({
      schemaVersion: SMART_RANDOM_PROFILES_SCHEMA_VERSION,
      profiles: [],
      defaultProfileId: null,
    });
  });

  it("resolves undefined the same way", () => {
    expect(migrateSmartRandomProfilesState(undefined).profiles).toEqual([]);
  });
});

describe("migrateSmartRandomProfilesState — malformed data fails safely", () => {
  it("does not throw on a non-object", () => {
    expect(() => migrateSmartRandomProfilesState("garbage")).not.toThrow();
    expect(() => migrateSmartRandomProfilesState(42)).not.toThrow();
    expect(() => migrateSmartRandomProfilesState([1, 2, 3])).not.toThrow();
  });

  it("resolves an unknown/future schemaVersion to an empty state, never guess-migrated", () => {
    const result = migrateSmartRandomProfilesState({
      schemaVersion: 999,
      profiles: [VALID_PROFILE],
      defaultProfileId: "p1",
    });
    expect(result.profiles).toEqual([]);
    expect(result.defaultProfileId).toBeNull();
  });

  it("drops one structurally invalid profile without invalidating the rest of the list", () => {
    const result = migrateSmartRandomProfilesState({
      schemaVersion: SMART_RANDOM_PROFILES_SCHEMA_VERSION,
      profiles: [
        VALID_PROFILE,
        { id: "bad", name: "Broken", measurementMode: "back-hog", min: 5, max: 4 },
        { id: "also-bad" /* missing fields */ },
        "not even an object",
        null,
      ],
      defaultProfileId: null,
    });

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].id).toBe("p1");
  });

  it("drops a Hog-Hog profile — an unsupported Measurement Mode combination is never coerced valid", () => {
    const result = migrateSmartRandomProfilesState({
      schemaVersion: SMART_RANDOM_PROFILES_SCHEMA_VERSION,
      profiles: [{ ...VALID_PROFILE, id: "hh", measurementMode: "hog-hog" }],
      defaultProfileId: null,
    });
    expect(result.profiles).toEqual([]);
  });

  it("drops a profile with an unknown future Measurement Mode value rather than guessing", () => {
    const result = migrateSmartRandomProfilesState({
      schemaVersion: SMART_RANDOM_PROFILES_SCHEMA_VERSION,
      profiles: [{ ...VALID_PROFILE, id: "future", measurementMode: "laser-hog" }],
      defaultProfileId: null,
    });
    expect(result.profiles).toEqual([]);
  });

  it("clears a defaultProfileId that no longer resolves to a real profile", () => {
    const result = migrateSmartRandomProfilesState({
      schemaVersion: SMART_RANDOM_PROFILES_SCHEMA_VERSION,
      profiles: [VALID_PROFILE],
      defaultProfileId: "does-not-exist",
    });
    expect(result.defaultProfileId).toBeNull();
  });

  it("keeps a defaultProfileId that does resolve to a surviving profile", () => {
    const result = migrateSmartRandomProfilesState({
      schemaVersion: SMART_RANDOM_PROFILES_SCHEMA_VERSION,
      profiles: [VALID_PROFILE],
      defaultProfileId: "p1",
    });
    expect(result.defaultProfileId).toBe("p1");
  });

  it("rejects a profile whose range fails the shared validation rule (too narrow)", () => {
    const result = migrateSmartRandomProfilesState({
      schemaVersion: SMART_RANDOM_PROFILES_SCHEMA_VERSION,
      profiles: [{ ...VALID_PROFILE, min: 3.5, max: 3.55 }],
      defaultProfileId: null,
    });
    expect(result.profiles).toEqual([]);
  });
});

describe("migrateSmartRandomProfilesState — persistence round-trip and idempotency", () => {
  it("round-trips a valid state through serialize/parse unchanged", () => {
    const state: SmartRandomProfilesState = {
      schemaVersion: SMART_RANDOM_PROFILES_SCHEMA_VERSION,
      profiles: [VALID_PROFILE],
      defaultProfileId: "p1",
    };

    const serialized = serializeSmartRandomProfilesState(state);
    const migrated = migrateSmartRandomProfilesState(JSON.parse(serialized));
    expect(migrated).toEqual(state);
  });

  it("is idempotent — migrating already-migrated output twice is a no-op", () => {
    const raw = {
      schemaVersion: SMART_RANDOM_PROFILES_SCHEMA_VERSION,
      profiles: [VALID_PROFILE],
      defaultProfileId: "p1",
    };
    const once = migrateSmartRandomProfilesState(raw);
    const twice = migrateSmartRandomProfilesState(once);
    expect(twice).toEqual(once);
  });
});
