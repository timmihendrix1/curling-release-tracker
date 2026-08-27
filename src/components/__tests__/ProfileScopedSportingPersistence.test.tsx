// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode, useEffect, useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProfileScopedSportingPersistence,
  useSportingRepositories,
} from "../ProfileScopedSportingPersistence";
import {
  LEGACY_SPORTING_RETIREMENT_MARKER_KEY,
  SPORTING_STORAGE_KEYS,
  profileScopedSportingStorageKey,
} from "../../lib/persistence/profileScopedSportingPersistence";
import { SHOW_INTRODUCTION_KEY } from "../../lib/assessmentPreferencesRepository";

const PROFILE_A = "11111111-1111-4111-8111-111111111111";
const PROFILE_B = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
});

function PreferenceProbe() {
  const { assessmentPreferences } = useSportingRepositories();
  const [value, setValue] = useState("loading");
  useEffect(() => {
    let active = true;
    void assessmentPreferences.getShowIntroduction().then((result) => {
      if (!active) return;
      setValue(result.status === "value" ? String(result.value) : result.status);
    });
    return () => {
      active = false;
    };
  }, [assessmentPreferences]);
  return <output data-testid="preference">{value}</output>;
}

describe("ProfileScopedSportingPersistence", () => {
  it("retires only legacy sporting keys before mounting children", async () => {
    for (const key of SPORTING_STORAGE_KEYS) localStorage.setItem(key, "disposable");
    localStorage.setItem("curling.identity.trustedDevice.v1", "keep");
    localStorage.setItem("unrelated", "keep");

    render(
      <ProfileScopedSportingPersistence profileId={PROFILE_A}>
        <p>Sporting application</p>
      </ProfileScopedSportingPersistence>
    );

    expect(screen.getByText("Preparing your training data")).toBeInTheDocument();
    expect(screen.queryByText("Sporting application")).not.toBeInTheDocument();
    expect(await screen.findByText("Sporting application")).toBeInTheDocument();

    for (const key of SPORTING_STORAGE_KEYS) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem("curling.identity.trustedDevice.v1")).toBe("keep");
    expect(localStorage.getItem("unrelated")).toBe("keep");
    expect(localStorage.getItem(LEGACY_SPORTING_RETIREMENT_MARKER_KEY)).toBe("complete");
  });

  it("runs one retirement operation under React Strict Mode", async () => {
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem");
    render(
      <StrictMode>
        <ProfileScopedSportingPersistence profileId={PROFILE_A}>
          <p>Sporting application</p>
        </ProfileScopedSportingPersistence>
      </StrictMode>
    );
    expect(await screen.findByText("Sporting application")).toBeInTheDocument();
    expect(removeSpy.mock.calls.map(([key]) => key)).toEqual(SPORTING_STORAGE_KEYS);
  });

  it("remounts repositories and application state when the Profile changes", async () => {
    localStorage.setItem(LEGACY_SPORTING_RETIREMENT_MARKER_KEY, "complete");
    localStorage.setItem(
      profileScopedSportingStorageKey(PROFILE_A, SHOW_INTRODUCTION_KEY),
      "false"
    );
    localStorage.setItem(
      profileScopedSportingStorageKey(PROFILE_B, SHOW_INTRODUCTION_KEY),
      "true"
    );

    const view = render(
      <ProfileScopedSportingPersistence profileId={PROFILE_A}>
        <PreferenceProbe />
      </ProfileScopedSportingPersistence>
    );
    expect(await screen.findByText("false")).toBeInTheDocument();

    view.rerender(
      <ProfileScopedSportingPersistence profileId={PROFILE_B}>
        <PreferenceProbe />
      </ProfileScopedSportingPersistence>
    );
    expect(await screen.findByText("true")).toBeInTheDocument();
    expect(screen.queryByText("false")).not.toBeInTheDocument();
  });

  it("fails closed without mounting sporting data and supports a bounded retry", async () => {
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(
      <ProfileScopedSportingPersistence profileId={PROFILE_A}>
        <p>Sporting application</p>
      </ProfileScopedSportingPersistence>
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Training data is unavailable");
    expect(screen.queryByText("Sporting application")).not.toBeInTheDocument();

    removeSpy.mockRestore();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Sporting application")).toBeInTheDocument();
  });

  it("never reads a Profile's repository before retirement has settled", async () => {
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => {
      if (key === LEGACY_SPORTING_RETIREMENT_MARKER_KEY) {
        throw new DOMException("blocked", "SecurityError");
      }
      return null;
    });

    render(
      <ProfileScopedSportingPersistence profileId={PROFILE_A}>
        <PreferenceProbe />
      </ProfileScopedSportingPersistence>
    );
    await screen.findByRole("alert");
    const scopedKey = profileScopedSportingStorageKey(PROFILE_A, SHOW_INTRODUCTION_KEY);
    expect(getSpy.mock.calls.some(([key]) => key === scopedKey)).toBe(false);
  });
});
