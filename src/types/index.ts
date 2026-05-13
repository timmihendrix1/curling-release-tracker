export type Handle = "in" | "out";

export type ShotType = "draw" | "takeout" | "guard" | "other";

export type Shot = {
  id: string;
  sessionId: string;
  shotNumber: number;
  releaseTime: number;
  handle: Handle;
  shotType: ShotType;
  comment?: string;
  createdAt: string;
};

export type Session = {
  id: string;
  title: string;
  date: string;
  targetTime: number;
  notes?: string;
  shots: Shot[];
};