import type { Handle, Shot, ShotType } from "../types";

export type HandleFilter = "all" | Handle;
export type ShotTypeFilter = "all" | ShotType;

export type ShotFilter = {
  handle: HandleFilter;
  shotType: ShotTypeFilter;
};

export const DEFAULT_SHOT_FILTER: ShotFilter = {
  handle: "all",
  shotType: "all",
};

export function filterShots(shots: Shot[], filter: ShotFilter): Shot[] {
  return shots.filter((shot) => {
    const matchesHandle =
      filter.handle === "all" || shot.handle === filter.handle;

    const matchesShotType =
      filter.shotType === "all" || shot.shotType === filter.shotType;

    return matchesHandle && matchesShotType;
  });
}
