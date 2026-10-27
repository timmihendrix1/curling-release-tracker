// Architecture-enforcement test — see docs/PERSISTENCE_BOUNDARY_DESIGN.md §9 and
// ADR-0013/ADR-0015. localStorageAdapter.ts is the only production file permitted to
// touch the `localStorage` global, and indexedDbAdapter.ts is the only production file
// permitted to touch the `indexedDB` global; every other domain must go through a
// repository, which itself goes through the shared StorageAdapter. This is a plain
// filesystem/text scan (not an ESLint rule) because the accepted design deferred a
// custom lint rule as unnecessary for Phase 1's scope — see design doc §9.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import ts from "typescript";

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

// AST-based, deliberately separate from the older text guards: comments/string
// prose cannot manufacture imports or effects. S1 is inert, NOT a new token seam.
const S1_PROVIDER = join(SRC_ROOT, "lib/supabase/providerCredentialContract.ts");
const S1_PROTOCOL = join(SRC_ROOT, "lib/persistence/credentialProtocol.ts");
const S1_REDUCER = join(SRC_ROOT, "lib/identity/credentialFaultPolicy.ts");
const S1_FILES = [S1_PROVIDER, S1_PROTOCOL, S1_REDUCER];
const PHYSICAL_SLOTS = join(SRC_ROOT, "lib/persistence/credentialPhysicalSlots.ts");
const PLATFORM_FINGERPRINT = join(SRC_ROOT, "lib/persistence/platformCredentialFingerprint.ts");
const DOMAIN_FINGERPRINT = join(SRC_ROOT, "lib/persistence/platformDomainFingerprint.ts");
const NEW_USER_APPLICATION = join(SRC_ROOT, "lib/supabase/newUserMobileApplication.ts");
const NATIVE_CONFIGURATION = join(SRC_ROOT, "lib/supabase/nativeProviderConfiguration.ts");
const PLATFORM_SHA256 = join(SRC_ROOT, "lib/persistence/platformSha256.ts");
const TRANSFER_V3 = join(SRC_ROOT, "lib/persistence/installationTransferV3.ts");
const TRANSFER_SOURCE_DENIAL = join(SRC_ROOT, "lib/persistence/installationTransferSourceDenial.ts");
const TRANSFER_PUBLICATION = join(SRC_ROOT, "lib/persistence/installationTransferPublicationProtocol.ts");
const PUBLISHED_LIVE_CODEC = join(SRC_ROOT, "lib/persistence/installationPublishedLiveCodeUnits.ts");
const PUBLISHED_BINDING = join(SRC_ROOT, "lib/persistence/installationPublishedBinding.ts");
const PUBLISHED_OWNER = join(SRC_ROOT, "lib/persistence/installationPublishedOwner.ts");
const TRANSFER_ACCOUNT_CONTROL = join(SRC_ROOT, "lib/persistence/installationTransferAccountControl.ts");
const TRANSFER_SOURCE_GUARDS = join(SRC_ROOT, "lib/persistence/installationTransferSourceGuards.ts");
const TRANSFER_ADMISSION = join(SRC_ROOT, "lib/persistence/installationTransferAdmission.ts");
const TRANSFER_PAIRING = join(SRC_ROOT, "lib/persistence/installationTransferPairing.ts");
const TRANSFER_PAIR_PROTOCOL = join(SRC_ROOT, "lib/persistence/installationTransferPairProtocol.ts");
const TRANSFER_PREPARATION = join(SRC_ROOT, "lib/persistence/installationTransferPreparation.ts");
const TRANSFER_CODE_UNITS = join(SRC_ROOT, "lib/persistence/installationTransferCodeUnits.ts");
const TRANSFER_QUARANTINE = join(SRC_ROOT, "lib/persistence/installationTransferQuarantine.ts");
const TRANSFER_QUARANTINE_SQL = join(SRC_ROOT, "lib/persistence/installationTransferQuarantineSql.ts");
const TRANSFER_QUARANTINE_WORK = join(SRC_ROOT, "lib/persistence/installationTransferQuarantineWork.ts");
const TRANSFER_PROTECTION = join(SRC_ROOT, "lib/persistence/installationTransferProtection.ts");
const TRANSFER_SOURCE_HELPER = join(process.cwd(), "transfer-source/src/sourceHelper.ts");
const TRANSFER_SOURCE_ENTRY = join(process.cwd(), "transfer-source/src/main.ts");
const TRANSFER_CODEC = join(SRC_ROOT, "lib/persistence/installationTransferCodec.ts");
const TRANSFER_HISTORICAL = join(SRC_ROOT, "lib/persistence/installationTransferHistorical.ts");
const TRANSFER_SEMANTICS = join(SRC_ROOT, "lib/persistence/installationTransferSemantics.ts");
const NATIVE_TEAM_LINK_SOURCE = join(SRC_ROOT, "lib/supabase/nativeTeamLinkDelivery.ts");
const INERT_BINDINGS = [PHYSICAL_SLOTS, PLATFORM_FINGERPRINT];
const CREDENTIAL_PORT = join(SRC_ROOT, "lib/persistence/nativeCredentialMigrationPort.ts");
const COMMON_OWNER = join(SRC_ROOT, "lib/persistence/nativeCombinedMigrationOwner.ts");
const NATIVE_AUTH_HOST = join(SRC_ROOT, "lib/supabase/supabaseAuthService.ts");
const TRANSFER_APPLICATION = join(SRC_ROOT, "lib", "supabase", "installationTransferApplication.ts");
const TRANSFER_FLOW = join(SRC_ROOT, "components", "persistence", "InstallationTransferFlow.tsx");
const COMMON_ADAPTER = join(SRC_ROOT, "lib/persistence/nativeSqliteAdapter.ts");
const COMMON_SOURCE = join(SRC_ROOT, "lib/persistence/localStorageAdapter.ts");
const UUID_FILE = join(SRC_ROOT, "lib/uuid.ts");
function syntaxTree(source: string) { return ts.createSourceFile("guard.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
const moduleReferenceCache = new Map<string, readonly (string | null)[]>();
function moduleReferences(source: string): readonly (string | null)[] {
  const cached = moduleReferenceCache.get(source);
  if (cached) return cached;
  const references: (string | null)[] = [];
  const add = (node: ts.Node | undefined) => references.push(node && ts.isStringLiteralLike(node) ? node.text : null);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) { if (node.moduleSpecifier) add(node.moduleSpecifier); }
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node)) add(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(syntaxTree(source));
  const result = Object.freeze(references);
  moduleReferenceCache.set(source, result);
  return result;
}
function resolvedModule(file: string, name: string): string {
  const path = name.startsWith("@/") ? join(SRC_ROOT, name.slice(2)) : name.startsWith(".") ? resolve(dirname(file), name) : name;
  const base = path.replace(/\.(?:ts|tsx|js|mjs|cjs)$/, "");
  return normalize(existsSync(base + ".tsx") ? base + ".tsx" : base + ".ts");
}
function s1DependencyViolations(file: string, source: string): (string | null)[] {
  const allowed = file === S1_PROVIDER ? [] : [S1_PROVIDER, UUID_FILE];
  return moduleReferences(source).filter(name => name === null || !allowed.includes(resolvedModule(file, name)));
}
function importsS1(file: string, source: string): boolean {
  return moduleReferences(source).some(name => name !== null && S1_FILES.includes(resolvedModule(file, name)));
}
function bindingDependencyViolations(file: string, source: string): (string | null)[] {
  const allowed = file === PHYSICAL_SLOTS ? [S1_PROVIDER, UUID_FILE] : [S1_PROVIDER, S1_PROTOCOL, PLATFORM_SHA256];
  return moduleReferences(source).filter(name => name === null || !allowed.includes(resolvedModule(file, name)));
}
function importsBinding(file: string, source: string): boolean {
  return moduleReferences(source).some(name => name !== null && INERT_BINDINGS.includes(resolvedModule(file, name)));
}
const S1_FORBIDDEN = new Set(["createClient", "createBrowserClient", "createServerClient", "SupabaseClient", "getSupabaseClient", "getSession", "getUser", "authorizedRequest", "authorizedFetch", "fetch", "XMLHttpRequest", "WebSocket", "localStorage", "sessionStorage", "indexedDB", "SecureStorage", "StorageAdapter", "getItem", "setItem", "removeItem", "storePKCEVerifier", "removePKCEVerifier", "removeAllPKCEVerifiers", "process", "window", "document", "navigator", "globalThis", "Date", "performance", "crypto", "setTimeout", "setInterval", "eval", "Function"]);
function s1Effects(source: string): string[] {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const declarationKey = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) && parent.name === node;
      if (!declarationKey && S1_FORBIDDEN.has(node.text)) found.add(node.text);
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && S1_FORBIDDEN.has(node.argumentExpression.text)) found.add(node.argumentExpression.text);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Math" && node.name.text === "random") found.add("Math.random");
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) found.add("import.meta");
    ts.forEachChild(node, visit);
  };
  visit(syntaxTree(source)); return [...found];
}
function tokenMention(source: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => { if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === "access_token") found = true; ts.forEachChild(node, visit); };
  visit(syntaxTree(source)); return found;
}
function unauthorizedTokenMention(file: string, source: string): boolean {
  return tokenMention(source) && ![join(SRC_ROOT, "lib/supabase/authorizedFetch.ts"), join(SRC_ROOT, "lib/supabase/supabaseCallbackClassifier.ts"), S1_PROVIDER, NATIVE_AUTH_HOST].includes(file);
}

