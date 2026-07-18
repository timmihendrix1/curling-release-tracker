import { describe, expect, it } from "vitest";
import {
  addSmartRandomProfile,
  buildSmartRandomProfile,
  deleteSmartRandomProfile,
  duplicateSmartRandomProfile,
  findSmartRandomProfile,
  getDefaultSmartRandomProfile,
  replaceSmartRandomProfile,
  setDefaultSmartRandomProfile,
  validateProfileName,
} from "../profiles";
import { createEmptySmartRandomProfilesState } from "../persistence";

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
    const result = validateProfileName("  Full Weight Range  ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("Full Weight Range");
  });
});

describe("buildSmartRandomProfile", () => {
  it("rejects Hog-Hog — Smart Random has no validated range for it", () => {
    const result = buildSmartRandomProfile(
      { name: "Elite", measurementMode: "hog-hog", min: 2.5, max: 4.5 },
      NOW
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unsupported_measurement_mode");
  });

  it("reuses the shared range validation — rejects max <= min", () => {
    const result = buildSmartRandomProfile(
      { name: "Full Range", measurementMode: "back-hog", min: 3.5, max: 3.5 },
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("reuses the shared range validation — rejects a range narrower than the minimum width", () => {
    const result = buildSmartRandomProfile(
      { name: "Too Narrow", measurementMode: "back-hog", min: 3.5, max: 3.55 },
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("snaps min/max to the existing 0.05s step grid via validateSmartRandomRange", () => {
    const result = buildSmartRandomProfile(
      { name: "Draw Focus", measurementMode: "back-hog", min: 3.31, max: 4.19 },
      NOW
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.min).toBe(3.3);
    expect(result.value.max).toBe(4.2);
  });

  it("builds a valid profile with generated id and timestamps", () => {
    const result = buildSmartRandomProfile(
      { name: "Full Weight Range", measurementMode: "back-hog", min: 2.5, max: 4.5 },
      NOW
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Full Weight Range");
    expect(result.value.measurementMode).toBe("back-hog");
    expect(result.value.min).toBe(2.5);
    expect(result.value.max).toBe(4.5);
    expect(result.value.createdAt).toBe(NOW);
    expect(result.value.updatedAt).toBe(NOW);
    expect(typeof result.value.id).toBe("string");
    expect(result.value.id.length).toBeGreaterThan(0);
  });

  it("preserves createdAt but bumps updatedAt when a stable id/createdAt is supplied (edit path)", () => {
    const result = buildSmartRandomProfile(
      {
        id: "fixed-id",
        name: "Full Weight Range",
        measurementMode: "back-hog",
        min: 2.5,
        max: 4.5,
        createdAt: NOW,
      },
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
    let state = createEmptySmartRandomProfilesState();
    const built = buildSmartRandomProfile(
      { name: "Full Weight Range", measurementMode: "back-hog", min: 2.5, max: 4.5 },
      NOW
    );
    if (!built.ok) throw new Error("expected valid profile");

    state = addSmartRandomProfile(state, built.value);
    expect(findSmartRandomProfile(state, built.value.id)).toEqual(built.value);

    const updated = { ...built.value, name: "Renamed" };
    const replaced = replaceSmartRandomProfile(state, updated);
    expect(replaced.ok).toBe(true);
    if (replaced.ok) {
      expect(findSmartRandomProfile(replaced.value, updated.id)?.name).toBe(
        "Renamed"
      );
    }
  });

  it("fails to replace a profile that no longer exists", () => {
    const state = createEmptySmartRandomProfilesState();
    const result = replaceSmartRandomProfile(state, {
      id: "missing",
      name: "Ghost",
      measurementMode: "back-hog",
      min: 2.5,
      max: 4.5,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("duplicates a profile with a new id and (Copy) name, independent of the original", () => {
    const built = buildSmartRandomProfile(
      { name: "Full Weight Range", measurementMode: "back-hog", min: 2.5, max: 4.5 },
      NOW
    );
    if (!built.ok) throw new Error("expected valid profile");

    const copy = duplicateSmartRandomProfile(built.value, LATER);
    expect(copy.id).not.toBe(built.value.id);
    expect(copy.name).toBe("Full Weight Range (Copy)");
    expect(copy.min).toBe(built.value.min);
    expect(copy.max).toBe(built.value.max);
    expect(copy.createdAt).toBe(LATER);
  });

  it("deleting the default profile removes the default reference rather than promoting another one", () => {
    const fullBuilt = buildSmartRandomProfile(
      { name: "Full Weight Range", measurementMode: "back-hog", min: 2.5, max: 4.5 },
      NOW
    );
    const drawBuilt = buildSmartRandomProfile(
      { name: "Draw Focus", measurementMode: "back-hog", min: 3.3, max: 4.2 },
      NOW
    );
    if (!fullBuilt.ok || !drawBuilt.ok) throw new Error("expected valid profiles");

    let state = createEmptySmartRandomProfilesState();
    state = addSmartRandomProfile(state, fullBuilt.value);
    state = addSmartRandomProfile(state, drawBuilt.value);
    const withDefault = setDefaultSmartRandomProfile(state, fullBuilt.value.id);
    if (!withDefault.ok) throw new Error("expected ok");

    const afterDelete = deleteSmartRandomProfile(withDefault.value, fullBuilt.value.id);
    expect(afterDelete.profiles.some((p) => p.id === fullBuilt.value.id)).toBe(false);
    expect(afterDelete.defaultProfileId).toBeNull();
    expect(afterDelete.profiles.some((p) => p.id === drawBuilt.value.id)).toBe(true);
  });

  it("deleting a non-default profile leaves the default reference untouched", () => {
    const fullBuilt = buildSmartRandomProfile(
      { name: "Full Weight Range", measurementMode: "back-hog", min: 2.5, max: 4.5 },
      NOW
    );
    const drawBuilt = buildSmartRandomProfile(
      { name: "Draw Focus", measurementMode: "back-hog", min: 3.3, max: 4.2 },
      NOW
    );
    if (!fullBuilt.ok || !drawBuilt.ok) throw new Error("expected valid profiles");

    let state = createEmptySmartRandomProfilesState();
    state = addSmartRandomProfile(state, fullBuilt.value);
    state = addSmartRandomProfile(state, drawBuilt.value);
    const withDefault = setDefaultSmartRandomProfile(state, fullBuilt.value.id);
    if (!withDefault.ok) throw new Error("expected ok");

    const afterDelete = deleteSmartRandomProfile(withDefault.value, drawBuilt.value.id);
    expect(afterDelete.defaultProfileId).toBe(fullBuilt.value.id);
  });

  it("setDefaultSmartRandomProfile rejects a profile id that doesn't exist", () => {
    const state = createEmptySmartRandomProfilesState();
    expect(setDefaultSmartRandomProfile(state, "missing").ok).toBe(false);
  });

  it("setDefaultSmartRandomProfile(null) clears the default", () => {
    const built = buildSmartRandomProfile(
      { name: "Full Weight Range", measurementMode: "back-hog", min: 2.5, max: 4.5 },
      NOW
    );
    if (!built.ok) throw new Error("expected valid profile");
    let state = createEmptySmartRandomProfilesState();
    state = addSmartRandomProfile(state, built.value);
    const withDefault = setDefaultSmartRandomProfile(state, built.value.id);
    if (!withDefault.ok) throw new Error("expected ok");

    const cleared = setDefaultSmartRandomProfile(withDefault.value, null);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.value.defaultProfileId).toBeNull();
  });

  it("getDefaultSmartRandomProfile resolves null when no default is set or the reference is dangling", () => {
    const state = createEmptySmartRandomProfilesState();
    expect(getDefaultSmartRandomProfile(state)).toBeNull();

    const dangling = { ...state, defaultProfileId: "does-not-exist" };
    expect(getDefaultSmartRandomProfile(dangling)).toBeNull();
  });
});
