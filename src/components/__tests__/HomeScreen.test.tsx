// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomeScreen from "../HomeScreen";
import type { Session } from "../../types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function emptySession(): Session {
  return {
    id: "s1",
    title: "Training Session",
    date: new Date().toISOString(),
    notes: "",
    blocks: [],
    activeBlockId: "",
    shots: [],
  };
}

describe("HomeScreen", () => {
  it("shows a time-of-day greeting, not as its own feature card", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T15:00:00"));

    render(
      <HomeScreen
        currentSession={emptySession()}
        sessionHistory={[]}
        onStartTraining={() => {}}
        onOpenAnalyze={() => {}}
      />
    );

    const greeting = screen.getByText("Good afternoon");
    expect(greeting).toBeInTheDocument();
    // A plain heading in the page flow, not a card — no shadow/background
    // container of its own (unlike Today's Plan, Training Overview, etc.).
    expect(greeting.className).not.toMatch(/shadow/);
  });

  it("shows Today's Plan with no scheduled session and a Start Training action", () => {
    const onStartTraining = vi.fn();
    render(
      <HomeScreen
        currentSession={emptySession()}
        sessionHistory={[]}
        onStartTraining={onStartTraining}
        onOpenAnalyze={() => {}}
      />
    );

    expect(screen.getByText("No scheduled session.")).toBeInTheDocument();
    expect(screen.getByText("Start whenever you're ready.")).toBeInTheDocument();

    screen.getByRole("button", { name: "Start Training" }).click();
    expect(onStartTraining).toHaveBeenCalledTimes(1);
  });

  it("has no separate Quick Access section", () => {
    render(
      <HomeScreen
        currentSession={emptySession()}
        sessionHistory={[]}
        onStartTraining={() => {}}
        onOpenAnalyze={() => {}}
      />
    );

    expect(screen.queryByText("Quick Access")).not.toBeInTheDocument();
    expect(screen.queryByText("Open Analyze")).not.toBeInTheDocument();
  });

  it("View Analyze in Training Overview calls onOpenAnalyze", () => {
    const onOpenAnalyze = vi.fn();
    render(
      <HomeScreen
        currentSession={emptySession()}
        sessionHistory={[]}
        onStartTraining={() => {}}
        onOpenAnalyze={onOpenAnalyze}
      />
    );

    screen.getByRole("button", { name: "View Analyze" }).click();
    expect(onOpenAnalyze).toHaveBeenCalledTimes(1);
  });

  it("Training Overview shows an honest empty state with no training yet, and is never called Performance Snapshot", () => {
    render(
      <HomeScreen
        currentSession={emptySession()}
        sessionHistory={[]}
        onStartTraining={() => {}}
        onOpenAnalyze={() => {}}
      />
    );

    expect(screen.getByText("Training Overview")).toBeInTheDocument();
    expect(screen.queryByText("Performance Snapshot")).not.toBeInTheDocument();
    expect(screen.getByText("No training completed yet.")).toBeInTheDocument();
    expect(screen.queryByText("Total Sessions")).not.toBeInTheDocument();
  });

  it("Training Overview shows Last Training and Total Sessions once history exists", () => {
    const history: Session[] = [
      { ...emptySession(), id: "h1", date: "2026-06-01T00:00:00.000Z" },
    ];

    render(
      <HomeScreen
        currentSession={emptySession()}
        sessionHistory={history}
        onStartTraining={() => {}}
        onOpenAnalyze={() => {}}
      />
    );

    expect(screen.getByText("Last Training")).toBeInTheDocument();
    expect(screen.getByText("Total Sessions")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("never invents a training plan or a progress trend", () => {
    render(
      <HomeScreen
        currentSession={emptySession()}
        sessionHistory={[]}
        onStartTraining={() => {}}
        onOpenAnalyze={() => {}}
      />
    );

    expect(screen.queryByText(/should train/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/recommend/i)).not.toBeInTheDocument();
  });

  it("shows Teams as available and keeps only Schedule and Coach under Coming next", () => {
    const onManageTeams = vi.fn();
    render(
      <HomeScreen
        currentSession={emptySession()}
        sessionHistory={[]}
        onStartTraining={() => {}}
        onOpenAnalyze={() => {}}
        onManageTeams={onManageTeams}
      />
    );

    expect(screen.getByText("Coming next")).toBeInTheDocument();

    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("Plan and repeat training sessions.")).toBeInTheDocument();
    expect(screen.getByText("Coach")).toBeInTheDocument();
    expect(screen.getByText("Assigned training and feedback.")).toBeInTheDocument();
    expect(screen.getByText("Available now")).toBeInTheDocument();
    expect(screen.getByText("Teams")).toBeInTheDocument();
    expect(screen.getByText(/invite athletes/)).toBeInTheDocument();

    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
    screen.getByRole("button", { name: "Manage" }).click();
    expect(onManageTeams).toHaveBeenCalledTimes(1);
  });

  it("Coming next tiles are not interactive or focusable", () => {
    render(
      <HomeScreen
        currentSession={emptySession()}
        sessionHistory={[]}
        onStartTraining={() => {}}
        onOpenAnalyze={() => {}}
      />
    );

    for (const title of ["Schedule", "Coach", "Team"]) {
      expect(
        screen.queryByRole("button", { name: title })
      ).not.toBeInTheDocument();
    }
  });

  it("shows Devices with Manual Timing as the current, honest state, without a Coming soon label", () => {
    render(
      <HomeScreen
        currentSession={emptySession()}
        sessionHistory={[]}
        onStartTraining={() => {}}
        onOpenAnalyze={() => {}}
      />
    );

    expect(screen.getByText("Devices")).toBeInTheDocument();
    expect(screen.getByText("Manual Timing")).toBeInTheDocument();
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
  });

  it("Devices copy never suggests an external connection already exists", () => {
    render(
      <HomeScreen
        currentSession={emptySession()}
        sessionHistory={[]}
        onStartTraining={() => {}}
        onOpenAnalyze={() => {}}
      />
    );

    expect(
      screen.getByText("External timing systems will be supported here.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("External timing systems will appear here when connected.")
    ).not.toBeInTheDocument();
  });

  it("groups Coming next capabilities in one shared container, not three separately-boxed cards", () => {
    const { container } = render(
      <HomeScreen
        currentSession={emptySession()}
        sessionHistory={[]}
        onStartTraining={() => {}}
        onOpenAnalyze={() => {}}
      />
    );

    // A dashed border marks the "future capability" container — there should
    // be exactly one shared container, not one per capability.
    expect(container.querySelectorAll(".border-dashed")).toHaveLength(1);
  });
});