describe("inactive S1 trio — exact pure graph and no production composition", () => {
  const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src")), ...collectSourceFiles(join(process.cwd(), "transfer-source/src"))].filter(file => !isTestPath(file));
  it("checks real source/native-entry files and exact nonempty sibling dependencies", () => {
    expect(files.length).toBeGreaterThan(50);
    for (const file of S1_FILES) {
      const source = readFileSync(file, "utf8");
      expect(s1DependencyViolations(file, source), relative(SRC_ROOT, file)).toEqual([]);
      expect(s1Effects(source), relative(SRC_ROOT, file)).toEqual([]);
    }
    expect(moduleReferences(readFileSync(S1_PROVIDER, "utf8"))).toEqual([]);
    for (const file of [S1_PROTOCOL, S1_REDUCER]) expect(moduleReferences(readFileSync(file, "utf8")).map(name => resolvedModule(file, name!))).toContain(S1_PROVIDER);
    expect(tokenMention(readFileSync(S1_PROVIDER, "utf8"))).toBe(true);
    expect(readFileSync(S1_PROVIDER, "utf8")).toMatch(/token\(obj\.access_token,/);
    expect(files.filter(file => unauthorizedTokenMention(file, readFileSync(file, "utf8")))).toEqual([]);
  });
  it("allows only exact dormant bindings/executor and the actual source boundary to use S1", () => {
    const consumers = [...INERT_BINDINGS, CREDENTIAL_PORT, COMMON_OWNER, COMMON_ADAPTER, COMMON_SOURCE, NATIVE_CONFIGURATION, join(SRC_ROOT, "lib/persistence/nativeTrackerOwner.ts"), TRANSFER_SEMANTICS, TRANSFER_HISTORICAL, TRANSFER_PAIR_PROTOCOL, TRANSFER_PAIRING, TRANSFER_PUBLICATION];
    expect(files.filter(file => ![...S1_FILES, ...consumers].includes(file) && importsS1(file, readFileSync(file, "utf8")))).toEqual([]);
    expect(files.filter(file => importsS1(file, readFileSync(file, "utf8"))).sort()).toEqual([S1_PROTOCOL, S1_REDUCER, ...consumers].sort());
    expect(files.filter(file => importsBinding(file, readFileSync(file, "utf8"))).sort()).toEqual([CREDENTIAL_PORT, COMMON_OWNER, NATIVE_CONFIGURATION, TRANSFER_PAIRING, TRANSFER_PAIR_PROTOCOL, TRANSFER_PUBLICATION, PUBLISHED_OWNER].sort());
    for (const file of INERT_BINDINGS) {
      const source = readFileSync(file, "utf8");
      expect(bindingDependencyViolations(file, source)).toEqual([]);
      expect(s1Effects(source).filter(effect => !["globalThis", "crypto"].includes(effect))).toEqual([]);
    }
    expect(s1Effects(readFileSync(PHYSICAL_SLOTS, "utf8"))).toEqual([]);
  });
  it("keeps shared native coordination and raw bindings inside exact internal callers", () => {
    const coordination = join(SRC_ROOT, "lib/persistence/nativeCredentialNamespace.ts");
    const ordinary = join(SRC_ROOT, "lib/persistence/secureCredentialStore.ts");
    const rawBinding = join(SRC_ROOT, "lib/persistence/capacitorSecureStorageBinding.ts");
    const reader = join(SRC_ROOT, "lib/persistence/iosKeychainReadEvidence.ts");
    const importers = (target: string) => files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === target)).sort();
    expect(importers(coordination)).toEqual([ordinary, CREDENTIAL_PORT, COMMON_OWNER, TRANSFER_PAIRING, PUBLISHED_OWNER].sort());
    expect(readFileSync(COMMON_OWNER, "utf8")).toMatch(/import type \{ CredentialNamespaceLease \} from "\.\/nativeCredentialNamespace"/);
    expect(importers(rawBinding)).toEqual([ordinary, CREDENTIAL_PORT].sort());
    expect(importers(reader)).toEqual([rawBinding]);
    expect(importers(CREDENTIAL_PORT)).toEqual([COMMON_OWNER, TRANSFER_PAIRING, PUBLISHED_OWNER].sort());
    expect(moduleReferences(readFileSync(coordination, "utf8"))).toEqual([]);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createNativeCredentialMigrationPort"))).toEqual([CREDENTIAL_PORT]);
  });

  it("keeps native borrowed evidence inside the real adapter and dormant runner", () => {
    const registry = join(SRC_ROOT, "lib/persistence/nativeMigrationBorrowEvidence.ts");
    const adapter = join(SRC_ROOT, "lib/persistence/nativeSqliteAdapter.ts");
    const runner = join(SRC_ROOT, "lib/persistence/nativeMigrationRunner.ts");
    const importers = files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === registry));
    expect(importers.sort()).toEqual([adapter, runner, COMMON_OWNER].sort());
    for (const [symbol, declaring, consumer] of [
      ["createNativeCommonMigrationControl", registry, COMMON_OWNER],
      ["observeUnexpectedBorrowedAsync", registry, COMMON_OWNER],
      ["observeBorrowedFingerprintFormat", registry, COMMON_OWNER],
      ["registerNativeMigrationBorrowIssuer", registry, adapter],
      ["borrowNativeMigrationTarget", registry, runner],
      ["createNativeHeldDomainMigrationRunner", runner, runner],
      ["registerNativeCombinedHeldHost", registry, adapter],
      ["borrowNativeCombinedHeldHost", registry, runner],
      ["createNativeCombinedHeldDomainMigrationRunner", runner, runner],
      ["createNativeCombinedHeldSqliteHost", adapter, adapter],
      ["registerNativeCommonMigrationHost", registry, adapter],
      ["borrowNativeCommonMigrationHost", registry, runner],
      ["createNativeCommonHeldDomainMigrationRunner", runner, COMMON_OWNER],
      ["createNativeCommonMigrationSqliteContext", adapter, COMMON_OWNER],
      ["createNativeCommonCredentialMigrationPort", CREDENTIAL_PORT, COMMON_OWNER],
      ["createNativeCombinedWebViewSource", COMMON_SOURCE, COMMON_OWNER],
      ["createNativeNewUserWebViewSource", COMMON_SOURCE, COMMON_OWNER],
      ["resolveNativeNewUserSourceProof", COMMON_SOURCE, adapter],
      ["acquireNativeCredentialRetirementSource", COMMON_SOURCE, COMMON_OWNER],
      ["resolveNativeCombinedSourceProof", COMMON_SOURCE, adapter],
      ["fenceNativeCombinedSourceProof", COMMON_SOURCE, adapter],
    ]) {
      expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes(symbol)).sort()).toEqual([...new Set([declaring, consumer])].sort());
    }
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("nativeCommonMigrationControlCurrent")).sort()).toEqual([registry, adapter, runner].sort());
    expect(moduleReferences(readFileSync(registry, "utf8"))).toEqual(["./nativeSqliteAdapter", "./nativeMigrationRecord", "./nativeMigrationDecision"]);
    expect(readFileSync(registry, "utf8")).toMatch(/import type.*NativeMigrationEvidence/);
    expect(readFileSync(registry, "utf8")).toMatch(/import type/);
  });
  it("keeps the complete common executor dormant and its native construction dynamic", () => {
    const importers = files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === COMMON_OWNER));
    expect(importers).toEqual([NATIVE_AUTH_HOST]);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createNativeCombinedMigrationOwner"))).toEqual([COMMON_OWNER]);
    const code = stripComments(readFileSync(COMMON_OWNER, "utf8"));
    for (const pattern of [/\blocalStorage\b/, /\bsessionStorage\b/, /\bfetch\s*\(/, /\bsetTimeout\b/, /\bsetInterval\b/, /\bprocess\.env\b/, /\bconsole\./, /\bremoveItem\b/, /\bcreateClient\b/]) expect(pattern.test(code), String(pattern)).toBe(false);
    const dependencies = ["localStorageAdapter", "nativeCredentialMigrationPort", "nativeCredentialNamespace", "nativeCombinedRuntime", "nativeSqliteAdapter", "nativeMigrationRunner", "nativeMigrationBorrowEvidence", "nativeMigrationRecord", "nativeMigrationEligibility", "credentialProtocol", "credentialPhysicalSlots", "providerCredentialContract", "uuid", "runtimePlatform"];
    expect(moduleReferences(code).every(name => name !== null && dependencies.some(allowed => name.endsWith("/" + allowed)))).toBe(true);
    expect(code).toContain('await import("./nativeSqliteAdapter")');
  });


  it("keeps the mutable paired runtime inside exact dormant resource owners", () => {
    const runtime = join(SRC_ROOT, "lib/persistence/nativeCombinedRuntime.ts");
    const importers = files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === runtime));
    expect(importers.sort()).toEqual([COMMON_OWNER, COMMON_ADAPTER, CREDENTIAL_PORT, NATIVE_AUTH_HOST, TRANSFER_PAIRING, TRANSFER_QUARANTINE_SQL, PUBLISHED_OWNER, join(SRC_ROOT, "lib/persistence/nativeTrackerOwner.ts")].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createNativeCombinedRuntimeOwner"))).toEqual([COMMON_OWNER]);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("prepareNativeCredentialRuntime")).sort()).toEqual([COMMON_OWNER, CREDENTIAL_PORT].sort());
    expect(moduleReferences(readFileSync(runtime, "utf8"))).toEqual(["./types", "./secureCredentialStore"]);
    const code = stripComments(readFileSync(runtime, "utf8"));
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("subscribeNativeRuntimeRevocation")).sort()).toEqual([runtime, NATIVE_AUTH_HOST].sort());
    for (const pattern of [/\blocalStorage\b/, /\bsessionStorage\b/, /\bfetch\s*\(/, /\bsetTimeout\b/, /\bsetInterval\b/, /\bprocess\.env\b/, /\bconsole\./, /\bcreateClient\b/]) expect(pattern.test(code), String(pattern)).toBe(false);
  });

  it("keeps explicit credential retirement dormant inside the common source boundary", () => {
    expect(files.filter(file => stripComments(readFileSync(file,"utf8")).includes("createNativeCombinedRetirementOwner")).sort()).toEqual([COMMON_OWNER, NATIVE_AUTH_HOST].sort());
    for (const symbol of ["NativeCredentialRetirementSource","NativeRetirementSourceProof"]) expect(files.filter(file => stripComments(readFileSync(file,"utf8")).includes(symbol)).sort()).toEqual([COMMON_SOURCE,COMMON_OWNER].sort());
  });

  it("detects outside callers and forbidden dependencies in every import form", () => {
    const forms = (path: string) => [`import { x } from '${path}'`, `import '${path}'`, `export { x } from '${path}'`, `export * from '${path}'`, `import('${path}')`, `require ('${path}')`, `import x = require('${path}')`];
    for (const source of forms("@/lib/persistence/credentialProtocol")) {
      for (const file of [join(SRC_ROOT, "app/page.tsx"), join(process.cwd(), "mobile/src/main.tsx")]) expect(importsS1(file, source), source).toBe(true);
    }
    for (const path of ["@supabase/supabase-js", "@supabase/auth-js/dist/main/lib/helpers", "../supabase/authorizedFetch", "../persistence/localStorageAdapter", "./unknown"]) for (const source of forms(path)) expect(s1DependencyViolations(S1_PROTOCOL, source), source).not.toEqual([]);
    expect(s1DependencyViolations(S1_PROTOCOL, "import(variableName)")).toEqual([null]);
    expect(s1DependencyViolations(S1_PROTOCOL, "import { isCanonicalUuid } from '../uuid'; export type { Result } from '../supabase/providerCredentialContract';")).toEqual([]);
    for (const source of ["// import '@/lib/persistence/credentialProtocol'", "/* require('@supabase/auth-js') */", "const credentialProtocolLabel = 'unrelated';", "import './unrelated';"]) expect(importsS1(join(SRC_ROOT, "app/page.tsx"), source)).toBe(false);
  });
  it("keeps the standard domain fingerprint helper confined to explicit configuration preparation", () => {
    const importsDomain = (file: string, source: string) => moduleReferences(source).some(name => name !== null && resolvedModule(file,name) === DOMAIN_FINGERPRINT);
    expect(files.filter(file => importsDomain(file,readFileSync(file,"utf8")))).toEqual([NATIVE_CONFIGURATION]);
    expect(files.filter(file => stripComments(readFileSync(file,"utf8")).includes("createPlatformDomainFingerprint")).sort()).toEqual([DOMAIN_FINGERPRINT, NATIVE_CONFIGURATION].sort());
    const source=readFileSync(DOMAIN_FINGERPRINT,"utf8");
    expect(moduleReferences(source)).toEqual(["./platformSha256"]);
    expect(s1Effects(source).filter(effect => !["globalThis","crypto"].includes(effect))).toEqual([]);
    for(const file of [join(SRC_ROOT,"app/page.tsx"),join(process.cwd(),"mobile/src/main.tsx")]) {
      for(const form of ["import './platformDomainFingerprint'", "export * from './platformDomainFingerprint'", "import('./platformDomainFingerprint')", "require('./platformDomainFingerprint')", "import x = require('./platformDomainFingerprint')", "type T = import('./platformDomainFingerprint').T"]) {
        const path=relative(dirname(file),DOMAIN_FINGERPRINT).replace(/\.ts$/,"");
        expect(importsDomain(file,form.replaceAll("./platformDomainFingerprint",path.startsWith(".")?path:"./"+path))).toBe(true);
      }
      expect(importsDomain(file,"// import '@/lib/persistence/platformDomainFingerprint'\nconst label = 'platformDomainFingerprint';")).toBe(false);
    }
  });
  it("keeps the isolated observation helper confined to its separate entry and exact dependencies", () => {
    const source = readFileSync(TRANSFER_SOURCE_HELPER, "utf8"), tree = syntaxTree(source);
    expect([...moduleReferences(source)].sort()).toEqual(["../../src/lib/persistence/localStorageAdapter", "../../src/lib/persistence/platformSha256", "@capacitor/core", "@capacitor/app"].sort());
    const importers = files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === TRANSFER_SOURCE_HELPER));
    expect(importers).toEqual([TRANSFER_SOURCE_ENTRY]);
    const exports = tree.statements.filter(ts.isFunctionDeclaration).filter(node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
    expect(exports.map(node => [node.name?.text, node.parameters.length])).toEqual([["createInstallationTransferSourceHelper", 0]]);
    expect(tree.statements.filter(ts.isImportDeclaration).some(node => ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith("@capacitor"))).toBe(false);
    expect(stripComments(source)).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|setItem|removeItem|clear|setTimeout|setInterval|console)\b|process\.env|removeAllListeners|owner_frozen|InstallationTransferV3|Http|Cookies/);
  });
  it("confines the actual new-user beta owner to the selected mobile root", () => {
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    const root = join(process.cwd(), "mobile/src/storage/NewUserBetaRoot.tsx");
    const importers = files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === NEW_USER_APPLICATION));
    expect(importers).toEqual([root]);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createNewUserMobileApplication")).sort()).toEqual([NEW_USER_APPLICATION, root].sort());
    const source = stripComments(readFileSync(NEW_USER_APPLICATION, "utf8"));
    expect(source).not.toMatch(/claimBrowser|nativeActivationReadyForTests|createNativeSportingIdentityHost|createConfiguredNativeSportingIdentityHost|localStorage|sessionStorage|indexedDB/);
  });
  it("confines genuine configuration preparation to the explicit dormant host route", () => {
    const importers = files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === NATIVE_CONFIGURATION));
    expect(importers.sort()).toEqual([NATIVE_AUTH_HOST, TRANSFER_APPLICATION, NEW_USER_APPLICATION].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createConfiguredNativeSportingIdentityHost"))).toEqual([NATIVE_AUTH_HOST]);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createConfiguredNewUserNativeSportingIdentityHost")).sort()).toEqual([NATIVE_AUTH_HOST, NEW_USER_APPLICATION].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createNativeNewUserRuntimeOwner")).sort()).toEqual([COMMON_OWNER, NATIVE_AUTH_HOST].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("prepareNativeProviderConfiguration")).sort()).toEqual([NATIVE_CONFIGURATION, NEW_USER_APPLICATION].sort());
    const shaImporters = files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === PLATFORM_SHA256));
    expect(shaImporters.sort()).toEqual([DOMAIN_FINGERPRINT, PLATFORM_FINGERPRINT, NATIVE_CONFIGURATION, NATIVE_AUTH_HOST, NATIVE_TEAM_LINK_SOURCE, TRANSFER_V3, TRANSFER_PROTECTION, TRANSFER_QUARANTINE_WORK, TRANSFER_SOURCE_DENIAL, COMMON_SOURCE, TRANSFER_SOURCE_HELPER, CREDENTIAL_PORT, TRANSFER_PUBLICATION, TRANSFER_QUARANTINE_SQL].sort());
    expect(moduleReferences(readFileSync(PLATFORM_SHA256, "utf8"))).toEqual([]);
    const hostShaImports = syntaxTree(readFileSync(NATIVE_AUTH_HOST, "utf8")).statements.filter(ts.isImportDeclaration)
      .filter(node => ts.isStringLiteral(node.moduleSpecifier) && resolvedModule(NATIVE_AUTH_HOST, node.moduleSpecifier.text) === PLATFORM_SHA256)
      .map(node => node.importClause?.namedBindings).flatMap(node => node && ts.isNamedImports(node) ? node.elements.map(element => element.name.text) : []);
    expect(hostShaImports).toEqual(["drainObservedPlatformWork"]);
    expect(s1Effects(readFileSync(PLATFORM_SHA256, "utf8")).filter(effect => !["globalThis", "crypto"].includes(effect))).toEqual([]);
    const source = readFileSync(NATIVE_CONFIGURATION, "utf8");
    const allowed = ["config", "providerCredentialStorage", "providerCredentialContract", "platformDomainFingerprint", "platformCredentialFingerprint", "nativeSportingDataCapture", "platformSha256"];
    expect(moduleReferences(source).every(name => name !== null && allowed.some(end => name.endsWith("/" + end)))).toBe(true);
    expect(stripComments(source)).not.toMatch(/process\.env|\bfetch\s*\(|\blocalStorage\b|\bsessionStorage\b|\bconsole\.|\bcreateClient\b|setTimeout|setInterval/);
  });
  it("confines the standard V3 byte binding and pure core internals to one dormant wrapper", () => {
    const importer = (target: string) => files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === target));
    expect(importer(TRANSFER_V3).sort()).toEqual([TRANSFER_SEMANTICS, TRANSFER_HISTORICAL, TRANSFER_PROTECTION, TRANSFER_ADMISSION, TRANSFER_SOURCE_DENIAL].sort());
    expect(importer(TRANSFER_CODEC)).toEqual([TRANSFER_V3]);
    expect(moduleReferences(readFileSync(TRANSFER_V3, "utf8"))).toEqual(["./installationTransferCodec", "./platformSha256"]);
    for (const [symbol, expected] of [["installationTransferV3Internals", [TRANSFER_CODEC, TRANSFER_V3]], ["capturePlatformByteSha256", [PLATFORM_SHA256, TRANSFER_V3]]] as const) {
      expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes(symbol)).sort()).toEqual([...expected].sort());
    }
    const source = stripComments(readFileSync(TRANSFER_V3, "utf8"));
    expect(source).not.toMatch(/\b(fetch|window|document|navigator|localStorage|sessionStorage|indexedDB|createClient|setTimeout|setInterval)\b|process\.env|console\./);
    const imports = syntaxTree(source).statements.filter(ts.isImportDeclaration).filter(node => ts.isStringLiteral(node.moduleSpecifier) && resolvedModule(TRANSFER_V3, node.moduleSpecifier.text) === TRANSFER_CODEC)
      .map(node => node.importClause?.namedBindings).flatMap(node => node && ts.isNamedImports(node) ? node.elements.map(element => element.name.text) : []);
    expect(imports).toEqual(["installationTransferV3Internals"]);
    for (const symbol of ["encodeInstallationTransferV3", "decodeInstallationTransferV3"]) expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes(symbol)).sort()).toEqual((symbol.startsWith("decode") ? [TRANSFER_V3, TRANSFER_SEMANTICS, TRANSFER_HISTORICAL, TRANSFER_PROTECTION, TRANSFER_ADMISSION, TRANSFER_SOURCE_DENIAL] : [TRANSFER_V3]).sort());
  });
  it("keeps standard archive protection inside its exact private graph without app callers", () => {
    const source = readFileSync(TRANSFER_PROTECTION, "utf8"), tree = syntaxTree(source);
    const importers = files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === TRANSFER_PROTECTION));
    expect(importers.sort()).toEqual([TRANSFER_QUARANTINE, TRANSFER_ADMISSION].sort());
    expect(moduleReferences(source)).toEqual(["./installationTransferV3", "./installationTransferInventory", "./platformSha256"]);
    const named = (target: string) => tree.statements.filter(ts.isImportDeclaration).filter(node => ts.isStringLiteral(node.moduleSpecifier) && resolvedModule(TRANSFER_PROTECTION, node.moduleSpecifier.text) === target).map(node => node.importClause?.namedBindings).flatMap(node => node && ts.isNamedImports(node) ? node.elements.map(element => element.name.text) : []);
    expect(named(TRANSFER_V3)).toEqual(["decodeInstallationTransferV3"]);
    expect(named(PLATFORM_SHA256)).toEqual(["observePlatformWork", "drainObservedPlatformWork"]);
    expect(tree.statements.filter(ts.isFunctionDeclaration).filter(node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)).map(node => node.name?.text)).toEqual(["sealInstallationTransferV3", "openInstallationTransferV3"]);
    expect(tree.statements.filter(ts.isFunctionDeclaration).filter(node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)).map(node => node.parameters.length)).toEqual([1, 2]);
    for (const name of ["sealInstallationTransferV3", "openInstallationTransferV3"]) expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes(name)).sort()).toEqual((name.startsWith("open") ? [TRANSFER_PROTECTION, TRANSFER_QUARANTINE, TRANSFER_ADMISSION] : [TRANSFER_PROTECTION]).sort());
    expect(stripComments(source)).not.toMatch(/JSON\.(?:stringify|parse)|\b(fetch|window|document|navigator|localStorage|sessionStorage|indexedDB|StorageAdapter|createClient|setTimeout|setInterval|exportKey)\b|process\.env|console\./);
  });
  it("confines protected quarantine to its exact inert private construction graph", () => {
    const consumers = (symbol: string) => files.filter(file => stripComments(readFileSync(file, "utf8")).includes(symbol)).sort();
    expect(files.filter(file => /\bcreateInstallationTransferQuarantine\b/.test(stripComments(readFileSync(file, "utf8"))))).toEqual([TRANSFER_QUARANTINE]);
    expect(consumers("createNativeTransferQuarantineContext")).toEqual([COMMON_ADAPTER, TRANSFER_QUARANTINE_SQL].sort());
    expect(consumers("createInstallationTransferQuarantineSql")).toEqual([TRANSFER_QUARANTINE, TRANSFER_QUARANTINE_SQL].sort());
    expect(consumers("createQuarantineWork")).toEqual([TRANSFER_QUARANTINE_SQL, TRANSFER_QUARANTINE, TRANSFER_QUARANTINE_WORK, TRANSFER_PREPARATION, TRANSFER_PAIR_PROTOCOL, PUBLISHED_OWNER, TRANSFER_APPLICATION].sort());
    const importers = (target: string) => files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === target)).sort();
    expect(importers(TRANSFER_QUARANTINE)).toEqual([]);
    expect(importers(TRANSFER_QUARANTINE_WORK)).toEqual([TRANSFER_QUARANTINE_SQL, TRANSFER_QUARANTINE, TRANSFER_PREPARATION, TRANSFER_ADMISSION, TRANSFER_PAIR_PROTOCOL, PUBLISHED_OWNER, TRANSFER_APPLICATION].sort());
    expect(importers(TRANSFER_QUARANTINE_SQL).sort()).toEqual([TRANSFER_QUARANTINE, TRANSFER_PREPARATION, TRANSFER_ADMISSION, TRANSFER_PAIRING, PUBLISHED_OWNER].sort());
    const source = stripComments(readFileSync(TRANSFER_QUARANTINE, "utf8"));
    expect(source).toContain('await import("./installationTransferQuarantineSql")');
    expect([...source.matchAll(/import\("\.\/installationTransferQuarantineSql"\)/g)]).toHaveLength(1);
    const adapterStatic = syntaxTree(source).statements.filter(ts.isImportDeclaration).filter(node => ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "./nativeSqliteAdapter");
    expect(adapterStatic).toHaveLength(1); expect(adapterStatic[0].importClause?.isTypeOnly).toBe(true);
    expect(source).not.toMatch(/\b(fetch|window|document|navigator|localStorage|sessionStorage|indexedDB|createClient|setTimeout|setInterval)\b|process\.env|console\./);
    const adapter = readFileSync(COMMON_ADAPTER, "utf8");
    expect(adapter).not.toContain("installation_transfer_quarantine_v1");
    expect(moduleReferences(adapter)).not.toContain("./installationTransferQuarantineWork");
    expect(moduleReferences(adapter)).not.toContain("./installationTransferQuarantineSql");
    expect(readFileSync(TRANSFER_QUARANTINE_SQL, "utf8")).toContain("installation_transfer_quarantine_v1");
    expect(adapter).toContain('quarantineHooks !== null || platform !== "android"');
    const work = readFileSync(TRANSFER_QUARANTINE_WORK, "utf8");
    expect(work).toContain("25165824 + 16");
    expect(moduleReferences(work)).toEqual(["./platformSha256"]);
    const sqlTree = syntaxTree(readFileSync(TRANSFER_QUARANTINE_SQL, "utf8"));
    const imports = sqlTree.statements.filter(ts.isImportDeclaration);
    expect(imports.map(node => (node.moduleSpecifier as ts.StringLiteral).text)).toEqual(["./installationPublishedLiveCodeUnits", "./installationPublishedBinding", "./nativeSqliteAdapter", "./installationTransferQuarantineWork", "./installationTransferCodeUnits", "./installationTransferPairProtocol", "./installationTransferSourceDenial", "./installationTransferPublicationProtocol", "./platformSha256", "../uuid", "./installationTransferAccountControl", "./installationTransferInventory", "./nativeMigrationEligibility", "./nativeCombinedRuntime", "../identity/identityTransitionCoordinator", "./types"]);
    const named = imports.find(node => (node.moduleSpecifier as ts.StringLiteral).text === "./nativeSqliteAdapter")?.importClause?.namedBindings;
    expect(named && ts.isNamedImports(named) ? named.elements.filter(e => !e.isTypeOnly).map(e => e.name.text) : []).toEqual(["createNativeTransferQuarantineContext"]);
  });
  it("confines actual sporting preparation and codeunit storage to their exact dormant consumers", () => {
    const importer = (target: string) => files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === target)).sort();
    expect(importer(TRANSFER_PREPARATION)).toEqual([]);
    expect(importer(TRANSFER_CODE_UNITS)).toEqual([TRANSFER_ADMISSION, TRANSFER_QUARANTINE_SQL, TRANSFER_SOURCE_DENIAL, TRANSFER_PUBLICATION].sort());
    expect(files.filter(file => /\bcreateInstallationTransferPreparation\b/.test(stripComments(readFileSync(file, "utf8"))))).toEqual([TRANSFER_PREPARATION]);
    expect(files.filter(file => /\bcreateInstallationTransferPreparationSql\b/.test(stripComments(readFileSync(file, "utf8")))).sort()).toEqual([TRANSFER_PREPARATION, TRANSFER_QUARANTINE_SQL].sort());
    const source = stripComments(readFileSync(TRANSFER_PREPARATION, "utf8"));
    expect(source).toContain('await import("./installationTransferQuarantineSql")');
    const statics = syntaxTree(source).statements.filter(ts.isImportDeclaration).filter(node => ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "./nativeSqliteAdapter");
    expect(statics).toHaveLength(1); expect(statics[0].importClause?.isTypeOnly).toBe(true);
    expect(moduleReferences(readFileSync(TRANSFER_CODE_UNITS, "utf8"))).toEqual([]);
    for (const file of [TRANSFER_PREPARATION, TRANSFER_CODE_UNITS]) expect(stripComments(readFileSync(file, "utf8"))).not.toMatch(/\b(fetch|window|document|navigator|localStorage|sessionStorage|indexedDB|createClient|setTimeout|setInterval)\b|process\.env|console\./);
  });
  it("keeps actual fresh destination pairing and its admission/anchor helpers private and dormant", () => {
    const importer = (target: string) => files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === target)).sort();
    expect(importer(TRANSFER_PAIRING)).toEqual([NATIVE_AUTH_HOST]);
    expect(files.filter(file => /\bfreshEmailOtpOnline\b/.test(stripComments(readFileSync(file, "utf8")))).sort()).toEqual([NATIVE_AUTH_HOST, join(SRC_ROOT, "lib/identity/identityTransitionCoordinator.ts")].sort());
    for (const symbol of ["isNativeFreshEmailOtpSource", "readNativeFreshEmailOtp"]) {
      expect(files.filter(file => new RegExp(`\\b${symbol}\\b`).test(stripComments(readFileSync(file, "utf8")))).sort()).toEqual([TRANSFER_QUARANTINE_SQL, ...(symbol === "readNativeFreshEmailOtp" ? [TRANSFER_ACCOUNT_CONTROL] : []), join(SRC_ROOT, "lib/identity/identityTransitionCoordinator.ts")].sort());
    }
    const hostTree = syntaxTree(readFileSync(NATIVE_AUTH_HOST, "utf8"));
    const hostFunctions = hostTree.statements.filter(ts.isFunctionDeclaration);
    const transferHost = hostFunctions.find(node => node.name?.text === "createConfiguredInstallationTransferHost")!;
    const sharedHost = hostFunctions.find(node => node.name?.text === "createNativeHost")!;
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createConfiguredInstallationTransferApplicationHost")).sort()).toEqual([NATIVE_AUTH_HOST, TRANSFER_APPLICATION].sort());
    expect(moduleReferences(transferHost.getText(hostTree))).toContain("../persistence/installationTransferPairing");
    expect(moduleReferences(sharedHost.getText(hostTree))).not.toContain("../persistence/installationTransferPairing");
    expect(moduleReferences(transferHost.getText(hostTree))).toContain("../persistence/installationTransferAccountControl");
    expect(moduleReferences(sharedHost.getText(hostTree))).not.toContain("../persistence/installationTransferAccountControl");
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createConfiguredInstallationTransferIdentityHost"))).toEqual([NATIVE_AUTH_HOST]);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createTransferCredentialMigrationPort")).sort()).toEqual([TRANSFER_PAIRING, CREDENTIAL_PORT].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createInstallationTransferHostOwner")).sort()).toEqual([TRANSFER_PAIRING, NATIVE_AUTH_HOST].sort());
    expect(importer(TRANSFER_ADMISSION)).toEqual([TRANSFER_PREPARATION, TRANSFER_PAIRING].sort());
    expect(importer(TRANSFER_PAIR_PROTOCOL)).toEqual([TRANSFER_QUARANTINE_SQL, TRANSFER_PAIRING].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("prepareNativeCredentialMigrationCleanup")).sort()).toEqual([CREDENTIAL_PORT, TRANSFER_PAIRING, PUBLISHED_OWNER].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("healthyReleaseReady")).sort()).toEqual([CREDENTIAL_PORT, join(SRC_ROOT, "lib/persistence/nativeCredentialNamespace.ts")].sort());
    for (const file of [TRANSFER_PAIRING, TRANSFER_PAIR_PROTOCOL, TRANSFER_ADMISSION]) expect(stripComments(readFileSync(file, "utf8"))).not.toMatch(/\b(fetch|window|document|navigator|localStorage|sessionStorage|indexedDB|createClient|setTimeout|setInterval)\b|process\.env|console\./);
    const source = stripComments(readFileSync(TRANSFER_PAIRING, "utf8"));
    expect(source).toContain('await import("./installationTransferQuarantineSql")');
    expect(source).not.toMatch(/publishNativeCombinedRuntime|createNativeCombinedRetirementOwner|resolveNativeProviderConfiguration/);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("publishTransferIdentityRuntime")).sort()).toEqual([TRANSFER_PAIRING, join(SRC_ROOT, "lib/persistence/nativeCombinedRuntime.ts")].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("prepareTransferIdentityCredentialRuntime")).sort()).toEqual([TRANSFER_PAIRING, CREDENTIAL_PORT].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("ownsTransferRuntimeCompletion")).sort()).toEqual([TRANSFER_QUARANTINE_SQL, CREDENTIAL_PORT, PUBLISHED_OWNER, join(SRC_ROOT, "lib/persistence/nativeCombinedRuntime.ts")].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("registerTransferRuntimeCompletion")).sort()).toEqual([TRANSFER_QUARANTINE_SQL, CREDENTIAL_PORT, join(SRC_ROOT, "lib/persistence/nativeCombinedRuntime.ts")].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("nativeRuntimeStorageHealthy")).sort()).toEqual([TRANSFER_QUARANTINE_SQL, PUBLISHED_OWNER, join(SRC_ROOT, "lib/persistence/nativeCombinedRuntime.ts")].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("publishPrepared")).sort()).toEqual([TRANSFER_QUARANTINE_SQL, TRANSFER_PAIRING, NATIVE_AUTH_HOST].sort());
    for (const marker of ["installation_transfer_publication_v1", "installation_transfer_live_v1"]) expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes(marker))).toEqual([TRANSFER_QUARANTINE_SQL]);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createInstallationTransferIdentityOwner"))).toEqual([TRANSFER_PAIRING]);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createInstallationTransferIdentitySql")).sort()).toEqual([TRANSFER_PAIRING, TRANSFER_QUARANTINE_SQL].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createInstallationTransferSourceIdentitySql")).sort()).toEqual([TRANSFER_PAIRING, TRANSFER_QUARANTINE_SQL].sort());
    expect(stripComments(readFileSync(TRANSFER_PAIR_PROTOCOL, "utf8"))).not.toMatch(/correlatePair|Math\.random|kind: ["']active/);
  });
  it("confines source-denial evaluation and handle minting to the separate dormant admission", () => {
    const importer = (target: string) => files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === target)).sort();
    expect(importer(TRANSFER_SOURCE_DENIAL)).toEqual([TRANSFER_ADMISSION, TRANSFER_QUARANTINE_SQL, TRANSFER_SOURCE_GUARDS, PUBLISHED_BINDING].sort());
    for (const symbol of ["evaluateTransferSourceDenial", "admitSourceAwareTransferPreparation"]) expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes(symbol)).sort()).toEqual((symbol === "evaluateTransferSourceDenial" ? [TRANSFER_SOURCE_DENIAL, TRANSFER_ADMISSION] : [TRANSFER_ADMISSION, TRANSFER_PAIRING]).sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("resolveTransferSourceDenial")).sort()).toEqual([TRANSFER_SOURCE_DENIAL, TRANSFER_QUARANTINE_SQL, TRANSFER_SOURCE_GUARDS].sort());
    const source = stripComments(readFileSync(TRANSFER_SOURCE_DENIAL, "utf8"));
    expect(source).not.toMatch(/\b(fetch|window|document|navigator|localStorage|sessionStorage|indexedDB|createClient|setTimeout|setInterval)\b|process\.env|console\./);
    expect(source).toContain("evaluateDurablePreflight");
    expect(source).toContain("readIdentityRecord(adapter, INTENT_CLEANUP_STORAGE_KEY, validateOutstandingIntentCleanup)");
    expect(source).not.toMatch(/\b(settleIntentBeforeReady|clearOutstandingCleanup|createPendingIntentRepository)\b/);
    expect(source).not.toMatch(/\.(save|saveForBarrier|resolve|begin|canAdmit|cleanUpNonCurrentAttempt|retractUnconfirmedResolution)\(/);
  });
  it("keeps publication capability, observations and owned SHA in the closed source graph", () => {
    const consumers = (symbol: string) => files.filter(file => new RegExp(`\\b${symbol}\\b`).test(stripComments(readFileSync(file, "utf8")))).sort();
    expect(consumers("createPublicationTransferCredentialMigrationPort")).toEqual([CREDENTIAL_PORT, TRANSFER_PAIRING, PUBLISHED_OWNER].sort());
    expect(consumers("publicationTransferCredentialCapability")).toEqual([CREDENTIAL_PORT, TRANSFER_PAIRING, PUBLISHED_OWNER].sort());
    expect(consumers("recordPublicationAnchorObservation")).toEqual([CREDENTIAL_PORT, TRANSFER_PUBLICATION].sort());
    expect(consumers("readPublicationAnchorObservation")).toEqual([TRANSFER_PUBLICATION, TRANSFER_QUARANTINE_SQL, CREDENTIAL_PORT].sort());
    expect(consumers("captureOwnedPlatformSha256")).toEqual([PLATFORM_SHA256, TRANSFER_PUBLICATION].sort());
    expect(readFileSync(PHYSICAL_SLOTS, "utf8")).not.toContain('"t1."');
    expect(moduleReferences(readFileSync(TRANSFER_PUBLICATION, "utf8"))).toEqual(["./credentialPhysicalSlots", "./credentialProtocol", "../uuid", "../identity/accountDeletionGuard", "../identity/untrustedValue", "../supabase/providerCredentialContract", "./installationTransferCodeUnits", "./platformSha256"]);
    expect(stripComments(readFileSync(TRANSFER_PUBLICATION, "utf8"))).not.toMatch(/\b(fetch|window|document|navigator|localStorage|sessionStorage|indexedDB|createClient|setTimeout|setInterval)\b|process\.env|console\./);
  });
  it("confines published provenance and runtime handoff to the closed genuine owner", () => {
    const consumers = (symbol: string) => files.filter(file => new RegExp(`\\b${symbol}\\b`).test(stripComments(readFileSync(file, "utf8")))).sort();
    expect(files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === PUBLISHED_LIVE_CODEC))).toEqual([TRANSFER_QUARANTINE_SQL]);
    expect(moduleReferences(readFileSync(PUBLISHED_LIVE_CODEC, "utf8"))).toEqual([]);
    expect(consumers("recordPublishedInstallationBinding")).toEqual([PUBLISHED_BINDING, TRANSFER_QUARANTINE_SQL].sort());
    expect(consumers("readPublishedInstallationBinding")).toEqual([PUBLISHED_BINDING, TRANSFER_QUARANTINE_SQL, TRANSFER_SOURCE_GUARDS].sort());
    expect(consumers("createPublishedInstallationSql")).toEqual([PUBLISHED_OWNER, TRANSFER_QUARANTINE_SQL].sort());
    expect(consumers("createPublishedInstallationOwner")).toEqual([PUBLISHED_OWNER, NATIVE_AUTH_HOST].sort());
    for (const path of [PUBLISHED_BINDING, PUBLISHED_OWNER]) expect(stripComments(readFileSync(path, "utf8"))).not.toMatch(/\b(fetch|window|document|navigator|localStorage|sessionStorage|indexedDB|createClient|setTimeout|setInterval)\b|process\.env|console\./);
    expect(consumers("publishPublishedInstallationRuntime")).toEqual([PUBLISHED_OWNER, join(SRC_ROOT, "lib/persistence/nativeCombinedRuntime.ts")].sort());
    expect(consumers("createPublishedSourceGuardOwner")).toEqual([PUBLISHED_OWNER, TRANSFER_SOURCE_GUARDS].sort());
    expect(consumers("createConfiguredPublishedInstallationIdentityHost")).toEqual([NATIVE_AUTH_HOST, TRANSFER_APPLICATION].sort());
    const hostTree = syntaxTree(readFileSync(NATIVE_AUTH_HOST, "utf8"));
    const named = hostTree.statements.filter(ts.isFunctionDeclaration).find(node => node.name?.text === "createConfiguredPublishedInstallationIdentityHost")!;
    expect(moduleReferences(named.getText(hostTree))).toContain("../persistence/installationPublishedOwner");
    const common = hostTree.statements.filter(ts.isFunctionDeclaration).find(node => node.name?.text === "createNativeHost")!;
    expect(moduleReferences(common.getText(hostTree))).not.toContain("../persistence/installationPublishedOwner");
    const owner = stripComments(readFileSync(PUBLISHED_OWNER, "utf8"));
    expect(owner).not.toMatch(/prepareTransferIdentityCredentialRuntime|publishTransferIdentityRuntime|registerNativeTrackerRuntime|recoveryCode|protectedWire/);
  });
  it("confines actual final server observations to the closed producer and source SQL inspector", () => {
    const consumers = (symbol: string) => files.filter(file => stripComments(readFileSync(file, "utf8")).includes(symbol)).sort();
    expect(consumers("createTransferAccountControlObservation")).toEqual([TRANSFER_ACCOUNT_CONTROL, NATIVE_AUTH_HOST].sort());
    expect(consumers("readTransferAccountControlObservation")).toEqual([TRANSFER_ACCOUNT_CONTROL, TRANSFER_QUARANTINE_SQL].sort());
    const host = syntaxTree(readFileSync(NATIVE_AUTH_HOST, "utf8"));
    expect(host.statements.filter(ts.isImportDeclaration).some(n => ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text.includes("installationTransferAccountControl"))).toBe(false);
    expect(moduleReferences(readFileSync(TRANSFER_ACCOUNT_CONTROL, "utf8"))).toEqual(["../identity/identityTransitionCoordinator", "../identity/accountDeletionGuard", "../uuid"]);
  });
  it("confines the source-guard owner to the actual dormant pairing host", () => {
    const source = stripComments(readFileSync(TRANSFER_SOURCE_GUARDS, "utf8"));
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createTransferSourceGuardOwner")).sort()).toEqual([TRANSFER_SOURCE_GUARDS, TRANSFER_PAIRING].sort());
    expect(moduleReferences(source)).toEqual(["./installationPublishedBinding", "./installationTransferSourceDenial", "./installationTransferSourceDenial", "../identity/accountDeletionGuard", "../uuid", "./types"]);
    expect(source).not.toMatch(/\b(fetch|window|document|navigator|localStorage|sessionStorage|indexedDB|createClient|setTimeout|setInterval)\b|process\.env|console\./);
  });
  it("confines V3 domain interpretation to actual repositories and a private disposable copy", () => {
    const source = readFileSync(TRANSFER_SEMANTICS, "utf8"), tree = syntaxTree(source);
    const importer = (target: string) => files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === target));
    expect(importer(TRANSFER_SEMANTICS)).toEqual([TRANSFER_HISTORICAL]);
    expect(moduleReferences(source)).toEqual(["./installationTransferV3", "./profileScopedSportingPersistence", "../cloudSporting/syncStateRepository", "../supabase/providerCredentialContract", "../exercises/catalog", "../exercises/content", "../exercises/lookup", "../trainingPlans/validation", "./types"]);
    const named = (target: string) => tree.statements.filter(ts.isImportDeclaration).filter(node => ts.isStringLiteral(node.moduleSpecifier) && resolvedModule(TRANSFER_SEMANTICS, node.moduleSpecifier.text) === target).map(node => node.importClause?.namedBindings).flatMap(node => node && ts.isNamedImports(node) ? node.elements.map(element => element.name.text) : []);
    expect(named(TRANSFER_V3)).toEqual(["decodeInstallationTransferV3"]);
    expect(named(S1_PROVIDER)).toEqual(["parseBoundedJson"]);
    expect(tree.statements.filter(ts.isFunctionDeclaration).filter(node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)).map(node => node.name?.text)).toEqual(["evaluateInstallationTransferDomainsV3"]);
    expect(stripComments(source)).not.toMatch(/JSON\.stringify\s*\(/);
    expect(stripComments(source)).not.toMatch(/\b(fetch|window|document|navigator|localStorage|sessionStorage|indexedDB|createClient|setTimeout|setInterval)\b|process\.env|console\./);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("evaluateInstallationTransferDomainsV3")).sort()).toEqual([TRANSFER_SEMANTICS, TRANSFER_HISTORICAL].sort());
    expect(source).toContain('historicalStatus: "not_evaluated"');
  });
  it("confines historical catalog evaluation to the actual compiled registries and synchronous readers", () => {
    const source = readFileSync(TRANSFER_HISTORICAL, "utf8"), tree = syntaxTree(source);
    const importers = files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === TRANSFER_HISTORICAL));
    expect(importers).toEqual([TRANSFER_ADMISSION]);
    expect(moduleReferences(source)).toEqual(["./installationTransferV3", "./installationTransferSemantics", "./profileScopedSportingPersistence", "../supabase/providerCredentialContract", "../exercises/catalog", "../exercises/content", "../exercises/lookup", "../exercises/validation", "../exercises/restrictedAssetCatalog", "../cloudSporting/records", "../cloudSporting/types"]);
    const named = (end: string) => tree.statements.filter(ts.isImportDeclaration).filter(node => ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.endsWith(end)).map(node => node.importClause?.namedBindings).flatMap(node => node && ts.isNamedImports(node) ? node.elements.map(element => element.name.text) : []);
    expect(named("/records")).toEqual(["deserializeTrainingSession", "deserializeAssessmentRun"]);
    expect(named("/providerCredentialContract")).toEqual(["parseBoundedJson"]);
    expect(named("/installationTransferV3")).toEqual(["decodeInstallationTransferV3"]);
    expect(tree.statements.filter(ts.isFunctionDeclaration).filter(node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)).map(node => node.name?.text)).toEqual(["evaluateInstallationTransferHistoricalV3"]);
    expect(stripComments(source)).not.toMatch(/JSON\.stringify\s*\(/);
    expect(stripComments(source)).not.toMatch(/\b(fetch|window|document|navigator|localStorage|sessionStorage|indexedDB|createClient|setTimeout|setInterval)\b|process\.env|console\./);
  });
  it("keeps actual installation-source observation private and completion-only", () => {
    const source = readFileSync(COMMON_SOURCE, "utf8"), tree = syntaxTree(source);
    const declaration = tree.statements.filter(ts.isFunctionDeclaration).find(node => node.name?.text === "createInstallationTransferWebViewSource");
    expect(declaration?.parameters).toHaveLength(0);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createInstallationTransferWebViewSource")).sort()).toEqual([COMMON_SOURCE, TRANSFER_SOURCE_HELPER].sort());
    const named = (end: string) => tree.statements.filter(ts.isImportDeclaration).filter(node => ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.endsWith(end)).map(node => node.importClause?.namedBindings).flatMap(node => node && ts.isNamedImports(node) ? node.elements.map(element => element.name.text) : []);
    expect(named("/platformSha256")).toEqual(["drainObservedPlatformWork"]);
    expect(named("/installationTransferInventory")).toEqual(["planInstallationTransferInventoryV2", "expectedSlots", "TRANSFER_CONTROL_KEYS", "TRANSFER_LIMITS", "TRANSFER_LEGACY_KEY", "TRANSFER_PROFILE_PREFIX", "ReadPlan"]);
    const body = stripComments(declaration!.body!.getText(tree));
    expect(body).not.toMatch(/\.setItem\s*\(|\.removeItem\s*\(|\.clear\s*\(|encodeInstallationTransfer|decodeInstallationTransfer|owner_frozen|synthetic_frozen|\bfetch\s*\(|Date\.|Math\.random|setTimeout|setInterval/);
  });
  it("detects effects and a fourth token consumer without matching comments/unrelated names", () => {
    for (const source of ["fetch(url)", "client.auth.getSession()", "localStorage.getItem(key)", "new Date()", "Math.random()", "crypto.subtle.digest(data)", "process.env.NAME", "import.meta.env", "globalThis['fetch'](url)", "storePKCEVerifier(storage)", "authorizedRequest(input)"]) expect(s1Effects(source), source).not.toEqual([]);
    for (const source of ["// fetch(url); Date.now();", "/* client.auth.getSession() */", "const fetchLabel = 'Date';", "compute('credential-value/v1', key, raw); format(candidate);"]) expect(s1Effects(source), source).toEqual([]);
    expect(tokenMention("const fourth = session.access_token;")).toBe(true);
    expect(tokenMention("const fourth = session['access_token'];")).toBe(true);
    for (const file of [join(SRC_ROOT, "app/fourth.ts"), join(process.cwd(), "mobile/src/fourth.ts")]) expect(unauthorizedTokenMention(file, "const fourth = session.access_token;")).toBe(true);
    expect(unauthorizedTokenMention(S1_PROVIDER, "token(obj.access_token, 65536, 'session');")).toBe(false);
    expect(tokenMention("// access_token\n const access_token_label = 'unrelated';")).toBe(false);
  });
  it("detects binding consumers and unapproved binding dependencies across import forms", () => {
    const app = join(SRC_ROOT, "app/page.tsx");
    for (const name of ["credentialPhysicalSlots", "platformCredentialFingerprint"]) {
      const path = `@/lib/persistence/${name}`;
      for (const source of [`import '${path}'`, `export * from '${path}'`, `import('${path}')`, `require('${path}')`, `type T = import('${path}').T`]) expect(importsBinding(app, source)).toBe(true);
    }
    for (const file of INERT_BINDINGS) {
      for (const source of ["import '@supabase/supabase-js'", "export * from './secureCredentialStore'", "import('../supabase/authorizedFetch')", "require('./localStorageAdapter')", "import(variable)"]) expect(bindingDependencyViolations(file, source)).not.toEqual([]);
    }
    expect(bindingDependencyViolations(PHYSICAL_SLOTS, "import '../uuid'; import '../supabase/providerCredentialContract';")).toEqual([]);
    expect(bindingDependencyViolations(PLATFORM_FINGERPRINT, "import type { Fingerprint } from './credentialProtocol'; import '../supabase/providerCredentialContract';")).toEqual([]);
    expect(importsBinding(app, "// import './platformCredentialFingerprint'\nconst name = 'credentialPhysicalSlots';")).toBe(false);
  });
});

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
  it("the dormant native settlement factory has no application reference or composition", () => {
    const symbol = "createNativeCredentialSettlementStorage";
    const declaration = join(SRC_ROOT, "lib/supabase/supabaseClient.ts");
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes(symbol)).sort()).toEqual([declaration, NATIVE_AUTH_HOST].sort());
    expect(stripComments(readFileSync(declaration, "utf8"))).toContain(`export function ${symbol}(`);
  });

  it("keeps native AUTH ownership dormant and the SDK reservation inside its exact owner", () => {
    const declaration = join(SRC_ROOT, "lib/supabase/supabaseClient.ts");
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createNativeSupabaseAuthHost"))).toEqual([NATIVE_AUTH_HOST]);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("reserveNativeAuthSdk")).sort()).toEqual([declaration, NATIVE_AUTH_HOST].sort());
    const host = stripComments(readFileSync(NATIVE_AUTH_HOST, "utf8"));
    expect(host).toContain("skipAutoInitialize: true");
    expect(host).toContain("autoRefreshToken: false");
    expect(host).not.toMatch(/\bconsole\.|\brefreshSession\(|\bsetSession\(|\bstartAutoRefresh\(/);
  });

  it("confines the dormant native Identity host, its private bearer and public PostgREST import", () => {
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createNativeIdentityBootstrapHost"))).toEqual([NATIVE_AUTH_HOST]);
    const runtimeFile = join(SRC_ROOT, "lib/identity/identityRuntime.ts");
    const authReferences = (file: string, source: string) => moduleReferences(source).filter(name => name !== null && resolvedModule(file, name) === NATIVE_AUTH_HOST);
    expect(files.filter(file => authReferences(file, readFileSync(file, "utf8")).length > 0).sort()).toEqual([join(SRC_ROOT, "components/persistence/DormantNativeTrackerComposition.tsx"), runtimeFile, TRANSFER_APPLICATION, NEW_USER_APPLICATION].sort());
    const runtimeTree = syntaxTree(readFileSync(runtimeFile, "utf8"));
    const authImports = runtimeTree.statements.filter(ts.isImportDeclaration).filter(node => ts.isStringLiteral(node.moduleSpecifier) && resolvedModule(runtimeFile, node.moduleSpecifier.text) === NATIVE_AUTH_HOST);
    expect(authImports).toHaveLength(1);
    const binding = authImports[0].importClause?.namedBindings;
    expect(binding && ts.isNamedImports(binding) ? binding.elements.map(node => (node.propertyName ?? node.name).text) : null).toEqual(["createSupabaseAuthService"]);
    for (const source of ['import * as hidden from "../supabase/supabaseAuthService";', 'const hidden = import("../supabase/supabaseAuthService");', 'export * from "../supabase/supabaseAuthService";']) expect(authReferences(runtimeFile, source)).toHaveLength(1);
    const importsPostgrest = (source: string) => moduleReferences(source).some(name => name === "@supabase/postgrest-js" || name?.startsWith("@supabase/postgrest-js/") === true);
    expect(files.filter(file => importsPostgrest(readFileSync(file, "utf8")))).toEqual([NATIVE_AUTH_HOST]);
    for (const source of [
      'import { PostgrestClient as Alias } from "@supabase/postgrest-js";',
      'import type { PostgrestClient } from "@supabase/postgrest-js";',
      'export * from "@supabase/postgrest-js";',
      'const x = import("@supabase/postgrest-js");',
      'const x = require("@supabase/postgrest-js/dist/index");',
    ]) expect(importsPostgrest(source)).toBe(true);
    expect(importsPostgrest('// @supabase/postgrest-js')).toBe(false);
    function bearerLocations(source: string): string[][] {
      const locations: string[][] = [];
      const visit = (node: ts.Node, ancestors: string[]): void => {
        const path = ts.isFunctionDeclaration(node) ? [...ancestors, node.name?.text ?? "anonymous"] : ancestors;
        if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === "access_token") locations.push(path);
        ts.forEachChild(node, child => visit(child, path));
      };
      visit(syntaxTree(source), []); return locations;
    }
    expect(bearerLocations(readFileSync(NATIVE_AUTH_HOST, "utf8"))).toEqual([["createNativeHost", "restoreSelf"]]);
    expect(bearerLocations('const x = session.access_token;')).toEqual([[]]);
    expect(bearerLocations('function outside() { return session["access_token"]; }')).toEqual([["outside"]]);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("nativeOwnership")).sort()).toEqual([
      NATIVE_AUTH_HOST, join(SRC_ROOT, "lib/identity/identityTransitionCoordinator.ts"),
    ].sort());
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(manifest.dependencies["@supabase/postgrest-js"]).toBe("2.112.3");
  });

  it("confines the dormant sporting host and genuine admission to exact infrastructure owners", () => {
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createNativeSportingIdentityHost"))).toEqual([NATIVE_AUTH_HOST]);
    const coordinator = join(SRC_ROOT, "lib/identity/identityTransitionCoordinator.ts");
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("NativeProfileAdmission")).sort()).toEqual([NATIVE_AUTH_HOST, coordinator].sort());
    const sportingMapper = join(SRC_ROOT, "lib/supabase/supabaseSportingCloudService.ts");
    const references = (file: string, source: string) => moduleReferences(source).filter(name => name !== null && resolvedModule(file, name) === sportingMapper);
    expect(files.filter(file => references(file, readFileSync(file, "utf8")).length > 0).sort()).toEqual([NATIVE_AUTH_HOST, join(SRC_ROOT, "components/ProfileScopedSportingPersistence.tsx")].sort());
    for (const text of ['import * as hidden from "./supabaseSportingCloudService";', 'const hidden = import("./supabaseSportingCloudService");', 'export * from "./supabaseSportingCloudService";']) expect(references(NATIVE_AUTH_HOST, text)).toHaveLength(1);
  });

  it("confines native account control scopes and the RPC-only deletion mapper to exact owners", () => {
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    const coordinator = join(SRC_ROOT, "lib/identity/identityTransitionCoordinator.ts");
    for (const symbol of ["NativeAccountControl", "NativeAccountPending"]) {
      expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes(symbol)).sort()).toEqual([NATIVE_AUTH_HOST, coordinator].sort());
    }
    const mapper = join(SRC_ROOT, "lib/supabase/supabaseAccountDeletionService.ts");
    const references = (file: string, source: string) => moduleReferences(source).filter(name => name !== null && resolvedModule(file, name) === mapper);
    expect(files.filter(file => references(file, readFileSync(file, "utf8")).length > 0).sort()).toEqual([NATIVE_AUTH_HOST, join(SRC_ROOT, "lib/identity/identityRuntime.ts")].sort());
    for (const source of ['import * as hidden from "./supabaseAccountDeletionService";', 'const hidden = import("./supabaseAccountDeletionService");', 'export * from "./supabaseAccountDeletionService";']) expect(references(NATIVE_AUTH_HOST, source)).toHaveLength(1);
    const code = stripComments(readFileSync(mapper, "utf8"));
    expect(code).toContain("PromiseLike<{ data: unknown; error: unknown }>");
    expect(code).not.toContain("SupabaseClient");
  });

  it("confines native Team-exercise binding and its closed wire plan to the private host", () => {
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createTeamExerciseCloudService"))).toEqual([NATIVE_AUTH_HOST]);
    const mapper = join(SRC_ROOT, "lib/supabase/supabaseTeamExerciseCloudService.ts");
    const references = (file: string, source: string) => moduleReferences(source).filter(name => name !== null && resolvedModule(file, name) === mapper);
    expect(files.filter(file => references(file, readFileSync(file, "utf8")).length > 0).sort()).toEqual([NATIVE_AUTH_HOST, join(SRC_ROOT, "components/ProfileScopedSportingPersistence.tsx")].sort());
    for (const source of ['import * as hidden from "./supabaseTeamExerciseCloudService";', 'const hidden = import("./supabaseTeamExerciseCloudService");', 'export * from "./supabaseTeamExerciseCloudService";']) expect(references(NATIVE_AUTH_HOST, source)).toHaveLength(1);
    expect(stripComments(readFileSync(mapper, "utf8"))).toContain('Pick<SupabaseClient, "from" | "rpc">');
    const host = stripComments(readFileSync(NATIVE_AUTH_HOST, "utf8"));
    const plan = host.slice(host.indexOf("function captureTeam("), host.indexOf("function runTeam<"));
    expect([...plan.matchAll(/get\("(team_exercise_[a-z_]+)"/g)].map(match => match[1]).sort()).toEqual([
      "team_exercise_result_bundles", "team_exercise_sessions", "team_exercise_session_participants", "team_exercise_execution_refs", "team_exercise_result_refs", "team_exercise_private_notes", "team_exercise_result_revisions", "team_exercise_recording_permissions",
    ].sort());
    expect([...plan.matchAll(/rpc = "([a-z_]+)"/g)].map(match => match[1]).sort()).toEqual([
      "put_team_exercise_session", "put_team_exercise_result_bundle", "set_my_team_exercise_recording_permission", "approve_my_team_exercise_session", "set_my_team_exercise_private_note", "revise_my_team_exercise_result", "void_my_team_exercise_result",
    ].sort());
    expect(host).toContain("retry: false, fetch");
  });

  it("confines native Team foundation, dependent hooks and the shared pure route table", () => {
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createTeamService(profileId:"))).toEqual([NATIVE_AUTH_HOST]);
    const mapper = join(SRC_ROOT, "lib/supabase/supabaseTeamService.ts"), route = join(SRC_ROOT, "lib/supabase/teamApiRoutePath.ts");
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("TeamQueryHooks")).sort()).toEqual([NATIVE_AUTH_HOST, mapper].sort());
    const references = (file: string, source: string) => moduleReferences(source).filter(name => name !== null && resolvedModule(file, name) === route);
    expect(files.filter(file => references(file, readFileSync(file, "utf8")).length > 0).sort()).toEqual([NATIVE_AUTH_HOST, join(SRC_ROOT, "lib/supabase/authorizedFetch.ts")].sort());
    for (const source of ['import * as hidden from "./teamApiRoutePath";', 'const hidden = import("./teamApiRoutePath");', 'export * from "./teamApiRoutePath";']) expect(references(NATIVE_AUTH_HOST, source)).toHaveLength(1);
    const pure = stripComments(readFileSync(route, "utf8"));
    expect(pure).not.toMatch(/\b(fetch|window|document|process|getSession|access_token|SupabaseClient)\b/);
    expect(pure.match(/case "/g)).toHaveLength(5);
    expect(stripComments(readFileSync(mapper, "utf8"))).toContain('Pick<SupabaseClient, "from" | "rpc">');
    const host = stripComments(readFileSync(NATIVE_AUTH_HOST, "utf8"));
    const capture = host.slice(host.indexOf("function captureFoundation("), host.indexOf("function runFoundation<"));
    const rpcNames = [...capture.matchAll(/rpc = "([a-z_]+)"/g)].map(match => match[1]);
    expect([...new Set([...rpcNames, "get_team_member_emails"])].sort()).toEqual([
      "get_my_profile", "has_pilot_team_creation_capability", "create_team", "get_team_member_emails", "rename_team", "archive_team", "restore_team", "set_participation", "assign_direct_function", "remove_direct_function", "remove_admin_function", "relinquish_own_admin", "leave_team", "revoke_invitation", "preview_invitation", "accept_invitation", "list_admin_requests_for_team", "revoke_admin_request", "accept_admin_request", "acknowledge_notification",
    ].sort());
    const plan = host.slice(host.indexOf("function runFoundation<"), host.indexOf("function bindFoundationService("));
    expect([...new Set([...plan.matchAll(/getWire\("([a-z_]+)"/g)].map(match => match[1]))].sort()).toEqual(["teams", "team_memberships", "profiles", "team_invitations", "team_admin_requests", "account_notifications"].sort());
    expect(plan).toContain('purpose: "own_api"');
  });

  it("confines the dormant typed native local sporting scope and frozen inventory", () => {
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    const helper = join(SRC_ROOT, "lib/persistence/nativeLocalSportingScope.ts"), inventory = join(SRC_ROOT, "lib/persistence/profileScopedSportingPersistence.ts");
    const references = (file: string, source: string) => moduleReferences(source).filter(name => name !== null && resolvedModule(file, name) === helper);
    expect(files.filter(file => references(file, readFileSync(file, "utf8")).length > 0).sort()).toEqual([NATIVE_AUTH_HOST, join(SRC_ROOT, "lib/persistence/nativeSportingApplicationScope.ts"), join(SRC_ROOT, "lib/persistence/nativeTrackerOwner.ts")].sort());
    for (const source of ['import * as hidden from "./nativeLocalSportingScope";', 'const hidden = import("./nativeLocalSportingScope");', 'export * from "./nativeLocalSportingScope";']) expect(references(helper, source)).toHaveLength(1);
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("PROFILE_SCOPED_SPORTING_STORAGE_KEYS")).sort()).toEqual([inventory, helper, TRANSFER_SEMANTICS, TRANSFER_HISTORICAL].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createLocalSportingScope(profileId:"))).toEqual([NATIVE_AUTH_HOST]);
    const code = stripComments(readFileSync(helper, "utf8"));
    expect(code).not.toMatch(/@supabase|localStorage|sessionStorage|\bfetch\b|\bwindow\b|\bdocument\b/);
    expect(code).toContain("profileScopedSportingStorageKey(profileId, key)");
    expect(code).toContain("register(work)");
    expect(stripComments(readFileSync(inventory, "utf8"))).toContain("export const PROFILE_SCOPED_SPORTING_STORAGE_KEYS = Object.freeze([");
  });

  it("confines the dormant native manager and shared data-only capture", () => {
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    const application = join(SRC_ROOT, "lib/persistence/nativeSportingApplicationScope.ts");
    const capture = join(SRC_ROOT, "lib/persistence/nativeSportingDataCapture.ts");
    const importers = (target: string) => files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === target)).sort();
    expect(importers(application)).toEqual([NATIVE_AUTH_HOST, join(SRC_ROOT, "lib/persistence/nativeTrackerOwner.ts"), join(SRC_ROOT, "lib/persistence/nativeTrackerTypes.ts")].sort());
    expect(importers(capture)).toEqual([application, join(SRC_ROOT, "lib/persistence/nativeLocalSportingScope.ts"), join(SRC_ROOT, "lib/persistence/nativeTrackerOwner.ts"), NATIVE_CONFIGURATION].sort());
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("createSportingApplicationScope(profileId:"))).toEqual([NATIVE_AUTH_HOST]);
    const code = stripComments(readFileSync(application, "utf8"));
    expect(code).not.toMatch(/@supabase|localStorage|sessionStorage|\bfetch\b|\bwindow\b|\bdocument\b/);
    expect(code).toContain("new SportingCloudSyncManager(");
    expect(code).toContain("manager.decorateRepositories()");
    expect(code).toContain("owner.register(work)");
    expect(stripComments(readFileSync(capture, "utf8"))).not.toMatch(/\bfetch\b|StorageAdapter|SportingCloudSyncManager|\bimport\b/);
  });

  it("confines genuine native Tracker registration, binding and shared erased context", () => {
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    const registry = join(SRC_ROOT, "lib/persistence/nativeTrackerRegistry.ts"), owner = join(SRC_ROOT, "lib/persistence/nativeTrackerOwner.ts"), root = join(SRC_ROOT, "components/persistence/DormantNativeTrackerComposition.tsx"), context = join(SRC_ROOT, "components/persistence/nativeTrackerContext.tsx");
    const importers = (target: string) => files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === target)).sort();
    expect(importers(registry)).toEqual([root, NATIVE_AUTH_HOST].sort());
    expect(importers(owner)).toEqual([NATIVE_AUTH_HOST]);
    expect(importers(root)).toEqual([TRANSFER_FLOW, join(process.cwd(), "mobile/src/storage/NewUserBetaRoot.tsx")].sort());
    expect(importers(TRANSFER_FLOW)).toEqual([]);
    expect(importers(context)).toEqual([join(SRC_ROOT, "components/TrackerApp.tsx"), join(SRC_ROOT, "components/ProfileScopedSportingPersistence.tsx"), join(SRC_ROOT, "components/identity/IdentityAccountControl.tsx"), join(SRC_ROOT, "components/identity/IdentityPendingTeamIntent.tsx"), join(SRC_ROOT, "components/TeamsScreen.tsx"), join(SRC_ROOT, "components/TeamInvitationAcceptOverlay.tsx"), root].sort());
    const contextTree = syntaxTree(readFileSync(context, "utf8"));
    const values = contextTree.statements.filter(ts.isImportDeclaration).filter(node => !node.importClause?.isTypeOnly).map(node => ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null);
    expect(values).toEqual(["react"]);
    expect(stripComments(readFileSync(owner, "utf8"))).not.toMatch(/@supabase|localStorage|sessionStorage|\bfetch\b|\bwindow\b|\bdocument\b|setTimeout|setInterval/);
    expect(stripComments(readFileSync(registry, "utf8"))).toContain("new WeakMap");
    const host = stripComments(readFileSync(NATIVE_AUTH_HOST, "utf8"));
    expect(host).toContain("registerNativeTrackerRuntime(finalRuntime, bindTracker, listener => subscribe(invalidationListeners, listener), observePublishedPendingIntent,");
    for (const name of ["NativePendingIntentReplay", "ownPendingIntentReplay", "pendingIntentChanged"]) {
      expect(files.filter(file => new RegExp(`\\b${name}\\b`).test(stripComments(readFileSync(file, "utf8")))).sort()).toEqual([join(SRC_ROOT, "lib/identity/identityTransitionCoordinator.ts"), NATIVE_AUTH_HOST].sort());
    }
    expect(host).toContain("intentReplayReceipts.get(value)");
    expect(host).toContain("replay.discard().then(");
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes("onNativeControlProfile")).sort()).toEqual([join(SRC_ROOT, "lib/supabase/supabaseAccountDeletionService.ts"), NATIVE_AUTH_HOST].sort());
  });

  it("confines the above-Provider native App context to React and erased composition contracts", () => {
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    const context = join(SRC_ROOT, "components/persistence/nativeApplicationContext.tsx"), types = join(SRC_ROOT, "lib/persistence/nativeApplicationTypes.ts");
    const importers = (target: string) => files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === target)).sort();
    expect(importers(context)).toEqual(["components/persistence/DormantNativeTrackerComposition.tsx", "components/identity/IdentityProvider.tsx", "components/identity/IdentityPendingTeamIntent.tsx", "components/TeamsScreen.tsx", "components/TeamInvitationAcceptOverlay.tsx"].map(path => join(SRC_ROOT, path)).sort());
    expect(importers(types)).toEqual([context, join(SRC_ROOT, "lib/persistence/nativeTrackerRegistry.ts"), NATIVE_TEAM_LINK_SOURCE].sort());
    const values = syntaxTree(readFileSync(context, "utf8")).statements.filter(ts.isImportDeclaration).filter(node => !node.importClause?.isTypeOnly).map(node => ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null);
    expect(values).toEqual(["react"]);
    expect(syntaxTree(readFileSync(types, "utf8")).statements.every(node => ts.isTypeAliasDeclaration(node) || (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly))).toBe(true);
  });

  it("confines native Team URL intake and boxed source values to the dormant genuine host", () => {
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    const importers = files.filter(file => moduleReferences(readFileSync(file, "utf8")).some(name => name !== null && resolvedModule(file, name) === NATIVE_TEAM_LINK_SOURCE));
    expect(importers).toEqual([NATIVE_AUTH_HOST]);
    const valueConsumers = files.filter(file => stripComments(readFileSync(file, "utf8")).includes("observePlatformWork"));
    expect(valueConsumers.sort()).toEqual([PLATFORM_SHA256, NATIVE_TEAM_LINK_SOURCE, TRANSFER_PROTECTION, TRANSFER_QUARANTINE_WORK, CREDENTIAL_PORT].sort());
    const source = stripComments(readFileSync(NATIVE_TEAM_LINK_SOURCE, "utf8"));
    expect(source).not.toMatch(/\bfetch\b|localStorage|sessionStorage|AuthClient|createIdentityTransitionCoordinator|createPendingIntentRepository|removeAllListeners|process\.env|\bwindow\b|\bdocument\b|setTimeout|setInterval/);
    expect([...moduleReferences(source)].sort()).toEqual(["../identity/pendingIntentRepository", "../persistence/nativeApplicationTypes", "../persistence/platformSha256", "./supabaseCallbackClassifier", "@capacitor/core", "@capacitor/app"].sort());
    for (const name of ["createNativeTeamLinkDelivery", "isCanonicalNativeTeamLinkOrigin"]) {
      expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes(name)).sort()).toEqual([NATIVE_AUTH_HOST, NATIVE_TEAM_LINK_SOURCE].sort());
    }
  });

  it("the private SQL inventory factory has no application reference or composition", () => {
    const symbol = "createNativeCredentialSqliteInventory";
    const declaration = join(SRC_ROOT, "lib/persistence/nativeSqliteAdapter.ts");
    const files = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(join(process.cwd(), "mobile/src"))].filter(file => !isTestPath(file));
    expect(files.filter(file => stripComments(readFileSync(file, "utf8")).includes(symbol))).toEqual([declaration]);
    expect(stripComments(readFileSync(declaration, "utf8")).split(`export function ${symbol}(`)).toHaveLength(2);
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

  it("keeps Web/Team token access and the exact dormant native Self-RPC exception", () => {
    const CLASSIFIER_FILE = join(SRC_ROOT, "lib", "supabase", "supabaseCallbackClassifier.ts");
    const productionFiles = collectSourceFiles(SRC_ROOT).filter((path) => !isTestPath(path));
    const mentions = productionFiles.filter((path) =>
      /\baccess_token\b/.test(stripComments(readFileSync(path, "utf8")))
    );
    // Exact structural exception, not SDK authority: S1 checks supplied owned
    // JSON and is guarded above against effects/dependencies/outside importers.
    // Only the helper reads a LIVE session; the classifier strips a quoted name.
    expect(mentions.map((path) => relative(SRC_ROOT, path)).sort()).toEqual(
      [relative(SRC_ROOT, HELPER_FILE), relative(SRC_ROOT, CLASSIFIER_FILE), relative(SRC_ROOT, S1_PROVIDER), relative(SRC_ROOT, NATIVE_AUTH_HOST)].sort()
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

  it("keeps the identity runtime behind the Provider and exact dormant native composition", () => {
    const importers = productionFiles()
      .filter((path) => path !== RUNTIME_FILE)
      .filter((path) => importsFrom(readFileSync(path, "utf8"), "identityRuntime"));
    expect(importers.map((path) => relative(SRC_ROOT, path))).toEqual([
      join("components", "identity", "IdentityProvider.tsx"),
      join("lib", "supabase", "supabaseAuthService.ts"),
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

  // Stage M3b4b's dormant migration modules. The bindings module reaches the
  // adapter through ONE dynamic import (to construct the migration target); the
  // evidence collector and the runner name only its TYPES, which erase.
  const MIGRATION_BINDINGS_FILE = join(SRC_ROOT, "lib", "persistence", "nativeMigrationBindings.ts");
  const MIGRATION_TYPE_ONLY_FILES = ["nativeMigrationEvidence.ts", "nativeMigrationRunner.ts", "nativeMigrationBorrowEvidence.ts"].map((name) =>
    join(SRC_ROOT, "lib", "persistence", name)
  );

  /** Every non-comment import of the adapter or its binding in a source file. */
  function adapterImports(source: string): string[] {
    const code = stripComments(source);
    return [...code.matchAll(/(?:\bimport\s+type\b[^;]*?\bfrom|\bimport\s*\(|\bfrom|\bimport)\s*["'][^"']*(?:nativeSqliteAdapter|capacitorSqliteEngine)["']/g)]
      .map((match) => match[0]);
  }

  it("exactly one production module composes the native adapter, and only it", () => {
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((path) => !isTestPath(path))
      // The two halves of the adapter/binding pair reference each other — the
      // adapter lazily imports the binding, the binding imports the adapter's
      // types. That is the module boundary itself, not a composition.
      .filter((path) => path !== ADAPTER_FILE && path !== ALLOWED_SQLITE_FILE)
      .filter((path) => path !== COMPOSITION_FILE)
      // The dormant migration modules, checked precisely in the next test.
      .filter((path) => path !== MIGRATION_BINDINGS_FILE && path !== PUBLISHED_OWNER && path !== COMMON_OWNER && path !== TRANSFER_QUARANTINE && path !== TRANSFER_QUARANTINE_SQL && path !== TRANSFER_PREPARATION && path !== TRANSFER_PAIRING && !MIGRATION_TYPE_ONLY_FILES.includes(path))
      .filter((path) => importsAny(readFileSync(path, "utf8"), NATIVE_ADAPTER_MODULES));
    expect(offenders.map((path) => relative(SRC_ROOT, path))).toEqual([]);
    // Targeted, not vacuous: the composition module really does reach it.
    expect(importsAny(readFileSync(COMPOSITION_FILE, "utf8"), NATIVE_ADAPTER_MODULES)).toBe(true);
  });

  it("the migration modules reach the adapter exactly as specified: one dynamic import, otherwise types only", () => {
    expect(adapterImports('import type { X } from "./nativeSqliteAdapter";')).toHaveLength(1);
    expect(adapterImports('// import { X } from "./nativeSqliteAdapter";')).toHaveLength(0);
    const bindings = adapterImports(readFileSync(MIGRATION_BINDINGS_FILE, "utf8"));
    expect(bindings.filter((text) => /^import\s*\(/.test(text))).toHaveLength(1);
    expect(bindings.filter((text) => !/^import\s*\(/.test(text)).every((text) => /^import\s+type\b/.test(text))).toBe(true);
    expect(stripComments(readFileSync(MIGRATION_BINDINGS_FILE, "utf8"))).not.toContain("capacitorSqliteEngine");
    const common = adapterImports(readFileSync(COMMON_OWNER, "utf8"));
    expect(common.filter(text => /^import\s*\(/.test(text))).toHaveLength(1);
    expect(common.filter(text => !/^import\s*\(/.test(text)).every(text => /^import\s+type\b/.test(text))).toBe(true);
    for (const file of [...MIGRATION_TYPE_ONLY_FILES, PUBLISHED_OWNER]) {
      const found = adapterImports(readFileSync(file, "utf8"));
      expect(found.length, file).toBeGreaterThan(0);
      expect(found.every((text) => /^import\s+type\b/.test(text)), file).toBe(true);
    }
  });

  it("no production module STATICALLY imports the native adapter or the secure store's binding", () => {
    // This is what keeps SQLite and the Keychain plugin out of every bundle that
    // does not compose a native store — the Web build, the Next build, and a
    // DEFAULT mobile build. `mobile/__tests__/bundle.test.ts` asserts the same
    // property against the real artifact.
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((path) => !isTestPath(path))
      .filter((path) => path !== ALLOWED_SQLITE_FILE && path !== ALLOWED_SECURE_STORAGE_FILE && path !== TRANSFER_QUARANTINE_SQL)
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

describe("Stage M3b4a/M3b4b — the decision core stays pure; the dormant executor has no application caller", () => {
  // docs/MOBILE_APP_MIGRATION.md Stage M3b0 §5 and §7. M3b4a is the pure
  // decision core: it reaches no storage, plugin, network, timer, randomness or
  // runtime composition. M3b4b adds a dormant executor over it. ONLY the three
  // identified M3b4b modules may import the core, and NO other shipped module —
  // no startup path, composition, component or repository — may import those
  // M3b4b modules, except the two named Stage M3b4c modules, which may reference
  // them through `import type` only (asserted in the Stage M3b4c block below).
  // The production activation authority stays `unavailable`.
  const DECISION_MODULES = [
    "nativeMigrationDecision",
    "nativeMigrationEligibility",
    "nativeMigrationRecord",
    "nativeMigrationPlanOutcome",
  ];
  const PERSISTENCE_DIR = join(SRC_ROOT, "lib", "persistence");
  const MOBILE_SRC = join(process.cwd(), "mobile", "src");
  const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

  function importSpecifiers(source: string): string[] {
    return [...stripComments(source).matchAll(SPECIFIER)].map((match) => match[1]);
  }

  function referencesDecisionLayer(source: string): boolean {
    return importSpecifiers(source).some((specifier) =>
      DECISION_MODULES.some((name) => specifier.endsWith(`/${name}`) || specifier === name));
  }

  /** The M3b4b implementation modules: the only permitted importers of the core. */
  const EXECUTOR_MODULES = ["nativeMigrationBindings", "nativeMigrationEvidence", "nativeMigrationRunner"];

  /**
   * Stage M3b4c's presentation model and session controller. They reference the
   * core and the executor through `import type` ONLY (erased), construct
   * nothing, and are themselves imported by no shipped module — checked in the
   * Stage M3b4c block below. Named exactly; no directory exemption.
   */
  const PRESENTATION_MODULES = ["nativeMigrationPresentation", "nativeMigrationSession"];
  const presentationFiles = new Set(PRESENTATION_MODULES.map((name) => join(PERSISTENCE_DIR, `${name}.ts`)));

  function referencesExecutor(source: string): boolean {
    return importSpecifiers(source).some((specifier) =>
      EXECUTOR_MODULES.some((name) => specifier.endsWith(`/${name}`) || specifier === name));
  }

  it("the import detector is non-vacuous", () => {
    expect(referencesDecisionLayer('import { decideNativeMigration } from "../persistence/nativeMigrationDecision";')).toBe(true);
    expect(referencesDecisionLayer('const m = await import("./nativeMigrationRecord");')).toBe(true);
    expect(referencesDecisionLayer('export * from "./nativeMigrationEligibility";')).toBe(true);
    expect(referencesDecisionLayer('// import "./nativeMigrationDecision";')).toBe(false);
    expect(referencesDecisionLayer('import { x } from "./nativeMigrationDecisionHelpers";')).toBe(false);
  });

  it("only the identified M3b4b modules import the decision core", () => {
    const decisionFiles = new Set(DECISION_MODULES.map((name) => join(PERSISTENCE_DIR, `${name}.ts`)));
    const executorFiles = new Set(EXECUTOR_MODULES.map((name) => join(PERSISTENCE_DIR, `${name}.ts`)));
    const shipped = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(MOBILE_SRC)].filter(
      (path) => !isTestPath(path) && !decisionFiles.has(path)
    );
    expect(shipped.length).toBeGreaterThan(50);
    const importers = shipped.filter((path) => referencesDecisionLayer(readFileSync(path, "utf8")));
    expect(
      importers
        .filter((path) => !executorFiles.has(path) && !presentationFiles.has(path) && ![join(PERSISTENCE_DIR, "nativeMigrationBorrowEvidence.ts"), COMMON_OWNER, COMMON_ADAPTER, COMMON_SOURCE, TRANSFER_QUARANTINE_SQL].includes(path))
        .map((path) => relative(process.cwd(), path))
    ).toEqual([]);
    // Targeted, not vacuous: each identified module really is an importer.
    expect([...executorFiles].every((path) => importers.includes(path))).toBe(true);
  });

  it("no shipped module outside the M3b4b modules imports them — no startup path invokes the executor", () => {
    expect(referencesExecutor('const r = await import("../lib/persistence/nativeMigrationRunner");')).toBe(true);
    expect(referencesExecutor('import { x } from "./nativeMigrationRunnerHelpers";')).toBe(false);
    const executorFiles = new Set(EXECUTOR_MODULES.map((name) => join(PERSISTENCE_DIR, `${name}.ts`)));
    const offenders = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(MOBILE_SRC)]
      .filter((path) => !isTestPath(path) && !executorFiles.has(path) && !presentationFiles.has(path) && path !== COMMON_OWNER)
      .filter((path) => referencesExecutor(readFileSync(path, "utf8")));
    expect(offenders.map((path) => relative(process.cwd(), path))).toEqual([]);
    // And the migration capabilities are constructed nowhere else.
    for (const factory of ["createLocalStorageMigrationSource", "createNativeMigrationSqliteStore"]) {
      const users = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(MOBILE_SRC)]
        .filter((path) => !isTestPath(path) && stripComments(readFileSync(path, "utf8")).includes(factory))
        .map((path) => relative(PERSISTENCE_DIR, path))
        .sort();
      const declaring = factory === "createLocalStorageMigrationSource" ? "localStorageAdapter.ts" : "nativeSqliteAdapter.ts";
      expect(users, factory).toEqual([declaring, "nativeMigrationBindings.ts"].sort());
    }
  });

  it("database ownership has no reset, force-unlock or fault-clearing entry point, and the marker has no unconditional write", () => {
    const exported = /\bexport\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g;
    const offenders: string[] = [];
    for (const file of ["nativeSqliteAdapter", "localStorageAdapter", ...EXECUTOR_MODULES]) {
      const code = stripComments(readFileSync(join(PERSISTENCE_DIR, `${file}.ts`), "utf8"));
      for (const match of code.matchAll(exported)) {
        if (/reset|unlock|forcerelease|clearfault|clearlatch|clearownership/i.test(match[1])) offenders.push(`${file}: ${match[1]}`);
      }
      if (/\bexport\b[^;\n]*\bDATABASE_OWNERSHIP\b/.test(code)) offenders.push(`${file}: exports the ownership registry`);
    }
    expect(offenders).toEqual([]);
    // Non-vacuous: the detector finds such an export when one exists.
    expect([..."export function resetOwnershipForTests() {}".matchAll(exported)].map((m) => m[1])).toEqual(["resetOwnershipForTests"]);
    // The only marker write is the check-and-write; no unconditional variant remains.
    const source = stripComments(readFileSync(join(PERSISTENCE_DIR, "localStorageAdapter.ts"), "utf8"));
    expect(source).toContain("writeMarkerIfAbsent");
    expect(source).not.toMatch(/\bwriteMarker\s*\(/);
  });

  it("no repository-facing contract or repository gains enumeration, transactions or reserved metadata", () => {
    const types = stripComments(readFileSync(join(PERSISTENCE_DIR, "types.ts"), "utf8"));
    for (const member of ["listKeys", "Enumerable", "transact", "acquire", "Migration", "readReserved"]) {
      expect(types).not.toContain(member);
    }
    const repositories = collectSourceFiles(join(SRC_ROOT, "lib"))
      .filter((path) => !isTestPath(path) && /Repository\.ts$|repository\.ts$/i.test(path));
    expect(repositories.length).toBeGreaterThan(5);
    for (const path of repositories) {
      const code = stripComments(readFileSync(path, "utf8"));
      for (const forbidden of ["listKeys", "MigrationSource", "NativeMigration", "nativeMigration", "curling.nativeMigration."]) {
        expect(code.includes(forbidden), `${relative(SRC_ROOT, path)} → ${forbidden}`).toBe(false);
      }
    }
  });

  it("the executor modules reach no timer, network, environment or global storage; only the bindings touch the platform UUID and clock", () => {
    const forbidden = [
      /\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\bwindow\b/, /\bdocument\b/,
      /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /@capacitor/, /supabase/i,
      /\bsetTimeout\b/, /\bsetInterval\b/, /\bMath\.random\b/, /\bprocess\.env\b/, /\bconsole\./,
    ];
    for (const name of EXECUTOR_MODULES) {
      const code = stripComments(readFileSync(join(PERSISTENCE_DIR, `${name}.ts`), "utf8"));
      for (const pattern of forbidden) expect(pattern.test(code), `${name}: ${pattern}`).toBe(false);
      if (name !== "nativeMigrationBindings") {
        for (const pattern of [/\bcrypto\b/, /\bnew Date\b/, /\bDate\.now\b/]) expect(pattern.test(code), `${name}: ${pattern}`).toBe(false);
      }
    }
  });

  it("the decision modules import only the UUID predicate, five pure identity key modules and each other", () => {
    const identityModules = ["identityBarrier", "identityBarrierResolution", "interactiveAttempt", "trustedDevice", "accountDeletionGuard"];
    const allowed = new Set([
      "../uuid",
      ...identityModules.map((name) => `../identity/${name}`),
      ...DECISION_MODULES.map((name) => `./${name}`),
    ]);
    for (const name of DECISION_MODULES) {
      const source = readFileSync(join(PERSISTENCE_DIR, `${name}.ts`), "utf8");
      const specifiers = importSpecifiers(source);
      expect(specifiers.filter((specifier) => !allowed.has(specifier)), name).toEqual([]);
    }
    // Transitive purity: those identity modules reach only validation helpers, never an adapter.
    const identityDir = join(SRC_ROOT, "lib", "identity");
    const transitiveAllowed = new Set(["./untrustedValue", "./interactiveAttempt", "../persistence/types", "../uuid", "./errors"]);
    for (const name of [...identityModules, "untrustedValue", "errors"]) {
      const specifiers = importSpecifiers(readFileSync(join(identityDir, `${name}.ts`), "utf8"));
      expect(specifiers.filter((specifier) => !transitiveAllowed.has(specifier)), name).toEqual([]);
    }
  });

  it("the decision modules reference no storage, plugin, network, timer, randomness or environment", () => {
    const forbidden = [
      /\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\bwindow\b/, /\bdocument\b/,
      /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /Capacitor/, /@capacitor/, /supabase/i,
      /\bsetTimeout\b/, /\bsetInterval\b/, /\bDate\.now\b/, /\bnew Date\b/, /\bMath\.random\b/,
      /\bcrypto\b/, /\bprocess\.env\b/, /\bconsole\./,
    ];
    for (const name of DECISION_MODULES) {
      const code = stripComments(readFileSync(join(PERSISTENCE_DIR, `${name}.ts`), "utf8"));
      for (const pattern of forbidden) expect(pattern.test(code), `${name}: ${pattern}`).toBe(false);
    }
  });

  it("the production activation authority still reports `unavailable` unconditionally", () => {
    const composition = readFileSync(join(MOBILE_SRC, "storage", "nativeStorageComposition.ts"), "utf8");
    expect(composition).toContain('return { status: "unavailable", reason: "migration_not_implemented" };');
    expect(referencesDecisionLayer(composition)).toBe(false);
  });
});

describe("Stage M3b4c — the recovery interface is dormant and reaches the executor through types only", () => {
  // docs/MOBILE_APP_MIGRATION.md Stage M3b0 §6 and §7 ("M3b4c implementation
  // status"). The presentation model and session controller reference the
  // decision core and the executor through `import type` only; the session is
  // handed an already-constructed runner. No shipped module imports any M3b4c
  // module, so no startup path constructs, runs or renders migration, and the
  // production activation authority stays `unavailable`.
  const PERSISTENCE_DIR = join(SRC_ROOT, "lib", "persistence");
  const COMPONENTS_DIR = join(SRC_ROOT, "components", "persistence");
  const MOBILE_SRC = join(process.cwd(), "mobile", "src");
  const PRESENTATION = ["nativeMigrationPresentation", "nativeMigrationSession"].map((name) => join(PERSISTENCE_DIR, `${name}.ts`));
  const UI = ["NativeMigrationRecoveryView.tsx", "NativeMigrationRecoverySurface.tsx", "migrationRecoveryCopy.ts"].map((name) => join(COMPONENTS_DIR, name));
  const M3B4C = [...PRESENTATION, ...UI];
  const MIGRATION_SPECIFIER = /nativeMigration(Decision|Eligibility|Record|PlanOutcome|Bindings|Evidence|Runner)["']/;

  it("the named modules exist (non-vacuous)", () => {
    for (const file of M3B4C) expect(readFileSync(file, "utf8").length, file).toBeGreaterThan(200);
  });

  it("the presentation model and session reference the core and executor through `import type` only", () => {
    for (const file of PRESENTATION) {
      const code = stripComments(readFileSync(file, "utf8"));
      const statements = code.split(";").filter((statement) => MIGRATION_SPECIFIER.test(statement));
      expect(statements.length, file).toBeGreaterThan(0);
      for (const statement of statements) expect(statement.trim(), file).toMatch(/^import\s+type\b/);
      expect(code, file).not.toMatch(/nativeMigrationBindings|createNativeMigrationRunner|createNativeMigration(Source|Target)|decideNativeMigration|collectNativeMigrationEvidence/);
    }
  });

  it("they reach no storage, plugin, network, environment, logging or identity", () => {
    const forbidden = [
      /\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /@capacitor/, /supabase/i, /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bsendBeacon\b/, /\bprocess\.env\b/, /\bconsole\./,
      /nativeSqliteAdapter|capacitorSqliteEngine|secureCredentialStore|storageComposition"/, /\/identity\//,
    ];
    for (const file of M3B4C) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const pattern of forbidden) expect(pattern.test(code), `${relative(SRC_ROOT, file)}: ${pattern}`).toBe(false);
    }
  });

  it("no shipped module outside M3b4c imports an M3b4c module — nothing renders or runs it at startup", () => {
    const names = ["nativeMigrationPresentation", "nativeMigrationSession", "NativeMigrationRecoveryView", "NativeMigrationRecoverySurface", "migrationRecoveryCopy"];
    const pattern = new RegExp(`["'][^"']*/(${names.join("|")})["']`);
    expect(pattern.test('import X from "../components/persistence/NativeMigrationRecoveryView";')).toBe(true);
    expect(pattern.test('import X from "./NativeMigrationRecoveryViewHelpers";')).toBe(false);
    const own = new Set(M3B4C);
    const offenders = [...collectSourceFiles(SRC_ROOT), ...collectSourceFiles(MOBILE_SRC)]
      .filter((path) => !isTestPath(path) && !own.has(path))
      .filter((path) => pattern.test(stripComments(readFileSync(path, "utf8"))))
      .map((path) => relative(process.cwd(), path));
    expect(offenders).toEqual([]);
  });

  it("the production authority still reports unavailable, and no M3b4c module can produce a verdict", () => {
    const composition = readFileSync(join(MOBILE_SRC, "storage", "nativeStorageComposition.ts"), "utf8");
    expect(stripComments(composition)).toContain('return { status: "unavailable", reason: "migration_not_implemented" };');
    for (const file of M3B4C) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, file).not.toMatch(/NativeActivationVerdict|NativeActivationAuthority|nativeActivationReadyForTests|status:\s*"ready"/);
    }
  });
});
