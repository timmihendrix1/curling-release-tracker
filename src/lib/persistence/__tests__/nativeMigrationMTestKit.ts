// Class-M harness for Stage M3b4b.
//
// EVIDENCE CLASS: **mock (M)**. Every test built on this drives the REAL M3b4b
// implementation — `localStorageAdapter`'s migration source capability (over a
// disposable synthetic `Storage` installed as the global), the native store's
// migration target capability, the evidence collector and the runner — over
// `pluginFaithfulSqliteEngine`, which reproduces the installed plugin's
// statement, transaction and acknowledgement semantics per platform. It does not
// use `nativeMigrationTestKit`'s mechanical class-L executor.
//
// What it models and what it does not: the engine models the approved
// atomicity assumption (a COMMIT makes the working copy durable at once; a
// discarded connection loses uncommitted work). Nothing here proves real SQLite
// durability, WebKit marker persistence, restore pairing, termination DURING a
// COMMIT or power-loss survival (R2, R65, R66 stay simulator/device obligations).
//
// All data is synthetic; the fingerprints are the labelled synthetic digests of
// the class-L kit, never a production algorithm.
import { vi } from "vitest";
import type { NativeMigrationLimits, NativeMigrationRunReport, NativeMigrationRunner } from "../nativeMigrationRunner";
import type { NativeSqliteEngine, NativeSqliteMigrationTarget, NativeSqliteStore } from "../nativeSqliteAdapter";
import type { MigrationSourceStore } from "../localStorageAdapter";
import {
  NATIVE_MIGRATION_ACTIVATION_RECORD_KEY,
  NATIVE_MIGRATION_FAULT_LATCH_KEY,
  NATIVE_MIGRATION_SOURCE_MARKER_KEY,
} from "../nativeMigrationEligibility";
import { evaluateActivationRecord, type ActivationRecord } from "../nativeMigrationRecord";
import {
  createPluginFaithfulEngine,
  createPluginFaithfulEngineState,
  type PluginFaithfulEngineState,
  type PluginFaithfulFaults,
  type PluginPlatform,
} from "./pluginFaithfulSqliteEngine";
import { fp, isSyntheticFingerprint } from "./nativeMigrationTestKit";

export const RECORD_KEY = NATIVE_MIGRATION_ACTIVATION_RECORD_KEY;
export const LATCH_KEY = NATIVE_MIGRATION_FAULT_LATCH_KEY;
export const MARKER_KEY = NATIVE_MIGRATION_SOURCE_MARKER_KEY;
export const TARGET_DATABASE = "synthetic-m3b4b-migration-target";
export const PLATFORMS: readonly PluginPlatform[] = ["ios", "android"];

/* ------------------------------------------------------------------ source */

/** Per-call fault switches for the synthetic WebView store. Live: change them between calls. */
export interface StorageFaults {
  lengthThrows?: boolean;
  /** Throws on the n-th (1-based) `length` read for which this answers true. */
  lengthThrowsWhen?: (lengthReads: number) => boolean;
  /** `key(i)` returns null at this index (the store changed underneath). */
  keyNullAt?: number;
  keyThrows?: boolean;
  /** Duplicate the key at index 0 into index 1's slot. */
  duplicateKeys?: boolean;
  /** Changes the store between the two enumeration passes. */
  mutateBetweenPasses?: (storage: SyntheticStorage) => void;
  getItemThrows?: (key: string) => boolean;
  /** `reject_before_apply`: nothing stored; `apply_then_reject`: stored, then throws. */
  setItem?: (key: string) => "ok" | "reject_before_apply" | "apply_then_reject";
  /** A hostile thrown value for every throwing call. */
  thrownValue?: () => unknown;
  /** Called before every `getItem`, after recording the read. */
  beforeGetItem?: (key: string, storage: SyntheticStorage) => void;
}

const HOSTILE_DEFAULT = () => new Error("synthetic storage failure");

