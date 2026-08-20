// Architecture-enforcement test — see docs/PERSISTENCE_BOUNDARY_DESIGN.md §9 and
// ADR-0013/ADR-0015. localStorageAdapter.ts is the only production file permitted to
// touch the `localStorage` global, and indexedDbAdapter.ts is the only production file
// permitted to touch the `indexedDB` global; every other domain must go through a
// repository, which itself goes through the shared StorageAdapter. This is a plain
// filesystem/text scan (not an ESLint rule) because the accepted design deferred a
// custom lint rule as unnecessary for Phase 1's scope — see design doc §9.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(process.cwd(), "src");
const ALLOWED_FILE = join(SRC_ROOT, "lib", "persistence", "localStorageAdapter.ts");
const ALLOWED_INDEXED_DB_FILE = join(SRC_ROOT, "lib", "persistence", "indexedDbAdapter.ts");

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

describe("persistence architecture boundary — indexedDB", () => {
  const productionFiles = collectSourceFiles(SRC_ROOT).filter(
    (path) => !isTestPath(path) && path !== ALLOWED_INDEXED_DB_FILE
  );

  it("never references `indexedDB` outside indexedDbAdapter.ts", () => {
    const offenders = productionFiles.filter((path) => {
      const code = stripComments(readFileSync(path, "utf8"));
      return /\bindexedDB\b/.test(code);
    });
    expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([]);
  });

  it("still allows indexedDbAdapter.ts to reference indexedDB (the exclusion is targeted, not vacuous)", () => {
    const code = stripComments(readFileSync(ALLOWED_INDEXED_DB_FILE, "utf8"));
    expect(/\bindexedDB\b/.test(code)).toBe(true);
  });
});

describe("persistence architecture boundary — migration module is not imported by production code", () => {
  // See docs/adr/0016-resumable-localstorage-to-indexeddb-copy-migration.md: the
  // migration engine (src/lib/persistence/localStorageToIndexedDbMigration.ts) exists
  // and is tested, but nothing in the app invokes it yet — no repository singleton, no
  // TrackerApp, no other component. Unlike the localStorage/indexedDB checks above,
  // there is no single "approved importer" file here at all; the only expected
  // reference anywhere in `src/` is the migration module's own filename.
  const MIGRATION_MODULE_NAME = "localStorageToIndexedDbMigration";
  const QUOTED_MODULE_PATH = `["'][^"']*${MIGRATION_MODULE_NAME}["']`;
  // Four independent forms, matched by alternation rather than one form's regex being
  // stretched to (incompletely) cover the others:
  //   1. `\bfrom\s*"..."`      — named/default static imports AND re-exports, since
  //                              both `import ... from "..."` and `export ... from
  //                              "..."` share the same `from "..."` tail.
  //   2. `\bimport\s*"..."`    — a bare side-effect import, which has no `from` at all
  //                              (`import "..."`, directly followed by the path).
  //   3. `\bimport\s*\(\s*"..."` — dynamic `import(...)`.
  //   4. `\brequire\s*\(\s*"..."` — `require(...)`, tolerating whitespace before `(`
  //                                  (`require ("...")`), not just `require("...")`.
  const IMPORT_PATTERN = new RegExp(
    [
      `\\bfrom\\s*${QUOTED_MODULE_PATH}`,
      `\\bimport\\s*${QUOTED_MODULE_PATH}`,
      `\\bimport\\s*\\(\\s*${QUOTED_MODULE_PATH}`,
      `\\brequire\\s*\\(\\s*${QUOTED_MODULE_PATH}`,
    ].join("|")
  );

  function importsMigrationModule(source: string): boolean {
    return IMPORT_PATTERN.test(stripComments(source));
  }

  it("the detector itself matches every supported import form and ignores unrelated/comment-only text (non-vacuous)", () => {
    const positiveCases: Array<[string, string]> = [
      [
        "named static import",
        'import { runLocalStorageToIndexedDbMigration } from "../persistence/localStorageToIndexedDbMigration";',
      ],
      [
        "default static import",
        'import migration from "./localStorageToIndexedDbMigration";',
      ],
      [
        "side-effect import (no `from`)",
        'import "../persistence/localStorageToIndexedDbMigration";',
      ],
      [
        "dynamic import()",
        'const mod = await import("../persistence/localStorageToIndexedDbMigration");',
      ],
      [
        "require() with no space before the parenthesis",
        'const mod = require("../persistence/localStorageToIndexedDbMigration");',
      ],
      [
        "require() with whitespace before the parenthesis",
        'const mod = require ("../persistence/localStorageToIndexedDbMigration");',
      ],
      [
        "re-export using from",
        'export { runLocalStorageToIndexedDbMigration } from "../persistence/localStorageToIndexedDbMigration";',
      ],
      [
        "re-export-all using from",
        'export * from "../persistence/localStorageToIndexedDbMigration";',
      ],
    ];
    for (const [label, source] of positiveCases) {
      expect(importsMigrationModule(source), `expected to detect: ${label}`).toBe(true);
    }

    const negativeCases: Array<[string, string]> = [
      [
        "comment-only mention",
        '// This does not run localStorageToIndexedDbMigration — a comment mention only.',
      ],
      [
        "block-comment mention",
        '/* localStorageToIndexedDbMigration is mentioned here only in prose. */',
      ],
      ["unrelated static import", 'import { foo } from "./unrelated";'],
      ["unrelated side-effect import", 'import "./unrelated";'],
      ["unrelated dynamic import", 'await import("./unrelated");'],
      ["unrelated require", 'require("./unrelated");'],
    ];
    for (const [label, source] of negativeCases) {
      expect(importsMigrationModule(source), `expected NOT to detect: ${label}`).toBe(false);
    }
  });

  it("no production file imports the migration module", () => {
    const productionFiles = collectSourceFiles(SRC_ROOT).filter((path) => !isTestPath(path));
    const offenders = productionFiles.filter((path) =>
      importsMigrationModule(readFileSync(path, "utf8"))
    );
    // The migration module never imports itself, and nothing else may import it yet.
    expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([]);
  });
});

