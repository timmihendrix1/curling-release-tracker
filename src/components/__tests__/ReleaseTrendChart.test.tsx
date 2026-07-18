// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ReleaseTrendChart from "../ReleaseTrendChart";
import type { Shot } from "../../types";

afterEach(cleanup);

function makeShot(overrides: Partial<Shot>): Shot {
  return {
    id: overrides.id ?? "shot-1",
    shotNumber: 1,
    releaseTime: 3.8,
    targetTime: 3.75,
    handle: "in",
    shotType: "draw",
    blockId: "block-1",
    ...overrides,
  } as Shot;
}

describe("ReleaseTrendChart", () => {
  it("shows a compact empty state instead of a blank chart frame with fewer than two shots", () => {
    render(<ReleaseTrendChart shots={[makeShot({ id: "s1" })]} />);

    expect(
      screen.getByText("Add at least two shots to see the release trend.")
    ).toBeInTheDocument();
  });

  it("shows a compact empty state with zero shots", () => {
    render(<ReleaseTrendChart shots={[]} />);

    expect(
      screen.getByText("Add at least two shots to see the release trend.")
    ).toBeInTheDocument();
  });

  it("renders the chart once at least two shots exist", () => {
    render(
      <ReleaseTrendChart
        shots={[
          makeShot({ id: "s1", shotNumber: 1 }),
          makeShot({ id: "s2", shotNumber: 2, releaseTime: 3.78 }),
        ]}
      />
    );

    expect(
      screen.queryByText("Add at least two shots to see the release trend.")
    ).not.toBeInTheDocument();
  });
});
