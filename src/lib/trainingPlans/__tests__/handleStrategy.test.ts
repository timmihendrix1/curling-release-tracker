import { describe, expect, it } from "vitest";
import { handleStrategyToCaptureHandleMode, resolveExpectedHandle } from "../handleStrategy";

describe("resolveExpectedHandle", () => {
  it("Free never preselects a handle", () => {
    expect(resolveExpectedHandle({ type: "free" }, 0)).toBeUndefined();
    expect(resolveExpectedHandle({ type: "free" }, 5)).toBeUndefined();
  });

  it("Fixed always resolves to the configured handle", () => {
    expect(resolveExpectedHandle({ type: "fixed", handle: "out" }, 0)).toBe("out");
    expect(resolveExpectedHandle({ type: "fixed", handle: "out" }, 7)).toBe("out");
  });

  it("Alternating starting In produces In, Out, In, Out, ...", () => {
    const strategy = { type: "alternating" as const, startingHandle: "in" as const };
    expect(resolveExpectedHandle(strategy, 0)).toBe("in");
    expect(resolveExpectedHandle(strategy, 1)).toBe("out");
    expect(resolveExpectedHandle(strategy, 2)).toBe("in");
    expect(resolveExpectedHandle(strategy, 3)).toBe("out");
  });

  it("Alternating starting Out produces Out, In, Out, In, ...", () => {
    const strategy = { type: "alternating" as const, startingHandle: "out" as const };
    expect(resolveExpectedHandle(strategy, 0)).toBe("out");
    expect(resolveExpectedHandle(strategy, 1)).toBe("in");
    expect(resolveExpectedHandle(strategy, 2)).toBe("out");
  });
});

describe("handleStrategyToCaptureHandleMode", () => {
  it("maps Free to manual", () => {
    expect(handleStrategyToCaptureHandleMode({ type: "free" })).toEqual({
      handleMode: "manual",
      startHandle: "in",
    });
  });

  it("maps Fixed In/Out to fixed-in/fixed-out", () => {
    expect(handleStrategyToCaptureHandleMode({ type: "fixed", handle: "in" })).toEqual({
      handleMode: "fixed-in",
      startHandle: "in",
    });
    expect(handleStrategyToCaptureHandleMode({ type: "fixed", handle: "out" })).toEqual({
      handleMode: "fixed-out",
      startHandle: "out",
    });
  });

  it("maps Alternating to alternate + startHandle", () => {
    expect(
      handleStrategyToCaptureHandleMode({ type: "alternating", startingHandle: "out" })
    ).toEqual({ handleMode: "alternate", startHandle: "out" });
  });
});
