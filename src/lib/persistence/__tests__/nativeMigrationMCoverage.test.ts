// The auditable class-M coverage map for Stage M3b4b.
//
// docs/MOBILE_APP_MIGRATION.md lists acceptance cases R1–R77 with evidence
// classes. Every case whose classes include M must be covered by an
// `mcase("Rn", …)` test in a file that drives the REAL M3b4b implementation
// through the class-M harness (`nativeMigrationMTestKit.ts`); no case without
// class M may be claimed as one. The classes are read from the specification,
// never restated as a looser list here. A label proves nothing by itself — each
// case's own assertions are the behaviour — but this keeps the mapping honest.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TEST_DIR = join(process.cwd(), "src", "lib", "persistence", "__tests__");
const DOC = join(process.cwd(), "docs", "MOBILE_APP_MIGRATION.md");

/** The 62 class-M cases at the time M3b4b was specified — a cross-check on the parser. */
const EXPECTED_CLASS_M = [
  "R1", "R3", "R4", "R5", "R6", "R8", "R9", "R10", "R11", "R12", "R13", "R14", "R15", "R16",
  "R17", "R18", "R19", "R20", "R21", "R22", "R23", "R25", "R26", "R27", "R28", "R29", "R30",
  "R34", "R35", "R36", "R37", "R38", "R39", "R40", "R41", "R42", "R43", "R44", "R45", "R46",
  "R47", "R50", "R51", "R52", "R53", "R54", "R56", "R57", "R59", "R61", "R62", "R63", "R64",
  "R67", "R68", "R69", "R70", "R71", "R72", "R73", "R74", "R77",
];

function classMCases(): string[] {
  const cases: string[] = [];
  for (const line of readFileSync(DOC, "utf8").split("\n")) {
    const match = /^\| (R\d+) \|/.exec(line);
    if (!match) continue;
    const classes = line.trim().split("|").filter(Boolean).pop() ?? "";
    if (/\bM\b/.test(classes)) cases.push(match[1]);
  }
  return cases;
}

function mcases(): Map<string, string[]> {
  const covered = new Map<string, string[]>();
  for (const file of readdirSync(TEST_DIR).filter((name) => /^nativeMigration.*\.test\.ts$/.test(name))) {
    const source = readFileSync(join(TEST_DIR, file), "utf8");
    for (const match of source.matchAll(/\bmcase\(\s*"(R\d+)"/g)) {
      covered.set(match[1], [...(covered.get(match[1]) ?? []), file]);
    }
  }
  return covered;
}

describe("M3b4b class-M coverage", () => {
  it("the specification lists exactly the expected 62 class-M cases", () => {
    expect(classMCases()).toEqual(EXPECTED_CLASS_M);
  });

  it("every class-M case is covered by an mcase test", () => {
    const covered = mcases();
    expect(EXPECTED_CLASS_M.filter((id) => !covered.has(id))).toEqual([]);
  });

  it("no case without class M is claimed as one", () => {
    const allowed = new Set(classMCases());
    expect([...mcases().keys()].filter((id) => !allowed.has(id))).toEqual([]);
    // In particular the simulator/device obligations and the documented residual.
    for (const id of ["R2", "R60", "R65", "R66"]) expect(mcases().has(id)).toBe(false);
  });

  it("every file claiming an mcase drives the real implementation through the class-M harness, not the class-L executor", () => {
    for (const files of mcases().values()) {
      for (const file of files) {
        const source = readFileSync(join(TEST_DIR, file), "utf8");
        expect(source, file).toContain('from "./nativeMigrationMTestKit"');
        expect(source, file).not.toMatch(/\bexecutePlan\b/);
      }
    }
  });
});
