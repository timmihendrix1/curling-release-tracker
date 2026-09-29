// @vitest-environment node
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import {
  PUBLIC_EXERCISE_ASSET_IDS,
  PUBLIC_EXERCISE_DIAGRAM_PATHS,
} from "../../src/lib/exercises/restrictedAssetCatalog";
import { exerciseDiagramsPlugin } from "../vite.config";

const mobileRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const realPublic = path.join(mobileRoot, "..", "public");

/**
 * The negative case for asset delivery: a registered public Exercise diagram
 * with no file must FAIL THE BUILD, and fail for that specific reason.
 *
 * Shipping an installable app that silently cannot render a diagram is the
 * failure this guards, and it is exactly the kind of thing a passing positive
 * test never notices.
 *
 * The fixture is a temporary directory of SYMLINKS to the real diagrams, with
 * one deliberately omitted. No repository asset is removed, renamed or
 * modified — the plugin's public root is a parameter with a single production
 * value, and this is the only caller that ever passes anything else.
 */

const created: string[] = [];

/**
 * macOS's temp directory is itself a symlink (/var → /private/var). Vite
 * resolves a project root to its real path but not the HTML input it derives,
 * and the two then disagree. Resolving up front keeps the fixtures honest.
 */
async function tempDirectory(prefix: string): Promise<string> {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  created.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A fixture public/ directory linking every registered diagram except `omit`. */
async function fixturePublic(omit?: string): Promise<string> {
  const root = await tempDirectory("m1-asset-fixture-");
  await mkdir(path.join(root, "exercise-diagrams"), { recursive: true });
  for (const assetId of PUBLIC_EXERCISE_ASSET_IDS) {
    if (assetId === omit) continue;
    const registeredPath = PUBLIC_EXERCISE_DIAGRAM_PATHS[assetId];
    await symlink(
      path.join(realPublic, registeredPath),
      path.join(root, registeredPath.replace(/^\/+/, ""))
    );
  }
  return root;
}

/** A minimal Vite project that exercises nothing but the diagram plugin. */
async function fixtureProject(): Promise<{ root: string; outDir: string }> {
  const root = await tempDirectory("m1-asset-project-");
  await writeFile(path.join(root, "entry.js"), "export const marker = 1;\n");
  await writeFile(
    path.join(root, "index.html"),
    '<!doctype html><html><body><script type="module" src="./entry.js"></script></body></html>\n'
  );
  // Outside `root`: an output directory nested inside the project root makes
  // Rollup resolve the emitted index.html as a relative path and refuse it.
  const outDir = await tempDirectory("m1-asset-out-");
  return { root, outDir };
}

async function runBuild(publicRoot: string): Promise<void> {
  const { root, outDir } = await fixtureProject();
  await build({
    root,
    logLevel: "silent",
    plugins: [exerciseDiagramsPlugin(publicRoot)],
    build: { outDir, emptyOutDir: true },
  });
}

describe("Exercise diagram bundling", () => {
  it("fails the build when a registered diagram has no file", async () => {
    const omitted = PUBLIC_EXERCISE_ASSET_IDS[0];
    const incomplete = await fixturePublic(omitted);

    await expect(runBuild(incomplete)).rejects.toThrow(
      /registered public Exercise diagram\(s\) have no file under public\//
    );
  }, 60_000);

  it("names the specific missing asset rather than failing vaguely", async () => {
    const omitted = PUBLIC_EXERCISE_ASSET_IDS[3];
    const incomplete = await fixturePublic(omitted);

    await expect(runBuild(incomplete)).rejects.toThrow(
      new RegExp(`${omitted}\\b`)
    );
  }, 60_000);

  it("reports every missing diagram, not only the first", async () => {
    const root = await tempDirectory("m1-asset-empty-");
    await mkdir(path.join(root, "exercise-diagrams"), { recursive: true });

    await expect(runBuild(root)).rejects.toThrow(
      new RegExp(`${PUBLIC_EXERCISE_ASSET_IDS.length} registered public Exercise diagram`)
    );
  }, 60_000);

  it("succeeds and emits every diagram when all files are present", async () => {
    // The positive control. Without it, the failures above could come from the
    // harness rather than from the missing file.
    const complete = await fixturePublic();
    const { root, outDir } = await fixtureProject();
    await build({
      root,
      logLevel: "silent",
      plugins: [exerciseDiagramsPlugin(complete)],
      build: { outDir, emptyOutDir: true },
    });

    const emitted = await readdir(path.join(outDir, "exercise-diagrams"));
    expect(emitted.sort()).toEqual(
      PUBLIC_EXERCISE_ASSET_IDS
        .map((assetId) => path.basename(PUBLIC_EXERCISE_DIAGRAM_PATHS[assetId]))
        .sort()
    );
  }, 60_000);

  it("leaves the real repository assets untouched", async () => {
    // Nothing above may have removed or renamed a real diagram.
    const onDisk = (await readdir(path.join(realPublic, "exercise-diagrams")))
      .filter((name) => name.endsWith(".png"))
      .sort();
    expect(onDisk).toEqual(
      PUBLIC_EXERCISE_ASSET_IDS
        .map((assetId) => path.basename(PUBLIC_EXERCISE_DIAGRAM_PATHS[assetId]))
        .sort()
    );
  });
});
