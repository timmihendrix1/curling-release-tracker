import { describe, expect, it } from "vitest";
import {
  addAccuracyToleranceProfile,
  buildAccuracyToleranceProfile,
  deleteAccuracyToleranceProfile,
  duplicateAccuracyToleranceProfile,
  findAccuracyToleranceProfile,
  getDefaultAccuracyToleranceProfile,
  replaceAccuracyToleranceProfile,
  setDefaultAccuracyToleranceProfile,
  validateProfileName,
} from "../profiles";
import { createEmptyAccuracyToleranceProfilesState } from "../persistence";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";

describe("validateProfileName", () => {
  it("rejects an empty/whitespace-only name", () => {
    expect(validateProfileName("   ").ok).toBe(false);
  });

  it("rejects a name over the max length", () => {
    expect(validateProfileName("x".repeat(41)).ok).toBe(false);
  });

  it("accepts and trims a valid name", () => {
    const result = validateProfileName("  Elite  ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("Elite");
  });
});

describe("buildAccuracyToleranceProfile", () => {
  it("reuses the shared tolerance validation — rejects acceptable <= onTarget", () => {
    const result = buildAccuracyToleranceProfile(
      { name: "Elite", onTarget: 0.1, acceptable: 0.1 },
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("rejects non-positive or non-finite values", () => {
    expect(
      buildAccuracyToleranceProfile(
        { name: "Elite", onTarget: 0, acceptable: 0.2 },
        NOW
      ).ok
    ).toBe(false);
    expect(
      buildAccuracyToleranceProfile(
        { name: "Elite", onTarget: NaN, acceptable: 0.2 },
        NOW
      ).ok
    ).toBe(false);
  });

  it("builds a valid profile with generated id and timestamps", () => {
    const result = buildAccuracyToleranceProfile(
      { name: "Elite", onTarget: 0.05, acceptable: 0.1 },
      NOW
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Elite");
    expect(result.value.onTarget).toBe(0.05);
    expect(result.value.acceptable).toBe(0.1);
    expect(result.value.createdAt).toBe(NOW);
    expect(result.value.updatedAt).toBe(NOW);
    expect(typeof result.value.id).toBe("string");
    expect(result.value.id.length).toBeGreaterThan(0);
  });

  it("preserves createdAt but bumps updatedAt when a stable id/createdAt is supplied (edit path)", () => {
    const result = buildAccuracyToleranceProfile(
      { id: "fixed-id", name: "Elite", onTarget: 0.05, acceptable: 0.1, createdAt: NOW },
      LATER
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("fixed-id");
    expect(result.value.createdAt).toBe(NOW);
    expect(result.value.updatedAt).toBe(LATER);
  });
});

describe("profile list operations", () => {
  it("adds, finds, and replaces a profile", () => {
    let state = createEmptyAccuracyToleranceProfilesState();
    const built = buildAccuracyToleranceProfile(
      { name: "Elite", onTarget: 0.05, acceptable: 0.1 },
      NOW
    );
    if (!built.ok) throw new Error("expected valid profile");

    state = addAccuracyToleranceProfile(state, built.value);
    expect(findAccuracyToleranceProfile(state, built.value.id)).toEqual(
      built.value
    );

    const updated = { ...built.value, name: "Elite Renamed" };
    const replaced = replaceAccuracyToleranceProfile(state, updated);
    expect(replaced.ok).toBe(true);
    if (replaced.ok) {
      expect(findAccuracyToleranceProfile(replaced.value, updated.id)?.name).toBe(
        "Elite Renamed"
      );
    }
  });

  it("fails to replace a profile that no longer exists", () => {
    const state = createEmptyAccuracyToleranceProfilesState();
    const result = replaceAccuracyToleranceProfile(state, {
      id: "missing",
      name: "Ghost",
      onTarget: 0.1,
      acceptable: 0.2,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("duplicates a profile with a new id and (Copy) name, independent of the original", () => {
    const built = buildAccuracyToleranceProfile(
      { name: "Elite", onTarget: 0.05, acceptable: 0.1 },
      NOW
    );
    if (!built.ok) throw new Error("expected valid profile");

    const copy = duplicateAccuracyToleranceProfile(built.value, LATER);
    expect(copy.id).not.toBe(built.value.id);
    expect(copy.name).toBe("Elite (Copy)");
    expect(copy.onTarget).toBe(built.value.onTarget);
    expect(copy.acceptable).toBe(built.value.acceptable);
    expect(copy.createdAt).toBe(LATER);

    // Independent afterward — mutating the copy's shape must never touch the original.
    const mutatedCopy = { ...copy, name: "Something else entirely" };
    expect(built.value.name).toBe("Elite");
    expect(mutatedCopy.name).not.toBe(built.value.name);
  });

  it("deleting the default profile removes the default reference rather than promoting another one", () => {
    const eliteBuilt = buildAccuracyToleranceProfile(
      { name: "Elite", onTarget: 0.05, acceptable: 0.1 },
      NOW
    );
    const standardBuilt = buildAccuracyToleranceProfile(
      { name: "Standard", onTarget: 0.1, acceptable: 0.2 },
      NOW
    );
    if (!eliteBuilt.ok || !standardBuilt.ok) throw new Error("expected valid profiles");

    let state = createEmptyAccuracyToleranceProfilesState();
    state = addAccuracyToleranceProfile(state, eliteBuilt.value);
    state = addAccuracyToleranceProfile(state, standardBuilt.value);
    const withDefault = setDefaultAccuracyToleranceProfile(state, eliteBuilt.value.id);
    expect(withDefault.ok).toBe(true);
    if (!withDefault.ok) return;

    const afterDelete = deleteAccuracyToleranceProfile(
      withDefault.value,
      eliteBuilt.value.id
    );
    expect(afterDelete.profiles.some((p) => p.id === eliteBuilt.value.id)).toBe(
      false
    );
    // Must not silently promote "Standard" to default.
    expect(afterDelete.defaultProfileId).toBeNull();
    expect(
      afterDelete.profiles.some((p) => p.id === standardBuilt.value.id)
    ).toBe(true);
  });

  it("deleting a non-default profile leaves the default reference untouched", () => {
    const eliteBuilt = buildAccuracyToleranceProfile(
      { name: "Elite", onTarget: 0.05, acceptable: 0.1 },
      NOW
    );
    const standardBuilt = buildAccuracyToleranceProfile(
      { name: "Standard", onTarget: 0.1, acceptable: 0.2 },
      NOW
    );
    if (!eliteBuilt.ok || !standardBuilt.ok) throw new Error("expected valid profiles");

    let state = createEmptyAccuracyToleranceProfilesState();
    state = addAccuracyToleranceProfile(state, eliteBuilt.value);
    state = addAccuracyToleranceProfile(state, standardBuilt.value);
    const withDefault = setDefaultAccuracyToleranceProfile(state, eliteBuilt.value.id);
    if (!withDefault.ok) throw new Error("expected ok");

    const afterDelete = deleteAccuracyToleranceProfile(
      withDefault.value,
      standardBuilt.value.id
    );
    expect(afterDelete.defaultProfileId).toBe(eliteBuilt.value.id);
  });

  it("setDefaultAccuracyToleranceProfile rejects a profile id that doesn't exist", () => {
    const state = createEmptyAccuracyToleranceProfilesState();
    const result = setDefaultAccuracyToleranceProfile(state, "missing");
    expect(result.ok).toBe(false);
  });

  it("setDefaultAccuracyToleranceProfile(null) clears the default", () => {
    const built = buildAccuracyToleranceProfile(
      { name: "Elite", onTarget: 0.05, acceptable: 0.1 },
      NOW
    );
    if (!built.ok) throw new Error("expected valid profile");
    let state = createEmptyAccuracyToleranceProfilesState();
    state = addAccuracyToleranceProfile(state, built.value);
    const withDefault = setDefaultAccuracyToleranceProfile(state, built.value.id);
    if (!withDefault.ok) throw new Error("expected ok");

    const cleared = setDefaultAccuracyToleranceProfile(withDefault.value, null);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.value.defaultProfileId).toBeNull();
  });

  it("getDefaultAccuracyToleranceProfile resolves null when no default is set or the reference is dangling", () => {
    const state = createEmptyAccuracyToleranceProfilesState();
    expect(getDefaultAccuracyToleranceProfile(state)).toBeNull();

    const dangling = { ...state, defaultProfileId: "does-not-exist" };
    expect(getDefaultAccuracyToleranceProfile(dangling)).toBeNull();
  });
});