describe("persistence architecture boundary — supabase client", () => {
  // See src/lib/supabase/authService.ts's doc comment and
  // docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md: UI, domain,
  // repository and general persistence modules must never import
  // `@supabase/supabase-js` directly. Exactly two production files are
  // permitted to — the lazy client factory and the auth-service
  // implementation built on it — everything else must depend only on the
  // `AuthService` interface (authService.ts), which has no SDK import at all.
  const ALLOWED_SUPABASE_FILES = [
    join(SRC_ROOT, "lib", "supabase", "supabaseClient.ts"),
    join(SRC_ROOT, "lib", "supabase", "supabaseAuthService.ts"),
  ];
  const MODULE_NAME = "@supabase/supabase-js";
  // Matches the bare package OR any subpath import beginning with
  // "@supabase/supabase-js/" (e.g. a deep import of an internal SDK file) —
  // but NOT an unrelated package that merely shares the prefix textually
  // (e.g. "@supabase/supabase-js-extra", which has neither a "/" nor the
  // closing quote immediately after MODULE_NAME).
  const QUOTED_MODULE_PATH = `["']${MODULE_NAME}(?:/[^"']*)?["']`;
  // Same four-form alternation as the migration-module check above (static
  // import/re-export via `from`, bare side-effect import, dynamic import(),
  // require()) — a bare package name has no relative-path variability to
  // worry about, unlike the migration module's `../persistence/...` forms.
  const IMPORT_PATTERN = new RegExp(
    [
      `\\bfrom\\s*${QUOTED_MODULE_PATH}`,
      `\\bimport\\s*${QUOTED_MODULE_PATH}`,
      `\\bimport\\s*\\(\\s*${QUOTED_MODULE_PATH}`,
      `\\brequire\\s*\\(\\s*${QUOTED_MODULE_PATH}`,
    ].join("|")
  );

  function importsSupabaseSdk(source: string): boolean {
    return IMPORT_PATTERN.test(stripComments(source));
  }

  it("the detector itself matches every supported import form and ignores unrelated/comment-only text (non-vacuous)", () => {
    const positiveCases: Array<[string, string]> = [
      ["named static import", 'import { createClient } from "@supabase/supabase-js";'],
      ["type-only static import", 'import type { Session } from "@supabase/supabase-js";'],
      ["side-effect import (no `from`)", 'import "@supabase/supabase-js";'],
      ["dynamic import()", 'const mod = await import("@supabase/supabase-js");'],
      ["require()", 'const mod = require("@supabase/supabase-js");'],
      [
        "re-export using from",
        'export { createClient } from "@supabase/supabase-js";',
      ],
      ["re-export-all using from", 'export * from "@supabase/supabase-js";'],
      [
        "package-subpath import",
        'import { GoTrueClient } from "@supabase/supabase-js/dist/module/GoTrueClient";',
      ],
      [
        "package-subpath dynamic import()",
        'const mod = await import("@supabase/supabase-js/dist/module/index");',
      ],
    ];
    for (const [label, source] of positiveCases) {
      expect(importsSupabaseSdk(source), `expected to detect: ${label}`).toBe(true);
    }

    const negativeCases: Array<[string, string]> = [
      [
        "comment-only mention",
        "// This file intentionally does not import @supabase/supabase-js.",
      ],
      [
        "block-comment mention",
        "/* @supabase/supabase-js is mentioned here only in prose. */",
      ],
      ["unrelated static import", 'import { foo } from "./unrelated";'],
      [
        "unrelated package sharing a prefix",
        'import { foo } from "@supabase/supabase-js-extra";',
      ],
      [
        "subpath of an unrelated package sharing a prefix",
        'import { foo } from "@supabase/supabase-js-extra/dist/index";',
      ],
    ];
    for (const [label, source] of negativeCases) {
      expect(importsSupabaseSdk(source), `expected NOT to detect: ${label}`).toBe(false);
    }
  });

  it("no production file outside the designated Supabase infrastructure boundary imports @supabase/supabase-js", () => {
    const productionFiles = collectSourceFiles(SRC_ROOT).filter(
      (path) => !isTestPath(path) && !ALLOWED_SUPABASE_FILES.includes(path)
    );
    const offenders = productionFiles.filter((path) =>
      importsSupabaseSdk(readFileSync(path, "utf8"))
    );
    expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([]);
  });

  it("both designated files actually do import @supabase/supabase-js (the exclusion is targeted, not vacuous)", () => {
    for (const path of ALLOWED_SUPABASE_FILES) {
      expect(importsSupabaseSdk(readFileSync(path, "utf8"))).toBe(true);
    }
  });

  it("the AuthService contract module itself has no @supabase/supabase-js import", () => {
    const contractFile = join(SRC_ROOT, "lib", "supabase", "authService.ts");
    expect(importsSupabaseSdk(readFileSync(contractFile, "utf8"))).toBe(false);
  });
});
