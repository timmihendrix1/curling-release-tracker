import type { Session } from "../types";

export const mockSession: Session = {
  id: "session-1",
  title: "Release Training 1",
  date: new Date().toISOString(),
  targetTime: 3.75,
  notes: "First test session with mock data.",
  shots: [
    {
      id: "shot-1",
      sessionId: "session-1",
      shotNumber: 1,
      releaseTime: 3.63,
      handle: "in",
      shotType: "draw",
      createdAt: new Date().toISOString(),
    },
    {
      id: "shot-2",
      sessionId: "session-1",
      shotNumber: 2,
      releaseTime: 3.89,
      handle: "in",
      shotType: "draw",
      createdAt: new Date().toISOString(),
    },
    {
      id: "shot-3",
      sessionId: "session-1",
      shotNumber: 3,
      releaseTime: 3.74,
      handle: "out",
      shotType: "draw",
      createdAt: new Date().toISOString(),
    },
    {
      id: "shot-4",
      sessionId: "session-1",
      shotNumber: 4,
      releaseTime: 3.70,
      handle: "out",
      shotType: "draw",
      createdAt: new Date().toISOString(),
    },
  ],
};