/** A disposable synthetic `Storage`. It records every key whose VALUE was read. */
export class SyntheticStorage {
  readonly map = new Map<string, string>();
  readonly valueReads: string[] = [];
  readonly writes: string[] = [];
  lengthReads = 0;
  faults: StorageFaults = {};
  private passes = 0;

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [key, value] of Object.entries(initial)) this.map.set(key, value);
  }

  private fail(): never {
    throw (this.faults.thrownValue ?? HOSTILE_DEFAULT)();
  }

  get length(): number {
    this.lengthReads += 1;
    if (this.faults.lengthThrows || this.faults.lengthThrowsWhen?.(this.lengthReads)) this.fail();
    return this.map.size;
  }

  key(index: number): string | null {
    if (this.faults.keyThrows) this.fail();
    if (index === 0) {
      this.passes += 1;
      if (this.passes % 2 === 0) this.faults.mutateBetweenPasses?.(this);
    }
    if (this.faults.keyNullAt === index) return null;
    const keys = [...this.map.keys()];
    if (this.faults.duplicateKeys && index === 1) return keys[0] ?? null;
    return keys[index] ?? null;
  }

  getItem(key: string): string | null {
    this.valueReads.push(key);
    this.faults.beforeGetItem?.(key, this);
    if (this.faults.getItemThrows?.(key)) this.fail();
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.writes.push(key);
    const mode = this.faults.setItem?.(key) ?? "ok";
    if (mode === "reject_before_apply") this.fail();
    this.map.set(key, String(value));
    if (mode === "apply_then_reject") this.fail();
  }

  removeItem(key: string): void {
    this.writes.push(`remove:${key}`);
    this.map.delete(key);
  }

  clear(): void {
    this.writes.push("clear");
    this.map.clear();
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.map);
  }
}

/* ------------------------------------------------------------------ device */

/** One synthetic device: the WebView store and the committed SQLite state survive "restarts". */
export interface Device {
  readonly platform: PluginPlatform;
  readonly storage: SyntheticStorage;
  readonly state: PluginFaithfulEngineState;
}

export function device(platform: PluginPlatform, source: Readonly<Record<string, string>> = {}): Device {
  return { platform, storage: new SyntheticStorage(source), state: createPluginFaithfulEngineState() };
}

let generated = 0;
/** Deterministic, canonical, synthetic v4-shaped UUIDs. */
export function syntheticUuid(): string {
  generated += 1;
  return `bbbbbbbb-bbbb-4bbb-8bbb-${generated.toString(16).padStart(12, "0")}`;
}

export const SYNTHETIC_NOW = "2026-10-20T12:00:00.000Z";

export const LIMITS: NativeMigrationLimits = Object.freeze({
  checkpointBatchKeyLimit: 2,
  latchWriteAttemptLimit: 3,
  maxPlansPerRun: 25,
});

/** The module instances of ONE live execution context. */
export interface ExecutionContext {
  readonly bindings: typeof import("../nativeMigrationBindings");
  readonly runners: typeof import("../nativeMigrationRunner");
  /** The same native-adapter module instance the bindings load, for ordinary competitors. */
  readonly adapter: typeof import("../nativeSqliteAdapter");
}

/**
 * A NEW execution context — the test's model of a new process. Module state
 * (the native store's per-database ownership registry above all) starts empty,
 * exactly as it would after a real process restart. Creating another object in
 * the SAME context is not a restart; `sameContext` does that, for the cases
 * where a second owner must be refused.
 */
export async function newContext(): Promise<ExecutionContext> {
  vi.resetModules();
  return {
    bindings: await import("../nativeMigrationBindings"),
    runners: await import("../nativeMigrationRunner"),
    adapter: await import("../nativeSqliteAdapter"),
  };
}

export interface Process {
  readonly device: Device;
  readonly context: ExecutionContext;
  readonly faults: PluginFaithfulFaults;
  readonly store: NativeSqliteStore;
  readonly target: NativeSqliteMigrationTarget;
  readonly runner: NativeMigrationRunner;
  /** The engine's own view, for observation only. */
  readonly plugin: ReturnType<typeof createPluginFaithfulEngine>;
  run(): Promise<NativeMigrationRunReport>;
}

export interface ProcessOptions {
  readonly faults?: PluginFaithfulFaults;
  readonly limits?: Partial<NativeMigrationLimits>;
  readonly fingerprint?: (value: string) => Promise<string> | string;
  readonly generateUuid?: () => string;
  readonly now?: () => string;
  /** Wraps the plugin-faithful engine, e.g. to observe a bridge call's own promise. */
  readonly wrapEngine?: (engine: NativeSqliteEngine) => NativeSqliteEngine;
  /** Wraps the real source binding, e.g. to change the synthetic store at a chosen call (Stage M3b4c). */
  readonly wrapSource?: (source: MigrationSourceStore) => MigrationSourceStore;
}

