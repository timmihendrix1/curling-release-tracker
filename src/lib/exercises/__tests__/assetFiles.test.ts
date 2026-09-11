// @vitest-environment node
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENT_PUBLIC_EXERCISE_ASSET_IDS,
  PUBLIC_EXERCISE_ASSET_IDS,
  PUBLIC_EXERCISE_DIAGRAM_PATHS,
} from "../restrictedAssetCatalog";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

describe("public Exercise diagram files", () => {
  it("ships one valid bounded PNG for every registered immutable asset", async () => {
    const publicDirectory = path.join(process.cwd(), "public");
    const diagramDirectory = path.join(publicDirectory, "exercise-diagrams");
    const expectedNames = PUBLIC_EXERCISE_ASSET_IDS
      .map((assetId) => path.basename(PUBLIC_EXERCISE_DIAGRAM_PATHS[assetId]))
      .sort();
    const actualNames = (await readdir(diagramDirectory))
      .filter((name) => name.endsWith(".png"))
      .sort();

    expect(actualNames).toEqual(expectedNames);

    const currentNames = new Set(
      CURRENT_PUBLIC_EXERCISE_ASSET_IDS.map(
        (assetId) => path.basename(PUBLIC_EXERCISE_DIAGRAM_PATHS[assetId])
      )
    );
    let shippedBytes = 0;
    let cachedBytes = 0;
    for (const name of actualNames) {
      const file = path.join(diagramDirectory, name);
      const fileStat = await stat(file);
      shippedBytes += fileStat.size;
      if (currentNames.has(name)) cachedBytes += fileStat.size;
      expect(fileStat.size).toBeGreaterThan(0);
      expect(fileStat.size).toBeLessThanOrEqual(2_000_000);
      expect([...await readFile(file).then((bytes) => bytes.subarray(0, 8))])
        .toEqual(PNG_SIGNATURE);
    }

    // A fresh install caches the *current* set, so that is the number the
    // localStorage-backed offline boundary has to stay inside, comfortably below common
    // per-origin quotas even after base64 expansion. It must not creep upward as
    // diagrams are corrected.
    expect(cachedBytes).toBeLessThan(1_500_000);

    // A browser upgrading from a previous release keeps its cached copy of the
    // superseded revisions too — they are what its saved plans and results reference —
    // so the shipped total bounds the worst-case local footprint as well. Static
    // hosting affords it; a runaway total would still be worth noticing.
    expect(shippedBytes).toBeLessThan(4_000_000);
  });
});
