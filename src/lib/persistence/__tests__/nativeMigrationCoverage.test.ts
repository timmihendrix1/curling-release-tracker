// The auditable class-L coverage map for M3b4a.
//
// docs/MOBILE_APP_MIGRATION.md lists acceptance cases R1–R77 with evidence classes.
// Every case with class L must be covered by an `rcase("Rn", …)` test in this
// directory; R2, R65 and R66 are simulator/device obligations (classes S/D only)
// and must NOT be claimed by a logical test. This scan keeps the mapping honest as
// tests are added or removed.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TEST_DIR = join(process.cwd(), "src", "lib", "persistence", "__tests__");
const DOC = join(process.cwd(), "docs", "MOBILE_APP_MIGRATION.md");

function coveredCases(): Map<string, string[]> {
  const covered = new Map<string, string[]>();
  for (const file of readdirSync(TEST_DIR).filter((name) => /^nativeMigration.*\.test\.ts$/.test(name))) {
    for (const match of readFileSync(join(TEST_DIR, file), "utf8").matchAll(/\brcase\(\s*"(R\d+)"/g)) {
      covered.set(match[1], [...(covered.get(match[1]) ?? []), file]);
    }
  }
  return covered;
}

/** The class-L cases, read from the specification itself rather than restated here. */
function classLCases(): string[] {
  const doc = readFileSync(DOC, "utf8");
  const cases: string[] = [];
  for (const line of doc.split("\n")) {
    const match = /^\| (R\d+) \|/.exec(line);
    if (!match) continue;
    const classes = line.trim().split("|").filter(Boolean).pop() ?? "";
    if (/\bL\b/.test(classes)) cases.push(match[1]);
  }
  return cases;
}

describe("M3b4a class-L coverage", () => {
  it("the specification lists 77 R-cases, of which exactly 74 have class L", () => {
    const all = readFileSync(DOC, "utf8").split("\n").filter((line) => /^\| R\d+ \|/.test(line));
    expect(all).toHaveLength(77);
    const l = classLCases();
    expect(l).toHaveLength(74);
    expect(l).not.toContain("R2");
    expect(l).not.toContain("R65");
    expect(l).not.toContain("R66");
  });

  it("every class-L case is covered by at least one rcase, and no S/D-only case is claimed", () => {
    const covered = coveredCases();
    const missing = classLCases().filter((id) => !covered.has(id));
    expect(missing).toEqual([]);
    for (const id of ["R2", "R65", "R66"]) expect(covered.has(id), id).toBe(false);
    const unknown = [...covered.keys()].filter((id) => !classLCases().includes(id));
    expect(unknown).toEqual([]);
  });
});