/**
 * Starts a NEW process on the device: a new execution context, a fresh engine
 * connection over the same committed state (uncommitted work of any earlier
 * process is gone), a fresh source binding over the same synthetic WebView
 * store, and a cold runner.
 */
export async function boot(d: Device, options: ProcessOptions = {}): Promise<Process> {
  return start(await newContext(), d, options);
}

/**
 * Another engine wrapper, store binding and runner for the same device IN THE
 * SAME LIVE CONTEXT as `existing` — not a restart. Ownership of the database is
 * shared with `existing`, so this one must be refused while the other holds it.
 */
export function sameContext(existing: Process, options: ProcessOptions = {}): Promise<Process> {
  return start(existing.context, existing.device, options);
}

async function start(context: ExecutionContext, d: Device, options: ProcessOptions): Promise<Process> {
  const { createNativeMigrationSource, createNativeMigrationTarget } = context.bindings;
  const { createNativeMigrationRunner } = context.runners;
  vi.stubGlobal("localStorage", d.storage);
  const faults: PluginFaithfulFaults = { rollbackWithoutTransaction: "platform", ...(options.faults ?? {}) };
  const plugin = createPluginFaithfulEngine({ platform: d.platform, state: d.state, faults });
  const { store, target } = await createNativeMigrationTarget({
    databaseName: TARGET_DATABASE,
    engine: options.wrapEngine ? options.wrapEngine(plugin.engine) : plugin.engine,
    detectPlatform: () => d.platform,
  });
  const source = createNativeMigrationSource();
  const runner = createNativeMigrationRunner({
    source: options.wrapSource ? options.wrapSource(source) : source,
    target,
    fingerprint: options.fingerprint ?? ((value) => fp(value)),
    isWellFormedFingerprint: isSyntheticFingerprint,
    generateUuid: options.generateUuid ?? syntheticUuid,
    now: options.now ?? (() => SYNTHETIC_NOW),
    limits: { ...LIMITS, ...(options.limits ?? {}) },
  });
  return {
    device: d,
    context,
    faults,
    store,
    target,
    runner,
    plugin,
    // The WebView store is a GLOBAL; each process re-binds its own device's
    // store before it runs, so two processes in one test never share one.
    run: () => {
      vi.stubGlobal("localStorage", d.storage);
      return runner.run();
    },
  };
}

/* ------------------------------------------------------------- observation */

/** The committed record, parsed; `null` = no record. Throws on an invalid one. */
export function committedRecord(d: Device): ActivationRecord | null {
  const bytes = d.state.rows.get(RECORD_KEY);
  if (bytes === undefined) return null;
  const evaluated = evaluateActivationRecord(bytes, isSyntheticFingerprint);
  if (!evaluated.ok) throw new Error("committed record is not valid");
  return evaluated.record;
}

export function phaseOf(d: Device): string {
  return committedRecord(d)?.phase ?? "none";
}

/** Committed application rows (reserved keys excluded). */
export function applicationRows(d: Device): Record<string, string> {
  return Object.fromEntries(
    [...d.state.rows].filter(([key]) => key !== RECORD_KEY && key !== LATCH_KEY).sort(([a], [b]) => (a < b ? -1 : 1))
  );
}

/** Every write-shaped statement the engine received, for "no write" assertions. */
export function writeStatements(d: Device): string[] {
  return d.state.executed
    .map((entry) => entry.requested)
    .filter((sql) => /^(INSERT|UPDATE|DELETE|BEGIN|COMMIT)/i.test(sql.trim()));
}

/** Runs repeatedly until a non-plan outcome, with a hard cap so a defect cannot loop. */
export async function runToRest(process: Process, cap = 10): Promise<NativeMigrationRunReport> {
  let last: NativeMigrationRunReport | null = null;
  for (let index = 0; index < cap; index += 1) {
    last = await process.run();
    if (last.outcome !== "halted") return last;
  }
  return last as NativeMigrationRunReport;
}

