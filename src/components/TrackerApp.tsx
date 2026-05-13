"use client";

import { useEffect, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import ReleaseTrendChart from "./ReleaseTrendChart";
import SessionSettings from "./SessionSettings";
import SessionTrendChart from "./SessionTrendChart";
import ShotEntry from "./ShotEntry";
import TargetTimeSettings from "./TargetTimeSettings";

import type { Handle, Session, Shot, ShotType } from "../types";

import { analyzeShots } from "../lib/analytics";
import {
  exportHistoryToCsv,
  exportSessionToCsv,
} from "../lib/export";
import { formatReleaseTime } from "../lib/timeInput";

const CURRENT_SESSION_STORAGE_KEY =
  "curling-release-tracker-current-session";
const SESSION_HISTORY_STORAGE_KEY =
  "curling-release-tracker-session-history";

type ActiveView = "current" | "history";
type HistoryHandleFilter = "all" | Handle;
type HistoryShotTypeFilter = "all" | ShotType;

type ConfirmAction = {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
};

type EditingShot = {
  id: string;
  releaseTime: string;
  handle: Handle;
  shotType: ShotType;
};

function createNewSession(): Session {
  return {
    id: crypto.randomUUID(),
    title: "Training Session",
    date: new Date().toISOString(),
    targetTime: 3.75,
    notes: "",
    shots: [],
  };
}

function filterSessionShots(
  session: Session,
  handleFilter: HistoryHandleFilter,
  shotTypeFilter: HistoryShotTypeFilter
): Session {
  return {
    ...session,
    shots: session.shots.filter((shot) => {
      const matchesHandle =
        handleFilter === "all" || shot.handle === handleFilter;

      const matchesShotType =
        shotTypeFilter === "all" || shot.shotType === shotTypeFilter;

      return matchesHandle && matchesShotType;
    }),
  };
}

export default function TrackerApp() {
  const [activeView, setActiveView] =
    useState<ActiveView>("current");

  const [currentSession, setCurrentSession] =
    useState<Session | null>(null);

  const [sessionHistory, setSessionHistory] = useState<
    Session[]
  >([]);

  const [historyHandleFilter, setHistoryHandleFilter] =
    useState<HistoryHandleFilter>("all");

  const [historyShotTypeFilter, setHistoryShotTypeFilter] =
    useState<HistoryShotTypeFilter>("all");

  const [confirmAction, setConfirmAction] =
    useState<ConfirmAction | null>(null);

  const [expandedSessions, setExpandedSessions] =
    useState<Record<string, boolean>>({});

  const [editingShot, setEditingShot] =
    useState<EditingShot | null>(null);

  useEffect(() => {
    const savedSession = localStorage.getItem(
      CURRENT_SESSION_STORAGE_KEY
    );

    const savedHistory = localStorage.getItem(
      SESSION_HISTORY_STORAGE_KEY
    );

    if (savedSession) {
      setCurrentSession(JSON.parse(savedSession));
    } else {
      setCurrentSession(createNewSession());
    }

    if (savedHistory) {
      setSessionHistory(JSON.parse(savedHistory));
    }
  }, []);

  useEffect(() => {
    if (!currentSession) return;

    localStorage.setItem(
      CURRENT_SESSION_STORAGE_KEY,
      JSON.stringify(currentSession)
    );
  }, [currentSession]);

  useEffect(() => {
    localStorage.setItem(
      SESSION_HISTORY_STORAGE_KEY,
      JSON.stringify(sessionHistory)
    );
  }, [sessionHistory]);

  if (!currentSession) {
    return null;
  }

  const shots = currentSession.shots;
  const targetTime = currentSession.targetTime;

  const analysis = analyzeShots(shots, targetTime);

  const filteredSessionHistory = sessionHistory.map(
    (session) =>
      filterSessionShots(
        session,
        historyHandleFilter,
        historyShotTypeFilter
      )
  );

  const filteredSessionHistoryWithShots =
    filteredSessionHistory.filter(
      (session) => session.shots.length > 0
    );

  function handleChangeTargetTime(newTargetTime: number) {
    setCurrentSession((session) => {
      if (!session) return session;

      return {
        ...session,
        targetTime: newTargetTime,
      };
    });
  }

  function handleChangeSessionTitle(title: string) {
    setCurrentSession((session) => {
      if (!session) return session;

      return {
        ...session,
        title,
      };
    });
  }

  function handleChangeSessionNotes(notes: string) {
    setCurrentSession((session) => {
      if (!session) return session;

      return {
        ...session,
        notes,
      };
    });
  }

  function handleAddShot(
    releaseTime: number,
    handle: Handle,
    shotType: ShotType
  ) {
    setCurrentSession((session) => {
      if (!session) return session;

      const newShot: Shot = {
        id: crypto.randomUUID(),
        sessionId: session.id,
        shotNumber: session.shots.length + 1,
        releaseTime,
        handle,
        shotType,
        createdAt: new Date().toISOString(),
      };

      return {
        ...session,
        shots: [...session.shots, newShot],
      };
    });
  }

  function handleDeleteShot(shotId: string) {
    setCurrentSession((session) => {
      if (!session) return session;

      const updatedShots = session.shots
        .filter((shot) => shot.id !== shotId)
        .map((shot, index) => ({
          ...shot,
          shotNumber: index + 1,
        }));

      return {
        ...session,
        shots: updatedShots,
      };
    });
  }

  function handleStartEditingShot(shot: Shot) {
    setEditingShot({
      id: shot.id,
      releaseTime: shot.releaseTime.toString(),
      handle: shot.handle,
      shotType: shot.shotType,
    });
  }

  function handleSaveEditedShot() {
    if (!editingShot) return;

    const parsedTime = Number(editingShot.releaseTime);

    if (Number.isNaN(parsedTime)) {
      return;
    }

    setCurrentSession((session) => {
      if (!session) return session;

      return {
        ...session,
        shots: session.shots.map((shot) => {
          if (shot.id !== editingShot.id) {
            return shot;
          }

          return {
            ...shot,
            releaseTime: parsedTime,
            handle: editingShot.handle,
            shotType: editingShot.shotType,
          };
        }),
      };
    });

    setEditingShot(null);
  }

  function handleStartNewSession() {
    setConfirmAction({
      title: "Start New Session",
      message:
        "Current session will be saved to history. Continue?",
      confirmLabel: "Start",
      onConfirm: () => {
        if (
          currentSession &&
          currentSession.shots.length > 0
        ) {
          setSessionHistory((currentHistory) => [
            currentSession,
            ...currentHistory,
          ]);
        }

        setCurrentSession(createNewSession());
        setActiveView("current");
        setConfirmAction(null);
      },
    });
  }

  function handleDeleteHistorySession(sessionId: string) {
    setConfirmAction({
      title: "Delete Session",
      message:
        "Delete this session from history? This cannot be undone.",
      confirmLabel: "Delete",
      onConfirm: () => {
        setSessionHistory((currentHistory) =>
          currentHistory.filter(
            (session) => session.id !== sessionId
          )
        );

        setConfirmAction(null);
      },
    });
  }

  function handleClearSessionHistory() {
    setConfirmAction({
      title: "Clear Session History",
      message:
        "Delete the entire session history? This cannot be undone.",
      confirmLabel: "Clear All",
      onConfirm: () => {
        setSessionHistory([]);
        setConfirmAction(null);
      },
    });
  }

  function toggleSessionExpanded(sessionId: string) {
    setExpandedSessions((current) => ({
      ...current,
      [sessionId]: !current[sessionId],
    }));
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-2 shadow-lg">
        <button
          type="button"
          onClick={() => setActiveView("current")}
          className={`rounded-xl px-4 py-3 font-medium transition ${activeView === "current"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
        >
          Current Session
        </button>

        <button
          type="button"
          onClick={() => setActiveView("history")}
          className={`rounded-xl px-4 py-3 font-medium transition ${activeView === "history"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
        >
          History
        </button>
      </div>

      {activeView === "current" && (
        <>
          <ShotEntry onAddShot={handleAddShot} />

          <ReleaseTrendChart
            shots={shots}
            targetTime={targetTime}
          />

          <div className="rounded-2xl bg-white p-6 shadow-lg">
            <h2 className="text-xl font-semibold text-slate-900">
              Current Shots
            </h2>

            <div className="mt-4 space-y-2">
              {shots.map((shot) => {
                const isEditing =
                  editingShot?.id === shot.id;

                return (
                  <div
                    key={shot.id}
                    className="rounded-xl bg-slate-100 p-4"
                  >
                    {isEditing ? (
                      <div className="space-y-3">
                        <input
                          type="number"
                          step="0.01"
                          value={editingShot.releaseTime}
                          onChange={(event) =>
                            setEditingShot({
                              ...editingShot,
                              releaseTime:
                                event.target.value,
                            })
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
                        />

                        <select
                          value={editingShot.handle}
                          onChange={(event) =>
                            setEditingShot({
                              ...editingShot,
                              handle:
                                event.target
                                  .value as Handle,
                            })
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
                        >
                          <option value="in">In</option>
                          <option value="out">Out</option>
                        </select>

                        <select
                          value={editingShot.shotType}
                          onChange={(event) =>
                            setEditingShot({
                              ...editingShot,
                              shotType:
                                event.target
                                  .value as ShotType,
                            })
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
                        >
                          <option value="draw">
                            Draw
                          </option>

                          <option value="guard">
                            Guard
                          </option>

                          <option value="takeout">
                            Takeout
                          </option>

                          <option value="other">
                            Other
                          </option>
                        </select>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={
                              handleSaveEditedShot
                            }
                            className="flex-1 rounded-xl bg-slate-900 px-4 py-3 font-medium text-white"
                          >
                            Save
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setEditingShot(null)
                            }
                            className="flex-1 rounded-xl bg-slate-200 px-4 py-3 font-medium text-slate-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-slate-600">
                            #{shot.shotNumber} ·{" "}
                            {shot.handle === "in"
                              ? "In"
                              : "Out"}{" "}
                            · {shot.shotType}
                          </p>

                          <p className="font-semibold text-slate-900">
                            {shot.releaseTime.toFixed(
                              2
                            )}
                            s
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              handleStartEditingShot(
                                shot
                              )
                            }
                            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              handleDeleteShot(
                                shot.id
                              )
                            }
                            className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-200"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <TargetTimeSettings
            targetTime={targetTime}
            onChangeTargetTime={
              handleChangeTargetTime
            }
          />

          <SessionSettings
            title={currentSession.title}
            notes={currentSession.notes}
            onChangeTitle={
              handleChangeSessionTitle
            }
            onChangeNotes={
              handleChangeSessionNotes
            }
          />

          <button
            type="button"
            onClick={() =>
              exportSessionToCsv(currentSession)
            }
            className="w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
          >
            Export Current Session CSV
          </button>

          <button
            type="button"
            onClick={handleStartNewSession}
            className="w-full rounded-xl bg-red-100 px-4 py-3 font-medium text-red-700 transition hover:bg-red-200"
          >
            Start New Session
          </button>
        </>
      )}

      {activeView === "history" && (
        <>
          <SessionTrendChart
            sessions={
              filteredSessionHistoryWithShots
            }
          />

          <div className="rounded-2xl bg-white p-6 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  Session History
                </h2>
              </div>

              {sessionHistory.length > 0 && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      exportHistoryToCsv(
                        sessionHistory
                      )
                    }
                    className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                  >
                    Export CSV
                  </button>

                  <button
                    type="button"
                    onClick={
                      handleClearSessionHistory
                    }
                    className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-200"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {filteredSessionHistoryWithShots.map(
                (session) => {
                  const sessionAnalysis =
                    analyzeShots(
                      session.shots,
                      session.targetTime
                    );

                  return (
                    <div
                      key={session.id}
                      className="rounded-xl bg-slate-100 p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <button
                          type="button"
                          onClick={() =>
                            toggleSessionExpanded(
                              session.id
                            )
                          }
                          className="flex-1 text-left"
                        >
                          <p className="font-semibold text-slate-900">
                            {session.title}
                          </p>

                          <p className="mt-1 text-sm text-slate-500">
                            {new Date(
                              session.date
                            ).toLocaleDateString()}
                          </p>

                          <p className="mt-2 text-xs font-medium text-slate-700">
                            {expandedSessions[
                              session.id
                            ]
                              ? "Hide Details"
                              : "Show Details"}
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleDeleteHistorySession(
                              session.id
                            )
                          }
                          className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-200"
                        >
                          Delete
                        </button>
                      </div>

                      {expandedSessions[session.id] && (
                        <div className="mt-4 space-y-4">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <DashboardCard
                              label="Average"
                              value={formatReleaseTime(sessionAnalysis.average)}
                            />

                            <DashboardCard
                              label="Consistency"
                              value={sessionAnalysis.standardDeviation.toFixed(3)}
                            />

                            <DashboardCard
                              label="Avg Abs Dev"
                              value={sessionAnalysis.averageAbsoluteDeviationFromTarget.toFixed(3)}
                            />

                            <DashboardCard
                              label="Bias vs Target"
                              value={`${sessionAnalysis.averageDeviationFromTarget >= 0 ? "+" : ""
                                }${sessionAnalysis.averageDeviationFromTarget.toFixed(3)}s`}
                            />
                          </div>

                          <ReleaseTrendChart
                            shots={session.shots}
                            targetTime={session.targetTime}
                          />

                          <div className="rounded-xl bg-white p-4">
                            <h3 className="font-semibold text-slate-900">
                              Shots
                            </h3>

                            <div className="mt-3 space-y-2">
                              {session.shots.map((shot) => (
                                <div
                                  key={shot.id}
                                  className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2"
                                >
                                  <span className="text-sm text-slate-600">
                                    #{shot.shotNumber} ·{" "}
                                    {shot.handle === "in" ? "In" : "Out"} ·{" "}
                                    {shot.shotType}
                                  </span>

                                  <span className="text-sm font-semibold text-slate-900">
                                    {shot.releaseTime.toFixed(2)}s
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
              )}
            </div>
          </div>
        </>
      )}

      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={
            confirmAction.confirmLabel
          }
          isDanger
          onConfirm={confirmAction.onConfirm}
          onCancel={() =>
            setConfirmAction(null)
          }
        />
      )}
    </div>
  );
}

type MetricRowProps = {
  label: string;
  value: string;
};

function MetricRow({
  label,
  value,
}: MetricRowProps) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-100 px-4 py-3">
      <span className="text-slate-600">
        {label}
      </span>

      <span className="font-semibold text-slate-900">
        {value}
      </span>
    </div>
  );
}

type DashboardCardProps = {
  label: string;
  value: string;
};

function DashboardCard({
  label,
  value,
}: DashboardCardProps) {
  return (
    <div className="rounded-xl bg-slate-100 p-4">
      <p className="text-sm text-slate-500">
        {label}
      </p>

      <p className="mt-1 text-xl font-semibold text-slate-900">
        {value}
      </p>
    </div>
  );
}