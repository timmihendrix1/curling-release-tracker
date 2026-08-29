// @vitest-environment node
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
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

    let totalBytes = 0;
    for (const name of actualNames) {
      const file = path.join(diagramDirectory, name);
      const fileStat = await stat(file);
      totalBytes += fileStat.size;
      expect(fileStat.size).toBeGreaterThan(0);
      expect(fileStat.size).toBeLessThanOrEqual(2_000_000);
      expect([...await readFile(file).then((bytes) => bytes.subarray(0, 8))])
        .toEqual(PNG_SIGNATURE);
    }

    // Keep the current localStorage-backed offline boundary comfortably below
    // common per-origin quotas even after base64 expansion.
    expect(totalBytes).toBeLessThan(3_000_000);
  });
});
