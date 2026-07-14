import type { Session } from "../types";

const blockId = "block-1";

export const mockSession: Session = {
  id: "session-1",
  title: "Release Training 1",
  date: new Date().toISOString(),
  notes: "First test session with mock data.",
  blocks: [
    {
      id: blockId,
      name: "Fixed Weight Block",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
      createdAt: new Date().toISOString(),
    },
  ],
  activeBlockId: blockId,
  shots: [
    {
      id: "shot-1",
      sessionId: "session-1",
      blockId,
      shotNumber: 1,
      releaseTime: 3.63,
      targetTime: 3.75,
      handle: "in",
      shotType: "draw",
      createdAt: new Date().toISOString(),
    },
    {
      id: "shot-2",
      sessionId: "session-1",
      blockId,
      shotNumber: 2,
      releaseTime: 3.89,
      targetTime: 3.75,
      handle: "in",
      shotType: "draw",
      createdAt: new Date().toISOString(),
    },
    {
      id: "shot-3",
      sessionId: "session-1",
      blockId,
      shotNumber: 3,
      releaseTime: 3.74,
      targetTime: 3.75,
      handle: "out",
      shotType: "draw",
      createdAt: new Date().toISOString(),
    },
    {
      id: "shot-4",
      sessionId: "session-1",
      blockId,
      shotNumber: 4,
      releaseTime: 3.7,
      targetTime: 3.75,
      handle: "out",
      shotType: "draw",
      createdAt: new Date().toISOString(),
    },
  ],
};
