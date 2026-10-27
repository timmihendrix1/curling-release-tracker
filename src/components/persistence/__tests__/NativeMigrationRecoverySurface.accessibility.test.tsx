// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NativeMigrationRecoverySurface from "../NativeMigrationRecoverySurface";
import { MIGRATION_COPY } from "../migrationRecoveryCopy";

afterEach(cleanup);

describe("recovery disclosure touch-target contract", () => {
  it.each(["G2", "G3", "G4"] as const)("sizes the actual native summaries and retains disclosure semantics in %s", (group) => {
    const buildReport = vi.fn(() => "synthetic report");
    const { container } = render(
      <NativeMigrationRecoverySurface
        presentation={{ kind: "blocking", group, explanation: "internal_check", codes: ["X1 code"], recheck: false, phase: null, steps: [] }}
        buildDiagnosticReport={buildReport}
      />
    );
    const summaries = Array.from(container.querySelectorAll("summary"));
    expect(summaries).toHaveLength(2);
    expect(summaries.map((s) => s.textContent)).toEqual([MIGRATION_COPY.helpSummary, MIGRATION_COPY.detailsSummary]);
    for (const summary of summaries) {
      // JSDOM cannot measure CSS layout; a real-browser probe verifies >=44px.
      expect(summary).toHaveClass("min-h-11", "py-3", "focus-visible:ring-2");
      expect(summary.parentElement?.tagName).toBe("DETAILS");
      expect(summary).not.toHaveAttribute("role");
      expect(summary).not.toHaveAttribute("tabindex", "-1");
    }
    expect(screen.queryByRole("button", { name: MIGRATION_COPY.recheck })).not.toBeInTheDocument();
    expect(buildReport).not.toHaveBeenCalled();
  });
});
