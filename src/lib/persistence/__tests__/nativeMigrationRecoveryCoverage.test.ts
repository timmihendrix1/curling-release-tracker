// Stage M3b4c — traceability for the recovery interface's acceptance
// requirements (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §6.8 and §6.10).
//
// A LABEL CHECK ONLY. It fails if a U2 requirement listed in §6.10 has no
// behavioural test labelled `ucase("U2-n", …)`, if a label names a requirement
// the specification does not list, or if a §6.8 outcome family has no labelled
// test. The behaviour itself is established by each labelled test's assertions,
// which drive the real runner, session and view.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOC = join(process.cwd(), "docs", "MOBILE_APP_MIGRATION.md");
const TEST_FILES = [
  join(process.cwd(), "src", "lib", "persistence", "__tests__", "nativeMigrationPresentation.test.ts"),
  join(process.cwd(), "src", "lib", "persistence", "__tests__", "nativeMigrationSession.test.ts"),
  join(process.cwd(), "src", "lib", "persistence", "__tests__", "nativeMigrationSessionCorrections.test.ts"),
  join(process.cwd(), "src", "components", "persistence", "__tests__", "NativeMigrationRecoveryView.test.tsx"),
];

/** The §6.8 outcome families each traced to at least one behavioural test. */
const MATRIX_FAMILIES = ["§6.8:blocked", "§6.8:halt", "§6.8:fault", "§6.8:latch", "§6.8:access"];

function labels(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of TEST_FILES) {
    for (const match of readFileSync(file, "utf8").matchAll(/\bucase\(\s*"([^"]+)"/g)) {
      found.set(match[1], (found.get(match[1]) ?? 0) + 1);
    }
  }
  return found;
}

function specRequirements(): string[] {
  return readFileSync(DOC, "utf8")
    .split("\n")
    .map((line) => /^\| (U2-\d+) \|/.exec(line)?.[1])
    .filter((id): id is string => id !== undefined);
}

describe("M3b4c acceptance traceability (label check)", () => {
  it("the specification lists U2-1 to U2-17, each exactly once", () => {
    const ids = specRequirements();
    expect(ids).toEqual(Array.from({ length: 17 }, (_, i) => `U2-${i + 1}`));
  });

  it("every U2 requirement has at least one labelled behavioural test", () => {
    const found = labels();
    expect(specRequirements().filter((id) => !found.has(id))).toEqual([]);
  });

  it("no label names a requirement the specification does not list", () => {
    const known = new Set([...specRequirements(), ...MATRIX_FAMILIES]);
    expect([...labels().keys()].filter((label) => !known.has(label))).toEqual([]);
  });

  it("every §6.8 outcome family has a labelled test", () => {
    const found = labels();
    expect(MATRIX_FAMILIES.filter((family) => !found.has(family))).toEqual([]);
  });

  it("the R1–R77 table is untouched by these labels", () => {
    for (const file of TEST_FILES) expect(readFileSync(file, "utf8")).not.toMatch(/\b[rm]case\(\s*"R\d+"/);
  });
});
