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

describe("persistence architecture boundary — Profile-scoped sporting composition", () => {
  const SPORTING_REPOSITORY_MODULES = [
    "lib/sessionRepository",
    "lib/historyFiltersRepository",
    "lib/assessment/repository",
    "lib/trainingPlans/repository",
    "lib/accuracyToleranceProfiles/repository",
    "lib/smartRandomProfiles/repository",
    "lib/assessmentPreferencesRepository",
  ];

  it("no production component imports an identity-unscoped sporting repository directly", () => {
    const componentRoot = join(SRC_ROOT, "components");
    const offenders = collectSourceFiles(componentRoot)
      .filter((path) => !isTestPath(path))
      .filter((path) => {
        const source = stripComments(readFileSync(path, "utf8"));
        return SPORTING_REPOSITORY_MODULES.some((modulePath) => source.includes(modulePath));
      });
    expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([]);
  });

  it("the application composes identity before Profile scope before TrackerApp", () => {
    const source = stripComments(readFileSync(join(SRC_ROOT, "app", "page.tsx"), "utf8"));
    expect(source).toMatch(
      /<IdentityProvider>[\s\S]*<AuthenticatedSportingPersistence>[\s\S]*<TrackerApp\s*\/>[\s\S]*<\/AuthenticatedSportingPersistence>[\s\S]*<\/IdentityProvider>/
    );
  });

  it("the unscoped compatibility seam is explicitly test-only and production fails without context", () => {
    const source = stripComments(
      readFileSync(join(SRC_ROOT, "components", "ProfileScopedSportingPersistence.tsx"), "utf8")
    );
    expect(source).toContain('process.env.NODE_ENV === "test"');
    expect(source).toContain("createUnscopedSportingRepositoriesForTests");
    expect(source).toContain(
      'throw new Error("Sporting persistence requires an authenticated Profile scope.")'
    );
  });
});

