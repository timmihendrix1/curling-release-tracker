// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import QuantityToleranceEditor from "../QuantityToleranceEditor";
import { defaultToleranceDraft } from "../../lib/measurement/toleranceDraft";
import type { AccuracyToleranceProfile } from "../../lib/accuracyToleranceProfiles/persistence";

afterEach(cleanup);
const preset: AccuracyToleranceProfile = {
  id: "elite", name: "Elite", quantity: "time",
  tolerance: { onTarget: { lower: 0.05, upper: 0.05 }, acceptable: { lower: 0.1, upper: 0.1 } },
  createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:00Z",
};
function Harness({ profiles = [preset] }: { profiles?: AccuracyToleranceProfile[] }) {
  const [draft, setDraft] = useState(() => defaultToleranceDraft("time"));
  return <QuantityToleranceEditor draft={draft} onChange={setDraft} profiles={profiles} idPrefix="test" />;
}
it("retains the chosen name even when its values equal a built-in preset", () => {
  render(<Harness />);
  const select = screen.getByLabelText("Start from a saved value");
  fireEvent.change(select, { target: { value: preset.id } });
  expect(select).toHaveValue("elite");
  expect(screen.getByLabelText("On Target (±s)")).toHaveValue("0.05");
  fireEvent.change(screen.getByLabelText("On Target (±s)"), { target: { value: "0.06" } });
  expect(select).toHaveValue("");
  expect((screen.getByRole("option", { name: "Custom values" }) as HTMLOptionElement).selected).toBe(true);
});
it("never rewrites copied values when the selected library preset changes or disappears", () => {
  const { rerender } = render(<Harness />);
  fireEvent.change(screen.getByLabelText("Start from a saved value"), { target: { value: preset.id } });
  rerender(<Harness profiles={[{ ...preset, tolerance: { onTarget: { lower: 0.07, upper: 0.08 }, acceptable: { lower: 0.12, upper: 0.14 } } }]} />);
  expect(screen.getByLabelText("On Target (±s)")).toHaveValue("0.05");
  expect(screen.getByLabelText("Start from a saved value")).not.toHaveValue("elite");
  rerender(<Harness profiles={[]} />);
  expect(screen.getByLabelText("Acceptable (±s)")).toHaveValue("0.10");
});
it("keeps the explicit selection when two saved presets have the same numbers", () => {
  render(<Harness profiles={[preset, { ...preset, id: "match", name: "Match" }]} />);
  fireEvent.change(screen.getByLabelText("Start from a saved value"), { target: { value: "match" } });
  expect(screen.getByLabelText("Start from a saved value")).toHaveValue("match");
});
