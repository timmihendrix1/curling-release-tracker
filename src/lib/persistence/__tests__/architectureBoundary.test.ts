// Architecture-enforcement test — see docs/PERSISTENCE_BOUNDARY_DESIGN.md §9 and
// ADR-0013. localStorageAdapter.ts is the only production file permitted to touch the
// `localStorage` global; every other domain must go through a repository, which itself
// goes through the shared StorageAdapter. This is a plain filesystem/text scan (not an
// ESLint rule) because the accepted design deferred a custom lint rule as unnecessary
// for Phase 1's scope — see design doc §9.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(process.cwd(), "src");
const ALLOWED_FILE = join(SRC_ROOT, "lib", "persistence", "localStorageAdapter.ts");

function isSourceFile(name: string): boolean {
  return (name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".d.ts");
}

function isTestPath(path: string): boolean {
  return path.includes("__tests__") || /\.test\.tsx?$/.test(path);
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (isSourceFile(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Strips comments so a documentation mention (e.g. "matching localStorage.getItem's
 * own contract") doesn't register as a code reference. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("persistence architecture boundary", () => {
  const productionFiles = collectSourceFiles(SRC_ROOT).filter(
    (path) => !isTestPath(path) && path !== ALLOWED_FILE
  );

  it("found more than one production file to check (sanity check)", () => {
    expect(productionFiles.length).toBeGreaterThan(50);
  });

  it("never references `localStorage` outside localStorageAdapter.ts", () => {
    const offenders = productionFiles.filter((path) => {
      const code = stripComments(readFileSync(path, "utf8"));
      return /\blocalStorage\b/.test(code);
    });
    expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([]);
  });

  it("still allows localStorageAdapter.ts to reference localStorage (the exclusion is targeted, not vacuous)", () => {
    const code = stripComments(readFileSync(ALLOWED_FILE, "utf8"));
    expect(/\blocalStorage\b/.test(code)).toBe(true);
  });
});
