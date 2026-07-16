// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AppHeader from "../AppHeader";

afterEach(cleanup);

describe("AppHeader", () => {
  it("shows the current product title and subtitle", () => {
    render(<AppHeader />);

    expect(
      screen.getByRole("heading", { name: "Curling Performance" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Train, assess and understand your performance.")
    ).toBeInTheDocument();
  });

  it("no longer shows the old product title", () => {
    render(<AppHeader />);

    expect(screen.queryByText("Curling Release Tracker")).not.toBeInTheDocument();
  });

  it("mentions Assess now that it's a real, usable capability (Phase B)", () => {
    render(<AppHeader />);

    expect(screen.getByText(/assess/i)).toBeInTheDocument();
  });
});