describe("persistence architecture boundary — supabase client", () => {
  // See src/lib/supabase/authService.ts's doc comment and
  // docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md: UI, domain,
  // repository and general persistence modules must never import
  // `@supabase/supabase-js` directly. Exactly THREE production files are
  // permitted to — the lazy browser-client factory, the auth-service
  // implementation built on it, and the server-only per-request client listed
  // below — and everything else must depend only on the `AuthService` interface
  // (authService.ts), which has no SDK import at all.
  const ALLOWED_SUPABASE_FILES = [
    join(SRC_ROOT, "lib", "supabase", "supabaseClient.ts"),
    join(SRC_ROOT, "lib", "supabase", "supabaseAuthService.ts"),
    // Team Foundation (docs/adr/0022): the one additional, server-only file that
    // constructs a fresh, user-token-scoped Supabase client for the small set of
    // Route Handlers that must also send email. supabaseTeamService.ts (the
    // browser-side TeamService) deliberately does NOT import the SDK itself — it
    // only names the client's TYPE via supabaseClient.ts's re-export.
    join(SRC_ROOT, "lib", "supabase", "supabaseServerClient.ts"),
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

  it("every designated file actually does import @supabase/supabase-js (the exclusion is targeted, not vacuous)", () => {
    // Three, not two: an allowance that stopped matching a real importer would
    // silently widen this boundary.
    expect(ALLOWED_SUPABASE_FILES).toHaveLength(3);
    for (const path of ALLOWED_SUPABASE_FILES) {
      expect(importsSupabaseSdk(readFileSync(path, "utf8")), relative(SRC_ROOT, path)).toBe(true);
    }
  });

  it("the AuthService contract module itself has no @supabase/supabase-js import", () => {
    const contractFile = join(SRC_ROOT, "lib", "supabase", "authService.ts");
    expect(importsSupabaseSdk(readFileSync(contractFile, "utf8"))).toBe(false);
  });
});

describe("authorized request boundary — the access token crosses exactly one seam", () => {
  // See src/lib/supabase/authorizedFetch.ts and ADR-0025 Decision 20. The
  // bearer token is read in ONE infrastructure helper and passed ONLY into a
  // validated same-origin request. Confining the import of that helper to one
  // composition seam is what makes "no component, no domain module and no
  // TeamService implementation can reach a token" a checkable property rather
  // than a convention.
  const CONTRACT_FILE = join(SRC_ROOT, "lib", "supabase", "authorizedTeamRequest.ts");
  const HELPER_FILE = join(SRC_ROOT, "lib", "supabase", "authorizedFetch.ts");
  const FACTORY_FILE = join(SRC_ROOT, "lib", "supabase", "teamServiceFactory.ts");
  const TEAM_SERVICE_FILE = join(SRC_ROOT, "lib", "supabase", "supabaseTeamService.ts");

  const MODULE_NAME = "authorizedFetch";
  const QUOTED_MODULE_PATH = `["'][^"']*${MODULE_NAME}["']`;
  // Same four-form alternation as the checks above. `import type ... from` is
  // excluded from the VALUE-import pattern below by a separate type-only test,
  // because naming the helper's types is harmless — only importing its runtime
  // value gives a module the ability to read a token.
  const ANY_IMPORT_PATTERN = new RegExp(
    [
      `\\bfrom\\s*${QUOTED_MODULE_PATH}`,
      `\\bimport\\s*${QUOTED_MODULE_PATH}`,
      `\\bimport\\s*\\(\\s*${QUOTED_MODULE_PATH}`,
      `\\brequire\\s*\\(\\s*${QUOTED_MODULE_PATH}`,
    ].join("|")
  );
  const TYPE_ONLY_IMPORT_PATTERN = new RegExp(
    `\\bimport\\s+type\\b[^;]*\\bfrom\\s*${QUOTED_MODULE_PATH}`
  );

  function importsAuthorizedFetch(source: string): boolean {
    return ANY_IMPORT_PATTERN.test(stripComments(source));
  }

  function valueImportsAuthorizedFetch(source: string): boolean {
    const code = stripComments(source);
    if (!ANY_IMPORT_PATTERN.test(code)) return false;
    // A file whose ONLY reference is a type-only import is not a value importer.
    return !TYPE_ONLY_IMPORT_PATTERN.test(code) || ANY_IMPORT_PATTERN.test(code.replace(TYPE_ONLY_IMPORT_PATTERN, ""));
  }

  it("the detectors match every supported import form and ignore comments and type-only imports (non-vacuous)", () => {
    const valueImports = [
      'import { createAuthorizedTeamRequest } from "./authorizedFetch";',
      'import createAuthorizedTeamRequest from "../supabase/authorizedFetch";',
      'import "./authorizedFetch";',
      'const mod = await import("./authorizedFetch");',
      'const mod = require("./authorizedFetch");',
      'export { createAuthorizedTeamRequest } from "./authorizedFetch";',
      'export * from "./authorizedFetch";',
    ];
    for (const source of valueImports) {
      expect(importsAuthorizedFetch(source), source).toBe(true);
      expect(valueImportsAuthorizedFetch(source), source).toBe(true);
    }

    const typeOnly = 'import type { AuthorizedFetchOverrides } from "./authorizedFetch";';
    expect(importsAuthorizedFetch(typeOnly)).toBe(true);
    expect(valueImportsAuthorizedFetch(typeOnly)).toBe(false);

    for (const source of [
      "// authorizedFetch is mentioned here only in prose.",
      "/* authorizedFetch appears only in a block comment. */",
      'import { foo } from "./unrelated";',
    ]) {
      expect(importsAuthorizedFetch(source), source).toBe(false);
      expect(valueImportsAuthorizedFetch(source), source).toBe(false);
    }
  });

  it("teamServiceFactory.ts is the only production value-importer of authorizedFetch.ts", () => {
    const productionFiles = collectSourceFiles(SRC_ROOT).filter(
      (path) => !isTestPath(path) && path !== HELPER_FILE
    );
    const importers = productionFiles.filter((path) =>
      valueImportsAuthorizedFetch(readFileSync(path, "utf8"))
    );
    expect(importers.map((path) => relative(SRC_ROOT, path))).toEqual([
      relative(SRC_ROOT, FACTORY_FILE),
    ]);
  });

  it("that one production construction supplies the real resolver and no test overrides", () => {
    const code = stripComments(readFileSync(FACTORY_FILE, "utf8"));
    // Exactly one call each, whose arguments are the shared cached client plus
    // the REAL production target resolver — never a substitute transport
    // (`fetchImpl`) and never a hard-coded destination (`origin`).
    //
    // Pinning `resolveApiTarget` by name is the point: since ADR-0047 the
    // destination is resolved rather than assumed, so "passes no overrides"
    // would no longer prove production talks to the resolved target. An
    // arbitrary function here would be exactly the retargeting this boundary
    // exists to prevent.
    const expectedArguments = "client, { resolveTarget: resolveApiTarget }";
    // Whitespace and a trailing comma are formatting, not meaning.
    const normalize = (args: string) =>
      args.replace(/\s+/g, " ").replace(/,\s*\}/g, " }").trim();
    const calls = [...code.matchAll(/createAuthorizedTeamRequest\s*\(([^)]*)\)/g)].map((m) =>
      normalize(m[1])
    );
    expect(calls).toEqual([expectedArguments]);
    const restrictedCalls = [
      ...code.matchAll(/createAuthorizedRestrictedAssetResolver\s*\(([^)]*)\)/g),
    ].map((m) => normalize(m[1]));
    expect(restrictedCalls).toEqual([expectedArguments]);
    // The resolver must be the imported production one, not a local shadow.
    expect(code).toMatch(
      /import\s*\{\s*resolveApiTarget\s*\}\s*from\s*"\.\.\/platform\/apiTarget"/
    );
    expect(code).not.toContain("fetchImpl");
    expect(code).not.toMatch(/\borigin\s*:/);
  });

  it("no component and no module under src/lib/identity or src/lib/team imports authorizedFetch.ts at all", () => {
    const scoped = collectSourceFiles(SRC_ROOT)
      .filter((path) => !isTestPath(path))
      .filter((path) => {
        const rel = relative(SRC_ROOT, path);
        return (
          rel.startsWith("components/") ||
          rel.startsWith(join("lib", "identity") + "/") ||
          rel.startsWith(join("lib", "team") + "/")
        );
      });
    // Non-vacuous: there really are files in this scope to check. (src/lib/identity
    // does not exist yet — it arrives with Stage B0.2c — so the components and
    // src/lib/team files are what make this count non-zero today.)
    expect(scoped.length).toBeGreaterThan(10);
    const offenders = scoped.filter((path) => importsAuthorizedFetch(readFileSync(path, "utf8")));
    expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([]);
  });

  it("the authorizedTeamRequest.ts contract is SDK-free, fetch-free and helper-free, so it is safe to import anywhere", () => {
    const code = stripComments(readFileSync(CONTRACT_FILE, "utf8"));
    expect(/from\s*["']@supabase\/supabase-js["']/.test(code)).toBe(false);
    expect(importsAuthorizedFetch(code)).toBe(false);
    expect(/\bfetch\s*\(/.test(code)).toBe(false);
    expect(/\bgetSession\b/.test(code)).toBe(false);
    // Non-vacuous: it really does declare the closed route and outcome sets.
    expect(code).toContain("TeamApiRoute");
    expect(code).toContain("AuthorizedRequestOutcome");
  });

  it("SupabaseTeamService no longer performs direct browser session/token access or path construction for the Team routes", () => {
    const code = stripComments(readFileSync(TEAM_SERVICE_FILE, "utf8"));
    for (const forbidden of [
      "auth.getSession",
      "access_token",
      "Authorization",
      "Bearer",
      "apiBase",
      "/api/team",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    expect(/\bfetch\s*\(/.test(code)).toBe(false);
    // Non-vacuous: it still routes the five mutations, via the injected helper.
    expect(code).toContain("authorizedRequest");
    expect(code).toContain('kind: "createInvitation"');
  });

  it("authorizedFetch.ts is the only production file that reads an access token", () => {
    const CLASSIFIER_FILE = join(SRC_ROOT, "lib", "supabase", "supabaseCallbackClassifier.ts");
    const productionFiles = collectSourceFiles(SRC_ROOT).filter((path) => !isTestPath(path));
    const mentions = productionFiles.filter((path) =>
      /\baccess_token\b/.test(stripComments(readFileSync(path, "utf8")))
    );
    // Exactly two files may even name it, for opposite reasons: the helper
    // READS it, and the callback classifier lists it as an owned implicit-grant
    // fragment field to STRIP.
    expect(mentions.map((path) => relative(SRC_ROOT, path)).sort()).toEqual(
      [relative(SRC_ROOT, HELPER_FILE), relative(SRC_ROOT, CLASSIFIER_FILE)].sort()
    );

    // The classifier's mention is a quoted field name only — never a property
    // read off a session object.
    const classifier = stripComments(readFileSync(CLASSIFIER_FILE, "utf8"));
    expect(classifier).toContain('"access_token"');
    expect(/\.access_token\b/.test(classifier)).toBe(false);

    // The helper's mention IS a property read (non-vacuous).
    const helper = stripComments(readFileSync(HELPER_FILE, "utf8"));
    expect(/\.access_token\b/.test(helper)).toBe(true);
  });
});

describe("Stage B0.2 identity layer — one mounted authority, structurally unable to remove a barrier", () => {
  // See docs/adr/0025-application-identity-gate-onboarding-completion-and-trusted-device-state.md
  // Decisions 1, 6 and 19. Three separate properties are checked here, each of
  // which would otherwise rest on nobody having made a mistake:
  //
  //   1. exactly one component imports the composition facade and no component
  //      reaches a lower identity module;
  //   2. `identityRuntime` is the only production module that constructs the
  //      coordinator, so there is exactly one composition seam for Stage B0.2e's
  //      provider to mount;
  //   3. **no production file removes the current barrier key**, which is the one
  //      storage operation ADR-0025 Decision 6 forbids outright.
  const IDENTITY_DIR = join(SRC_ROOT, "lib", "identity");
  const RUNTIME_FILE = join(IDENTITY_DIR, "identityRuntime.ts");
  const BARRIER_REPOSITORY_FILE = join(IDENTITY_DIR, "identityBarrierRepository.ts");

  function productionFiles(): string[] {
    return collectSourceFiles(SRC_ROOT).filter((path) => !isTestPath(path));
  }

  function importsFrom(source: string, moduleName: string): boolean {
    const quoted = `["'][^"']*${moduleName}["']`;
    const pattern = new RegExp(
      [
        `\\bfrom\\s*${quoted}`,
        `\\bimport\\s*${quoted}`,
        `\\bimport\\s*\\(\\s*${quoted}`,
        `\\brequire\\s*\\(\\s*${quoted}`,
      ].join("|")
    );
    return pattern.test(stripComments(source));
  }

  it("the identity layer exists and is non-trivial (non-vacuous)", () => {
    const files = collectSourceFiles(IDENTITY_DIR).filter((path) => !isTestPath(path));
    expect(files.length).toBeGreaterThan(15);
    expect(files.map((path) => relative(IDENTITY_DIR, path))).toContain("identityRuntime.ts");
    expect(files.map((path) => relative(IDENTITY_DIR, path))).toContain(
      "identityTransitionCoordinator.ts"
    );
  });

  it("IdentityProvider is the only component importing src/lib/identity, and it imports only the runtime facade", () => {
    const components = productionFiles().filter((path) =>
      relative(SRC_ROOT, path).startsWith("components/")
    );
    // Non-vacuous: there really are components to check.
    expect(components.length).toBeGreaterThan(20);
    const importers = components.filter((path) => {
      const code = stripComments(readFileSync(path, "utf8"));
      return /\bfrom\s*["'][^"']*\/lib\/identity\/[^"']*["']/.test(code);
    });
    expect(importers.map((path) => relative(SRC_ROOT, path))).toEqual([
      join("components", "identity", "IdentityProvider.tsx"),
    ]);
    const provider = stripComments(readFileSync(importers[0], "utf8"));
    expect(provider).toContain("identityRuntime");
    expect(provider.match(/\/lib\/identity\//g)).toHaveLength(1);
  });

  it("no page, route handler or other production module outside src/lib/identity imports it either", () => {
    const outside = productionFiles().filter(
      (path) => !relative(SRC_ROOT, path).startsWith(join("lib", "identity") + "/")
    );
    const offenders = outside.filter((path) =>
      /\bfrom\s*["'][^"']*\/lib\/identity\/[^"']*["']/.test(stripComments(readFileSync(path, "utf8")))
    );
    // The provider mounts the runtime facade. Relative imports internal to
    // src/lib (including the Supabase adapter's contract import) are outside this
    // path-boundary assertion and covered by the component-specific check above.
    expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([
      join("components", "identity", "IdentityProvider.tsx"),
    ]);
  });

  it("identityRuntime is the ONLY production module that constructs the coordinator", () => {
    // The declaring module is excluded: it contains the factory's own `export
    // function` line, which is a declaration rather than a construction.
    const COORDINATOR_FILE = join(IDENTITY_DIR, "identityTransitionCoordinator.ts");
    const constructors = productionFiles()
      .filter((path) => path !== COORDINATOR_FILE)
      .filter((path) =>
        /createIdentityTransitionCoordinator\s*\(/.test(stripComments(readFileSync(path, "utf8")))
      );
    expect(constructors.map((path) => relative(SRC_ROOT, path))).toEqual([
      relative(SRC_ROOT, RUNTIME_FILE),
    ]);
    // Non-vacuous: the declaring file really does declare exactly one factory.
    const declaration = stripComments(readFileSync(COORDINATOR_FILE, "utf8"));
    expect(
      [...declaration.matchAll(/export function createIdentityTransitionCoordinator\s*\(/g)]
    ).toHaveLength(1);
  });

  it("the barrier repository depends on the BASE storage contract, never the removable one", () => {
    const code = stripComments(readFileSync(BARRIER_REPOSITORY_FILE, "utf8"));
    expect(code).toContain("StorageAdapter");
    // Naming the removable type here would be the first step toward a removal path.
    expect(code).not.toContain("RemovableStorageAdapter");
    expect(code).not.toContain("removeIdentityRecord");
    expect(/\.remove\s*\(/.test(code)).toBe(false);
  });

  it("no production file removes the barrier storage key", () => {
    // The key is a single literal, so a removal of it would have to name it. Every
    // production reference is checked, not just the identity layer's.
    const BARRIER_KEY = "curling.identity.accessBarrier.v1";
    const referencing = productionFiles().filter((path) =>
      stripComments(readFileSync(path, "utf8")).includes(BARRIER_KEY)
    );
    // Non-vacuous: exactly one production file declares it.
    expect(referencing.map((path) => relative(SRC_ROOT, path))).toEqual([
      join("lib", "identity", "identityBarrier.ts"),
    ]);

    // And no production file anywhere pairs a removal call with the barrier
    // constant that names it.
    const offenders = productionFiles().filter((path) => {
      const code = stripComments(readFileSync(path, "utf8"));
      return /remove(?:IdentityRecord)?\s*\(\s*[^)]*IDENTITY_BARRIER_STORAGE_KEY/.test(code);
    });
    expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([]);
  });

  it("the removable capability is depended on by exactly the four repositories that delete", () => {
    // docs/PERSISTENCE_BOUNDARY_DESIGN.md §9's inventory, enforced rather than
    // documented: the barrier repository is deliberately absent from this list.
    const identityFiles = collectSourceFiles(IDENTITY_DIR).filter((path) => !isTestPath(path));
    const dependants = identityFiles
      .filter((path) => {
        const code = stripComments(readFileSync(path, "utf8"));
        return /\bRemovableStorageAdapter\b/.test(code);
      })
      .map((path) => relative(IDENTITY_DIR, path))
      .sort();
    expect(dependants).toEqual(
      [
        "identityBarrierResolutionRepository.ts",
        "interactiveAttemptRepository.ts",
        "pendingIntentRepository.ts",
        "trustedDeviceRepository.ts",
        // The shared containment primitive, which is where the single audited
        // `remove` call lives.
        "untrustedValue.ts",
        // Stage M3b3's injection point. It NAMES the removable contract because
        // that is the adapter type the whole set is built over; it deletes
        // nothing itself, and it does not widen any repository's capability —
        // `identityBarrierRepository` still takes the BASE contract and still
        // cannot remove a barrier (ADR-0025 Decision 6), which the test below
        // and `storageComposition.test.ts` both assert.
        "identityRepositorySet.ts",
      ].sort()
    );
  });

  it("the seven sporting repositories still compile against the BASE contract", () => {
    const sporting = [
      join(SRC_ROOT, "lib", "sessionRepository.ts"),
      join(SRC_ROOT, "lib", "historyFiltersRepository.ts"),
      join(SRC_ROOT, "lib", "assessmentPreferencesRepository.ts"),
    ];
    for (const path of sporting) {
      const code = stripComments(readFileSync(path, "utf8"));
      expect(code, relative(SRC_ROOT, path)).not.toContain("RemovableStorageAdapter");
    }
    // Non-vacuous: these files really do depend on the base contract.
    for (const path of sporting) {
      expect(stripComments(readFileSync(path, "utf8"))).toContain("StorageAdapter");
    }
  });

  it("no identity record carries token, session, authorization-code or verifier material", () => {
    // ADR-0025 §G. The flow SELECTOR is deliberately persisted and is not a secret;
    // these five are the values that must never appear in an application-owned
    // record.
    const recordModules = [
      "identityBarrier.ts",
      "interactiveAttempt.ts",
      "identityBarrierResolution.ts",
      "trustedDevice.ts",
      "pendingIntentRepository.ts",
    ];
    for (const name of recordModules) {
      const code = stripComments(readFileSync(join(IDENTITY_DIR, name), "utf8"));
      for (const forbidden of [
        "access_token",
        "refresh_token",
        "code_verifier",
        "provider_token",
        "authorizationCode",
      ]) {
        expect(code, `${name} / ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("makes no false persistence claim anywhere in the identity layer", () => {
    // ADR-0025 §G: "nothing is persisted", "no token is in browser storage" and
    // "`sb_flow_id` is never stored" are all FALSE statements and must not appear.
    const forbiddenPhrases = [
      "nothing is persisted",
      "no token is in browser storage",
      "no tokens are in browser storage",
      "sb_flow_id is never stored",
      "the verifier is never persisted",
      "flowId is never stored",
    ];
    const identityFiles = collectSourceFiles(IDENTITY_DIR);
    expect(identityFiles.length).toBeGreaterThan(20);
    for (const path of identityFiles) {
      const source = readFileSync(path, "utf8").toLowerCase();
      for (const phrase of forbiddenPhrases) {
        expect(source, `${relative(SRC_ROOT, path)} / ${phrase}`).not.toContain(phrase);
      }
    }
  });

  it("supports no Marketing Consent of any kind", () => {
    // ADR-0025 Decision 18: none is requested, stored, inferred or recorded —
    // including as an explicit negative.
    const identityFiles = collectSourceFiles(IDENTITY_DIR).filter((path) => !isTestPath(path));
    for (const path of identityFiles) {
      const source = readFileSync(path, "utf8").toLowerCase();
      for (const phrase of ["marketing_consent", "marketingconsent", "marketing consent"]) {
        // The only permitted mentions are the explicit NEGATIVE statements in
        // module documentation, which this check tolerates by scanning code only.
        const code = stripComments(source);
        expect(code, `${relative(SRC_ROOT, path)} / ${phrase}`).not.toContain(phrase);
      }
    }
  });

  it("performs no legacy-data adoption, migration or disposal", () => {
    // Stage B0.3 owns the one-time disposal of legacy unscoped sporting data, and
    // ADR-0025 §24 states every identity record is new at schemaVersion 1 with no
    // prior format, alias or migration.
    const identityFiles = collectSourceFiles(IDENTITY_DIR).filter((path) => !isTestPath(path));
    for (const path of identityFiles) {
      const code = stripComments(readFileSync(path, "utf8"));
      for (const forbidden of [
        "curling-release-tracker",
        "migrateSession",
        "localStorageToIndexedDbMigration",
        "schemaVersion: 0",
      ]) {
        expect(code, `${relative(SRC_ROOT, path)} / ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("IdentityProvider is the only production importer of the identity runtime", () => {
    const importers = productionFiles()
      .filter((path) => path !== RUNTIME_FILE)
      .filter((path) => importsFrom(readFileSync(path, "utf8"), "identityRuntime"));
    expect(importers.map((path) => relative(SRC_ROOT, path))).toEqual([
      join("components", "identity", "IdentityProvider.tsx"),
    ]);
  });
});

describe("persistence architecture boundary — native storage is composed in ONE place, lazily", () => {
  // Stage M3b3 (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §3, ADR-0049): the
  // native adapter is now composed — but behind an off-by-default build flag,
  // and still NOT cut over (production cutover is Stage M3b5).
  //
  // The earlier rule here was "nothing under src/ may name the native adapter at
  // all". That rule has done its job and is replaced by two narrower ones that
  // preserve exactly the properties that mattered:
  //
  //   1. exactly ONE production module may reach the native adapter, and it must
  //      do so through a DYNAMIC import — which is what keeps SQLite out of
  //      every bundle that does not actually compose a native store, the Web and
  //      Next builds included;
  //   2. the plugin packages stay confined to their one binding file each.
  const NATIVE_ADAPTER_MODULES = ["nativeSqliteAdapter", "capacitorSqliteEngine"];
  const SQLITE_PACKAGE = "@capacitor-community/sqlite";
  const SECURE_STORAGE_PACKAGE = "@aparajita/capacitor-secure-storage";
  const ALLOWED_SQLITE_FILE = join(SRC_ROOT, "lib", "persistence", "capacitorSqliteEngine.ts");
  const ALLOWED_SECURE_STORAGE_FILE = join(
    SRC_ROOT,
    "lib",
    "persistence",
    "capacitorSecureStorageBinding.ts"
  );
  // The adapter's own lazy `import("./capacitorSqliteEngine")`.
  const ADAPTER_FILE = join(SRC_ROOT, "lib", "persistence", "nativeSqliteAdapter.ts");
  // The one composition module.
  const COMPOSITION_FILE = join(SRC_ROOT, "lib", "persistence", "storageComposition.ts");
  const SECURE_STORE_FILE = join(SRC_ROOT, "lib", "persistence", "secureCredentialStore.ts");

  function importsAny(source: string, modules: string[]): boolean {
    const code = stripComments(source);
    return modules.some((moduleName) => {
      const quoted = `["'][^"']*${moduleName}["']`;
      return new RegExp(
        [
          `\\bfrom\\s*${quoted}`,
          `\\bimport\\s*${quoted}`,
          `\\bimport\\s*\\(\\s*${quoted}`,
          `\\brequire\\s*\\(\\s*${quoted}`,
        ].join("|")
      ).test(code);
    });
  }

  /** A STATIC import — the kind that pulls a module into every bundle that
   * reaches this file. `import type` is excluded because it erases. */
  function staticallyImports(source: string, modules: string[]): boolean {
    const code = stripComments(source);
    return modules.some((moduleName) => {
      const quoted = `["'][^"']*${moduleName}["']`;
      return new RegExp(`\\bimport\\s+(?!type\\b)[^;]*?\\bfrom\\s*${quoted}`).test(code);
    });
  }

  it("the detectors are not vacuous", () => {
    expect(
      importsAny('import { createNativeSqliteStore } from "./nativeSqliteAdapter";', NATIVE_ADAPTER_MODULES)
    ).toBe(true);
    expect(importsAny('await import("../persistence/capacitorSqliteEngine");', NATIVE_ADAPTER_MODULES)).toBe(true);
    expect(importsAny("// nativeSqliteAdapter is only mentioned in prose here", NATIVE_ADAPTER_MODULES)).toBe(false);

    expect(
      staticallyImports('import { createNativeSqliteStore } from "./nativeSqliteAdapter";', NATIVE_ADAPTER_MODULES)
    ).toBe(true);
    // A dynamic import and a type-only import are both permitted and must not
    // register as static.
    expect(staticallyImports('const m = await import("./nativeSqliteAdapter");', NATIVE_ADAPTER_MODULES)).toBe(false);
    expect(
      staticallyImports('import type { NativeSqliteEngine } from "./nativeSqliteAdapter";', NATIVE_ADAPTER_MODULES)
    ).toBe(false);
  });

  it("exactly one production module composes the native adapter, and only it", () => {
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((path) => !isTestPath(path))
      // The two halves of the adapter/binding pair reference each other — the
      // adapter lazily imports the binding, the binding imports the adapter's
      // types. That is the module boundary itself, not a composition.
      .filter((path) => path !== ADAPTER_FILE && path !== ALLOWED_SQLITE_FILE)
      .filter((path) => path !== COMPOSITION_FILE)
      .filter((path) => importsAny(readFileSync(path, "utf8"), NATIVE_ADAPTER_MODULES));
    expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([]);
    // Targeted, not vacuous: the composition module really does reach it.
    expect(importsAny(readFileSync(COMPOSITION_FILE, "utf8"), NATIVE_ADAPTER_MODULES)).toBe(true);
  });

  it("no production module STATICALLY imports the native adapter or the secure store's binding", () => {
    // This is what keeps SQLite and the Keychain plugin out of every bundle that
    // does not compose a native store — the Web build, the Next build, and a
    // DEFAULT mobile build. `mobile/__tests__/bundle.test.ts` asserts the same
    // property against the real artifact.
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((path) => !isTestPath(path))
      .filter((path) => path !== ALLOWED_SQLITE_FILE && path !== ALLOWED_SECURE_STORAGE_FILE)
      .filter((path) =>
        staticallyImports(readFileSync(path, "utf8"), [
          "nativeSqliteAdapter",
          "capacitorSqliteEngine",
          "capacitorSecureStorageBinding",
        ])
      );
    expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([]);
  });

  it("only its own binding file names each native storage package", () => {
    for (const [pkg, allowed] of [
      [SQLITE_PACKAGE, ALLOWED_SQLITE_FILE],
      [SECURE_STORAGE_PACKAGE, ALLOWED_SECURE_STORAGE_FILE],
    ] as const) {
      const offenders = collectSourceFiles(SRC_ROOT)
        .filter((path) => !isTestPath(path))
        .filter((path) => path !== allowed)
        .filter((path) => stripComments(readFileSync(path, "utf8")).includes(pkg));
      expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([]);
      // Targeted, not vacuous.
      expect(stripComments(readFileSync(allowed, "utf8"))).toContain(pkg);
    }
  });

  it("the repositories still default to the localStorage adapter", () => {
    // Composition changed WHERE a repository can be pointed; it did not change
    // any repository's default, so an un-composed tree is byte-for-byte what it
    // always was.
    const source = stripComments(
      readFileSync(join(SRC_ROOT, "lib", "sessionRepository.ts"), "utf8")
    );
    expect(source).toContain("localStorageAdapter");
    expect(source).not.toContain("nativeSqlite");
  });

  it("the secure credential store fails closed before it can load a Web implementation", () => {
    // The installed plugin ships a `localStorage`-backed Web implementation
    // (`dist/esm/web.js`). The platform gate is what makes it unreachable, so
    // inside the one function that loads the binding, the gate must come FIRST.
    const source = stripComments(readFileSync(SECURE_STORE_FILE, "utf8"));
    const start = source.indexOf("async function ensureConfigured(");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = source.slice(start, source.indexOf("async function readTask("));

    const gate = body.indexOf('platform !== "ios" && platform !== "android"');
    const load = body.indexOf("loadDefaultBinding()");
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(load).toBeGreaterThan(gate);
    // And the gate throws rather than falling through.
    expect(body.slice(gate, load)).toContain("SecureStoreUnavailableError");
  });
});

describe("Stage M3b3 — no shipped path can declare native storage ready", () => {
  // The barrier against premature cutover. A ready activation verdict is
  // constructible in exactly one place, it is named for what it is, and no
  // production module may call it. Everything else about the barrier is behaviour
  // and is covered by `storageComposition.test.ts`; this is the structural half.
  const READY_FACTORY = "nativeActivationReadyForTests";
  const MOBILE_ROOT = join(process.cwd(), "mobile");
  const PRODUCTION_AUTHORITY_FILE = join(
    MOBILE_ROOT,
    "src",
    "storage",
    "nativeStorageComposition.ts"
  );

  function productionSources(): string[] {
    return [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(MOBILE_ROOT)].filter(
      (path) => !isTestPath(path)
    );
  }

  it("the test-only ready factory is referenced by no production module", () => {
    const offenders = productionSources()
      .filter((path) => path !== PRODUCTION_AUTHORITY_FILE)
      .filter((path) => stripComments(readFileSync(path, "utf8")).includes(READY_FACTORY));
    expect(offenders.map((path) => relative(process.cwd(), path))).toEqual([]);

    // The declaring file mentions the name EXACTLY ONCE — its own declaration —
    // so it contains no call either.
    const declaration = stripComments(readFileSync(PRODUCTION_AUTHORITY_FILE, "utf8"));
    expect([...declaration.matchAll(new RegExp(READY_FACTORY, "g"))]).toHaveLength(1);
    expect(declaration).toMatch(new RegExp(`export function ${READY_FACTORY}\\s*\\(`));
  });

  it("the ONE production authority reports unavailable, with no branch that can report ready", () => {
    const source = stripComments(readFileSync(PRODUCTION_AUTHORITY_FILE, "utf8"));
    const authority = source.slice(
      source.indexOf("PRODUCTION_ACTIVATION_AUTHORITY"),
      source.indexOf(`export function ${READY_FACTORY}`)
    );
    expect(authority).toContain('status: "unavailable"');
    expect(authority).toContain('reason: "migration_not_implemented"');
    expect(authority).not.toContain('status: "ready"');
  });

  it("no production module reads an environment variable, URL parameter or stored preference to reach readiness", () => {
    // The opt-in is build-time only. A runtime switch would make the barrier
    // bypassable on an installed device.
    //
    // Matched as EXPRESSIONS, not substrings: a bare `includes("sessionStorage")`
    // false-positives on the perfectly ordinary identifier `sessionStorageKey`,
    // which names the SDK key establishment reads and is not a switch of any
    // kind. The patterns below match actual reads instead.
    const composition = stripComments(readFileSync(PRODUCTION_AUTHORITY_FILE, "utf8"));
    const runtimeSwitches: Array<[string, RegExp]> = [
      ["process.env access", /\bprocess\s*\.\s*env\b/],
      ["URL search parameters", /\bsearchParams\b|\blocation\s*\.\s*search\b/],
      ["Web Storage reads", /\b(?:window\s*\.\s*)?(?:local|session)Storage\s*\./],
    ];
    for (const [label, pattern] of runtimeSwitches) {
      expect(pattern.test(composition), label).toBe(false);
    }

    // Non-vacuous: each pattern really does catch the form it is for.
    expect(/\bprocess\s*\.\s*env\b/.test('process.env.CURLING_X === "1"')).toBe(true);
    expect(/\bsearchParams\b|\blocation\s*\.\s*search\b/.test("url.searchParams.get('x')")).toBe(true);
    expect(/\b(?:window\s*\.\s*)?(?:local|session)Storage\s*\./.test('localStorage.getItem("x")')).toBe(true);
    // And it does NOT flag the ordinary identifier.
    expect(/\b(?:window\s*\.\s*)?(?:local|session)Storage\s*\./.test("const sessionStorageKey = null;")).toBe(false);
  });
});

/**
 * The diagnostics-only owned transaction (`nativeSqliteAdapter.ts`) must have no
 * ordinary production caller.
 *
 * It exists so Stage M3b4's checkpoint model can be exercised before it is
 * written. If a repository, a composition or a component ever reached it, the
 * `RemovableStorageAdapter` contract's "no multi-key atomicity" promise would
 * quietly stop describing what the application does — and a transaction left
 * open by production code would refuse every other storage operation in the app.
 */
describe("persistence architecture boundary — the diagnostics-only transaction has no production caller", () => {
  const TRANSACTION_MEMBERS = [
    "beginDiagnosticTransaction",
    "stageDiagnosticWrites",
    "stageDiagnosticFailingStatement",
    "commitDiagnosticTransaction",
    "rollbackDiagnosticTransaction",
    "abandonDiagnosticTransaction",
    "hasPendingDiagnosticTransaction",
    "diagnosticTransactionState",
    "reopenDiagnosticConnection",
  ];

  const DECLARING_FILE = join(SRC_ROOT, "lib", "persistence", "nativeSqliteAdapter.ts");

  const productionFiles = collectSourceFiles(SRC_ROOT).filter(
    (path) => !isTestPath(path) && path !== DECLARING_FILE
  );

  it("declares every member it claims to (non-vacuous)", () => {
    const declaration = readFileSync(DECLARING_FILE, "utf8");
    for (const member of TRANSACTION_MEMBERS) {
      expect(declaration).toContain(member);
    }
  });

  it("is referenced by no production file under src/ except the module declaring it", () => {
    const offenders: string[] = [];
    for (const file of productionFiles) {
      const source = stripComments(readFileSync(file, "utf8"));
      for (const member of TRANSACTION_MEMBERS) {
        if (source.includes(member)) offenders.push(`${relative(SRC_ROOT, file)} → ${member}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is not reachable through the repository-facing storage contracts", () => {
    // `RemovableStorageAdapter` still promises no multi-key atomicity. If a
    // transaction member ever appeared in types.ts, every repository would gain
    // the ability to open one.
    const types = stripComments(
      readFileSync(join(SRC_ROOT, "lib", "persistence", "types.ts"), "utf8")
    );
    for (const member of TRANSACTION_MEMBERS) {
      expect(types).not.toContain(member);
    }
    expect(types).not.toContain("Transaction");
  });

  it("keeps the production composition free of it (the one owned production consumer)", () => {
    const composition = stripComments(
      readFileSync(join(SRC_ROOT, "lib", "persistence", "storageComposition.ts"), "utf8")
    );
    for (const member of TRANSACTION_MEMBERS) {
      expect(composition).not.toContain(member);
    }
  });
});
