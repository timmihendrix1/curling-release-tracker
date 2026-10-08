// @vitest-environment jsdom
//
// The completion panel's own feedback contract.
//
// A completion can be refused at EXECUTION time — the stone moved, the quantity is
// already recorded, the training is mid-transition. Such a refusal never becomes a
// pending write, so the panel is the only place it can appear; ignoring the returned
// outcome made it vanish silently while the athlete waited for something to happen.
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MissingMeasurementPanel, {
  type CompletionOutcome,
  type CompletionRequest,
  type CompletionSelection,
  type IncompleteShotEntry,
} from "../MissingMeasurementPanel";
import type { Shot } from "../../types";

afterEach(cleanup);

function shot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: "stone-1",
    sessionId: "session-1",
    blockId: "block-1",
    shotNumber: 1,
    handle: "in",
    releaseTime: 3.7,
    targetTime: 3.75,
    createdAt: "2026-10-07T10:00:00.000Z",
    ...overrides,
  };
}

const entries: IncompleteShotEntry[] = [
  {
    shot: shot(),
    missing: ["speed"],
    blockId: "block-1",
    blockName: "Fixed Weight Block",
    blockPosition: 1,
  },
];

/** Mounts the panel with the parent-owned draft state it expects. */
function Harness({
  onComplete,
}: {
  onComplete: (request: CompletionRequest) => Promise<CompletionOutcome>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<CompletionSelection | null>(null);

  return (
    <MissingMeasurementPanel
      entries={entries}
      drafts={drafts}
      onChangeDraft={(key, value) =>
        setDrafts((current) => ({ ...current, [key]: value }))
      }
      selection={selection}
      onChangeSelection={setSelection}
      onComplete={onComplete}
    />
  );
}

describe("refusals that produce no operation are still shown", () => {
  it("surfaces an execution-time rejection and keeps the typed value", async () => {
    const onComplete = vi.fn(async () => ({
      status: "rejected" as const,
      message: "That stone is no longer part of this training.",
    }));

    render(<Harness onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "That stone is no longer part of this training."
      )
    );
    // The value is kept, so the athlete can act on the message rather than retype.
    expect(screen.getByLabelText(/Speed for stone 1/)).toHaveValue("2.41");
  });

  it("rejects a zero value before it ever reaches the domain", async () => {
    const onComplete = vi.fn(async () => ({ status: "persisted" as const }));

    render(<Harness onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    // Zero parses as a number, so a null-only check treated it as valid right up
    // until submission silently refused it.
    expect(screen.getByRole("alert")).toHaveTextContent(/greater than zero/);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("clears a stale refusal as soon as the athlete types again", async () => {
    const onComplete = vi.fn(async () => ({
      status: "rejected" as const,
      message: "Refused.",
    }));

    render(<Harness onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));
    await waitFor(() => screen.getByRole("alert"));

    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.42" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
