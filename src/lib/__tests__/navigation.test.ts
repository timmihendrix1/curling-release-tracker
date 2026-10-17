import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACTIVE_VIEW,
  NAVIGATION_ITEMS,
  getVisibleNavigationItems,
  isActiveView,
  sanitizeActiveView,
} from "../navigation";

describe("navigation config", () => {
  it("defaults to Home", () => {
    expect(DEFAULT_ACTIVE_VIEW).toBe("home");
  });

  it("keeps the Assess view resolvable but out of primary navigation", () => {
    const assess = NAVIGATION_ITEMS.find((item) => item.id === "assess");
    expect(assess).toBeDefined();
    expect(assess?.availability).toBe("hidden");
    expect(getVisibleNavigationItems().some((item) => item.id === "assess")).toBe(
      false
    );
  });

  it("exposes Home, Train, Assess, Analyze, Settings as visible, in that order", () => {
    expect(getVisibleNavigationItems().map((item) => item.id)).toEqual([
      "home",
      "train",
      "analyze",
      "settings",
    ]);
  });
});

describe("isActiveView / sanitizeActiveView", () => {
  it("accepts every current screen id", () => {
    for (const value of ["home", "train", "assess", "analyze", "settings"]) {
      expect(isActiveView(value)).toBe(true);
      expect(sanitizeActiveView(value)).toBe(value);
    }
  });

  it("falls back to Home for an unknown, stale, or corrupted value", () => {
    expect(sanitizeActiveView("current")).toBe("home"); // pre-nav-redesign value
    expect(sanitizeActiveView("history")).toBe("home"); // pre-nav-redesign value
    expect(sanitizeActiveView(undefined)).toBe("home");
    expect(sanitizeActiveView(null)).toBe("home");
    expect(sanitizeActiveView(42)).toBe("home");
    expect(sanitizeActiveView({})).toBe("home");
  });
});
