// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import SportingSyncStatusControl from "../identity/SportingSyncStatusControl";

afterEach(cleanup);

describe("SportingSyncStatusControl", () => {
  it("shows the two ordinary sync truths without an issue disclosure", () => {
    const retry = vi.fn();
    const { rerender } = render(
      <SportingSyncStatusControl
        cloudSync={{
          truth: "synced",
          pendingCount: 0,
          teamBlockedCount: 0,
          issueSummary: {
            personalRecordCount: 0,
            teamRecordCount: 0,
            hasGeneralIssue: false,
          },
          retry,
        }}
      />
    );
    expect(screen.getByText("Synced")).toBeInTheDocument();

    rerender(
      <SportingSyncStatusControl
        cloudSync={{
          truth: "saved_on_device",
          pendingCount: 2,
          teamBlockedCount: 0,
          issueSummary: {
            personalRecordCount: 0,
            teamRecordCount: 0,
            hasGeneralIssue: false,
          },
          retry,
        }}
      />
    );
    expect(screen.getByText("Saved on this device")).toBeInTheDocument();
    expect(screen.queryByText("Retry Sync")).not.toBeInTheDocument();
  });

  it("explains bounded issue categories and retries without exposing payloads", async () => {
    const retry = vi.fn();
    render(
      <SportingSyncStatusControl
        cloudSync={{
          truth: "sync_issue",
          pendingCount: 1,
          teamBlockedCount: 2,
          issueSummary: {
            personalRecordCount: 1,
            teamRecordCount: 3,
            hasGeneralIssue: true,
          },
          retry,
        }}
      />
    );

    await userEvent.click(screen.getByText("Sync issue · Details"));
    expect(screen.getByText("Your data is safe on this device")).toBeInTheDocument();
    expect(screen.getByText("1 personal history record could not be verified.")).toBeInTheDocument();
    expect(screen.getByText("3 Team records could not be verified.")).toBeInTheDocument();
    expect(screen.getByText("2 Team results need permission before upload.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry Sync" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
