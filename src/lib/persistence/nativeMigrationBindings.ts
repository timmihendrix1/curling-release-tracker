// Native-migration bindings — Stage M3b4b.
//
// Binds the approved M3b4a rules to the real stores, and nothing else:
//
//   - the SOURCE: `localStorageAdapter`'s migration-only capability, given the
//     approved eligibility test (only eligible values may be read) and the
//     reserved source marker key (the only key it may write);
//   - the TARGET: the native SQLite store's migration-only capability over a
//     named database, given the two reserved target keys. Loaded through a
//     DYNAMIC import, so no bundle that never constructs a migration target
//     ships SQLite through this module;
//   - platform-backed UUIDs and timestamps that FAIL rather than fabricate:
//     there is no `Math.random` and no constant fallback anywhere here.
//
// Constructing any of these performs no storage I/O. Nothing in an application
// startup path calls this module (`__tests__/architectureBoundary.test.ts`);
// the production activation authority still reports `unavailable`.
//
// The fingerprint (I-7) is deliberately NOT bound here. Its algorithm and its
// availability inside the WebView are open prerequisites
// (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §7), so a caller must inject one —
// there is no default, weak or synthetic fallback.
import { createLocalStorageMigrationSource, type MigrationSourceStore } from "./localStorageAdapter";
import type { NativeSqliteEngine, NativeSqliteMigrationTarget, NativeSqliteStore } from "./nativeSqliteAdapter";
import {
  isEligibleMigrationKey,
  NATIVE_MIGRATION_ACTIVATION_RECORD_KEY,
  NATIVE_MIGRATION_FAULT_LATCH_KEY,
  NATIVE_MIGRATION_SOURCE_MARKER_KEY,
} from "./nativeMigrationEligibility";
import type { RuntimePlatform } from "../platform/runtimePlatform";
import { isCanonicalUuid } from "../uuid";

/** The WebView source, admitting reads of eligible values only (§1) and writes of the marker only (I-3). */
export function createNativeMigrationSource(): MigrationSourceStore {
  return createLocalStorageMigrationSource({
    markerKey: NATIVE_MIGRATION_SOURCE_MARKER_KEY,
    mayReadValue: (key) => isEligibleMigrationKey(key),
  });
}

export interface NativeMigrationTargetOptions {
  /** The database to migrate into. Stated by the caller; there is no default. */
  readonly databaseName: string;
  /** Test seams, as on the native store itself. */
  readonly engine?: NativeSqliteEngine;
  readonly detectPlatform?: () => RuntimePlatform;
}

export interface NativeMigrationTargetBinding {
  readonly store: NativeSqliteStore;
  readonly target: NativeSqliteMigrationTarget;
}

/** The native target, with the reserved record and latch locations (I-2, I-13). Opens nothing. */
export async function createNativeMigrationTarget(options: NativeMigrationTargetOptions): Promise<NativeMigrationTargetBinding> {
  const adapterModule = await import("./nativeSqliteAdapter");
  return adapterModule.createNativeMigrationSqliteStore({
    databaseName: options.databaseName,
    ...(options.engine ? { engine: options.engine } : {}),
    ...(options.detectPlatform ? { detectPlatform: options.detectPlatform } : {}),
    reservedKeys: { record: NATIVE_MIGRATION_ACTIVATION_RECORD_KEY, latch: NATIVE_MIGRATION_FAULT_LATCH_KEY },
  });
}

/** Raised when the platform cannot supply a value. The executor reports it as a preparation failure. */
export class NativeMigrationPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeMigrationPreparationError";
  }
}

/**
 * A canonical UUID from the platform's cryptographic generator. Throws when the
 * generator is missing or answers with anything else — it never falls back to a
 * weaker source, because a valid-looking id from one would be fabricated metadata.
 */
export function platformUuid(): string {
  let value: unknown;
  try {
    const generator = (globalThis as { crypto?: { randomUUID?: () => unknown } }).crypto?.randomUUID;
    if (typeof generator !== "function") throw new NativeMigrationPreparationError("No platform UUID generator.");
    value = generator.call((globalThis as { crypto?: unknown }).crypto);
  } catch {
    throw new NativeMigrationPreparationError("The platform UUID generator failed.");
  }
  if (typeof value !== "string" || !isCanonicalUuid(value)) {
    throw new NativeMigrationPreparationError("The platform UUID generator returned an invalid value.");
  }
  return value;
}

const STRICT_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The platform clock as a strict UTC ISO-8601 timestamp. Throws rather than inventing one. */
export function platformTimestamp(): string {
  let value: unknown;
  try {
    value = new Date().toISOString();
  } catch {
    throw new NativeMigrationPreparationError("The platform clock failed.");
  }
  if (typeof value !== "string" || !STRICT_UTC_TIMESTAMP.test(value)) {
    throw new NativeMigrationPreparationError("The platform clock returned an invalid timestamp.");
  }
  return value;
}