export function ruleOf(report: NativeMigrationRunReport): string {
  return "rule" in report ? String(report.rule) : report.outcome;
}

/** Changes a fault so it fires exactly once, at the first matching call. */
export function once<A extends unknown[], R>(fire: (...args: A) => boolean, fault: R, otherwise: R): (...args: A) => R {
  let fired = false;
  return (...args: A) => {
    if (!fired && fire(...args)) {
      fired = true;
      return fault;
    }
    return otherwise;
  };
}

/** Whether a COMMIT's working copy would make the record reach `phase`. */
export function commitReaches(phase: string, predicate?: (working: ReadonlyMap<string, string>) => boolean) {
  return (working: ReadonlyMap<string, string>): boolean => {
    const bytes = working.get(RECORD_KEY);
    if (bytes === undefined) return false;
    const evaluated = evaluateActivationRecord(bytes, isSyntheticFingerprint);
    return evaluated.ok && evaluated.record.phase === phase && (predicate ? predicate(working) : true);
  };
}

/* ------------------------------------------------------------- scenarios */

/** The record a COMMIT's working copy would make durable, or `null`. */
export function recordIn(rows: ReadonlyMap<string, string>): ActivationRecord | null {
  const bytes = rows.get(RECORD_KEY);
  if (bytes === undefined) return null;
  const evaluated = evaluateActivationRecord(bytes, isSyntheticFingerprint);
  return evaluated.ok ? evaluated.record : null;
}

/** A deep copy of a device: the same WebView store and the same committed target. */
export function cloneDevice(d: Device): Device {
  const copy = device(d.platform, d.storage.snapshot());
  for (const [key, value] of d.state.rows) copy.state.rows.set(key, value);
  for (const table of d.state.tables) copy.state.tables.add(table);
  for (const [key, value] of d.state.pragmas) copy.state.pragmas.set(key, value);
  return copy;
}

/** The first rule a report reached: its first completed plan's rule, or its own. */
export function firstRule(report: NativeMigrationRunReport): string {
  return report.completedPlans[0]?.rule ?? ruleOf(report);
}

/** A process that dies while the first commit matching `at` is in flight. Its run never settles. */
export async function dieAt(d: Device, at: (working: ReadonlyMap<string, string>) => boolean): Promise<void> {
  const p = await boot(d, { faults: { onCommit: once(at, "hang" as const, "ok" as const) } });
  void p.run();
  // Let the run reach the hanging COMMIT.
  for (let tick = 0; tick < 50; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** `enumerating`, marker positively absent: AP-D3's marker write was rejected before applying. */
export async function reachEnumerating(d: Device): Promise<void> {
  const p = await boot(d);
  d.storage.faults.setItem = (key) => (key === MARKER_KEY ? "reject_before_apply" : "ok");
  await p.run();
  d.storage.faults.setItem = undefined;
  if (phaseOf(d) !== "enumerating" || d.storage.map.has(MARKER_KEY)) throw new Error("setup: not enumerating");
}

/** `copying` with `copiedCount` keys committed (death at the next checkpoint or at AP-CC). */
export async function reachCopying(d: Device, copiedCount: number): Promise<void> {
  await dieAt(d, (working) => {
    const record = recordIn(working);
    if (!record) return false;
    if (record.phase === "verified") return true;
    return record.phase === "copying" && (record.copied?.length ?? 0) > copiedCount;
  });
  const record = committedRecord(d);
  if (record?.phase !== "copying" || record.copied?.length !== copiedCount) throw new Error("setup: not copying");
}

/** `verified` (death at the activation commit). */
export async function reachVerified(d: Device): Promise<void> {
  await dieAt(d, commitReaches("active"));
  if (phaseOf(d) !== "verified") throw new Error("setup: not verified");
}

/** A completed migration: `active`. */
export async function reachActive(d: Device): Promise<void> {
  const report = await runToRest(await boot(d));
  if (report.outcome !== "access") throw new Error(`setup: ${JSON.stringify(report)}`);
}

/* ------------------------------------------------------- controllable promises */

export interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

export function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Yields until `condition` holds — a deterministic wait on a recorded event, bounded so a defect fails fast. */
export async function until(condition: () => boolean, label = "condition"): Promise<void> {
  for (let tick = 0; tick < 500; tick += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${label}`);
}
